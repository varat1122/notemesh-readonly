import hashlib
import os
import runpy
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime, timedelta
from pathlib import Path

import pytest
from sqlalchemy import text

from investment_os.ingestion.capture import PartialCaptureError, SyntheticCapture
from investment_os.ingestion.validation import MAX_BYTES
from investment_os.policy.access import DUMMY_PRINCIPALS
from investment_os.ports.contracts import SyntheticCaptureRequest
from investment_os.storage.database import make_engine
from investment_os.storage.local_objects import ObjectIntegrityError, SyntheticObjectStore
from investment_os.storage.registry import IdempotencyConflict, SyntheticRegistry

pytestmark = pytest.mark.integration
ACTOR = DUMMY_PRINCIPALS["dummy-researcher"]
samples = runpy.run_path(str(Path(__file__).parents[1] / "fixtures_synthetic/file_samples.py"))


@pytest.fixture
def harness(tmp_path):
    url = os.environ.get("IOS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("IOS_TEST_DATABASE_URL required for real synthetic PostgreSQL")
    if not url.split("?")[0].endswith("/ios_synthetic"):
        pytest.fail("dedicated ios_synthetic database required")
    root = tmp_path / "synthetic-objects"
    SyntheticObjectStore.create(root)
    engine = make_engine(url)
    with SyntheticObjectStore(root) as store:
        registry = SyntheticRegistry(engine)
        yield SyntheticCapture(store, registry), root
    engine.dispose()


def request(kind="csv"):
    from uuid import uuid4

    return SyntheticCaptureRequest(
        filename="synthetic." + kind,
        idempotency_key="capture-" + uuid4().hex,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
        publisher="Synthetic fixture publisher",
    )


def counts(service):
    with service.registry.engine.connect() as conn:
        return tuple(
            conn.execute(text("SELECT count(*) FROM " + name)).scalar()
            for name in [
                "entities",
                "entity_versions",
                "operations",
                "registry_commits",
                "audit_events",
            ]
        )


@pytest.mark.parametrize("kind", ["csv", "pdf", "xlsx"])
def test_actual_capture_restart_and_same_request_replay(harness, kind):
    service, root = harness
    req, content = request(kind), samples[kind + "_bytes"]()
    first = service.capture(ACTOR, req, content)
    assert first.status == "captured" and first.original_bytes_verified and not first.replayed
    assert service.store.read_verified("objects", first.content_sha256) == content
    service.registry.engine.dispose()
    with SyntheticObjectStore(root) as reopened:
        second = SyntheticCapture(reopened, service.registry).capture(ACTOR, req, content)
    assert (
        second.document_id == first.document_id
        and second.source_id == first.source_id
        and second.replayed
    )
    document = service.registry.get(ACTOR, first.document_id)
    source = service.registry.get(ACTOR, first.source_id)
    assert source.original_document_id == document.id
    assert (
        document.byte_size == len(content)
        and document.content_sha256 == hashlib.sha256(content).hexdigest()
    )
    assert (
        document.times.event_at is document.times.published_at is document.times.data_as_of is None
    )
    assert document.verification == source.verification == "unverified"
    assert document.provenance.permitted_uses == ("local_research",)


def test_invalid_file_quarantines_without_registry_mutation(harness):
    service, root = harness
    before = counts(service)
    req = request("pdf")
    first = service.capture(ACTOR, req, b"not a PDF")
    assert first.status == "quarantined" and not first.original_bytes_verified
    assert first.document_id is None and first.source_id is None
    assert not list((root / "objects").iterdir())
    assert service.store.read_verified("quarantine", first.content_sha256) == b"not a PDF"
    assert service.capture(ACTOR, req, b"not a PDF").replayed
    assert counts(service) == before


@pytest.mark.parametrize("change", ["bytes", "filename", "publisher", "received"])
def test_reused_capture_key_cannot_change_request(harness, change):
    service, _ = harness
    req, content = request(), samples["csv_bytes"]()
    service.capture(ACTOR, req, content)
    before = counts(service)
    if change == "bytes":
        content += b"Other,2026-Q1,9\r\n"
    elif change == "filename":
        req = req.model_copy(update={"filename": "another.csv"})
    elif change == "publisher":
        req = req.model_copy(update={"publisher": "Another publisher"})
    else:
        req = req.model_copy(update={"received_at": datetime(2026, 1, 2, tzinfo=UTC)})
    with pytest.raises(IdempotencyConflict):
        service.capture(ACTOR, req, content)
    assert counts(service) == before


def test_rejection_before_disk_write_for_scope_authority_size_and_future_time(harness):
    service, root = harness
    req, content = request(), samples["csv_bytes"]()
    before = sorted(root.rglob("*"))
    with pytest.raises(PermissionError):
        service.capture(DUMMY_PRINCIPALS["dummy-reader"], req, content)
    with pytest.raises(ValueError):
        service.capture(ACTOR, req.model_copy(update={"origin": "human"}), content)
    with pytest.raises(ValueError):
        service.capture(ACTOR, req.model_copy(update={"license_id": "licensed-feed"}), content)
    with pytest.raises(ValueError):
        service.capture(ACTOR, req, b"x" * (MAX_BYTES + 1))
    with pytest.raises(ValueError):
        service.capture(
            ACTOR,
            req.model_copy(update={"received_at": datetime.now(UTC) + timedelta(days=1)}),
            content,
        )
    assert sorted(root.rglob("*")) == before


@pytest.mark.parametrize("failure", ["promotion", "source_commit", "journal_commit"])
def test_partial_failures_resume_without_duplicate_registry_commits(harness, monkeypatch, failure):
    service, root = harness
    req, content = request(), samples["csv_bytes"]()
    original_put, original_promote, original_journal = (
        service.registry.put,
        service.store.promote,
        service.store.journal,
    )

    def put(principal, record, **kwargs):
        if record.kind == "source":
            raise RuntimeError("injected source transaction failure")
        return original_put(principal, record, **kwargs)

    def promote(digest):
        raise OSError("injected disk failure")

    def journal(key, stage, value=None):
        if stage == "committed" and value is not None:
            raise OSError("injected journal failure")
        return original_journal(key, stage, value)

    if failure == "source_commit":
        monkeypatch.setattr(service.registry, "put", put)
    elif failure == "promotion":
        monkeypatch.setattr(service.store, "promote", promote)
    else:
        monkeypatch.setattr(service.store, "journal", journal)
    before = counts(service)
    with pytest.raises(PartialCaptureError):
        service.capture(ACTOR, req, content)
    assert not list((root / "journal").glob("*.committed"))
    assert list((root / "journal").glob("*.prepared"))
    monkeypatch.setattr(service.registry, "put", original_put)
    monkeypatch.setattr(service.store, "promote", original_promote)
    monkeypatch.setattr(service.store, "journal", original_journal)
    result = service.capture(ACTOR, req, content)
    assert result.status == "captured"
    assert counts(service) == tuple(n + 2 for n in before)
    assert service.capture(ACTOR, req, content).replayed
    assert counts(service) == tuple(n + 2 for n in before)


def test_corruption_is_detected_on_retry_and_not_silently_repaired(harness):
    service, root = harness
    req, content = request(), samples["csv_bytes"]()
    result = service.capture(ACTOR, req, content)
    file = root / "objects" / result.content_sha256
    file.chmod(0o600)
    file.write_bytes(b"corrupted")
    with pytest.raises(ObjectIntegrityError):
        service.capture(ACTOR, req, content)
    assert file.read_bytes() == b"corrupted"


def test_identical_bytes_deduplicate_storage_not_source_events(harness):
    service, root = harness
    content = samples["csv_bytes"]()
    a = service.capture(ACTOR, request(), content)
    b = service.capture(ACTOR, request(), content)
    assert a.content_sha256 == b.content_sha256 and a.source_id != b.source_id
    assert len(list((root / "objects").iterdir())) == 1


def test_two_concurrent_identical_captures_have_one_registry_pair(harness):
    service, root = harness
    req, content = request(), samples["csv_bytes"]()
    before = counts(service)

    def capture():
        with SyntheticObjectStore(root) as store:
            return SyntheticCapture(store, service.registry).capture(ACTOR, req, content)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(capture) for _ in range(2)]
        results = [f.result(timeout=20) for f in futures]
    assert sorted(r.replayed for r in results) == [False, True]
    assert results[0].source_id == results[1].source_id
    assert counts(service) == tuple(n + 2 for n in before)
