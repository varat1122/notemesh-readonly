import os
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from uuid import uuid4

import pytest
from sqlalchemy import text

from investment_os.domain.canonical import canonical_sha256
from investment_os.ingestion.capture import SyntheticCapture
from investment_os.ingestion.text_review import SyntheticTextReviewer
from investment_os.policy.access import DUMMY_PRINCIPALS, Principal
from investment_os.ports.contracts import SyntheticCaptureRequest
from investment_os.ports.text_review import TextReviewPacket, review_item_id
from investment_os.storage.database import make_engine
from investment_os.storage.local_objects import ObjectIntegrityError, SyntheticObjectStore
from investment_os.storage.registry import IdempotencyConflict, SyntheticRegistry

pytestmark = pytest.mark.integration
ACTOR = DUMMY_PRINCIPALS["dummy-researcher"]
READER = DUMMY_PRINCIPALS["dummy-reader"]
CONTENT = "จำลอง +0.40 percentage points\r\nto 50.4%.\r\n\r\nAn unverified opinion.".encode()


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
        yield SyntheticCapture(store, registry), SyntheticTextReviewer(store, registry), root
    engine.dispose()


def request():
    return SyntheticCaptureRequest(
        filename="fictional.txt",
        idempotency_key="text-review-" + uuid4().hex,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
        publisher="Fictional publisher",
    )


def counts(service):
    with service.registry.engine.connect() as conn:
        return tuple(
            conn.execute(text("SELECT count(*) FROM " + name)).scalar()
            for name in ["entities", "entity_versions", "audit_events", "operations"]
        )


def test_capture_review_readback_and_restart_leave_original_and_registry_unchanged(harness):
    capture, review, root = harness
    req = request()
    result = capture.capture(ACTOR, req, CONTENT)
    before = counts(capture)
    packet = review.draft(ACTOR, result.source_id)
    assert counts(capture) == before
    assert review.store.read_verified("objects", packet.source_sha256) == CONTENT
    assert capture.capture(ACTOR, req, CONTENT).replayed
    capture.registry.engine.dispose()
    with SyntheticObjectStore(root) as reopened:
        fresh = SyntheticTextReviewer(reopened, capture.registry)
        assert fresh.draft(ACTOR, result.source_id) == packet
        for item in packet.items:
            assert fresh.verify_item(READER, packet, item.id) == item
    source = capture.registry.get(READER, result.source_id, 1)
    document = capture.registry.get(READER, result.document_id, 1)
    assert source.verification == document.verification == "unverified"
    assert source.url is None
    assert source.times.published_at is source.times.event_at is source.times.data_as_of is None


@pytest.mark.parametrize(
    "principal", [READER, Principal(actor_id=uuid4(), role=ACTOR.role, actor_type="ai")]
)
def test_read_only_and_forged_principals_cannot_capture_or_create_review(harness, principal):
    capture, review, root = harness
    before = counts(capture)
    with pytest.raises(PermissionError):
        capture.capture(principal, request(), CONTENT)
    with pytest.raises(PermissionError):
        review.draft(principal, uuid4())
    assert counts(capture) == before
    assert list((root / "journal").iterdir()) == []


def test_text_quarantine_and_idempotency_conflict(harness):
    capture, _, root = harness
    before = counts(capture)
    req = request()
    result = capture.capture(ACTOR, req, b"hidden\x00control")
    assert result.status == "quarantined" and counts(capture) == before
    assert list((root / "objects").iterdir()) == []
    assert capture.capture(ACTOR, req, b"hidden\x00control").replayed
    with pytest.raises(IdempotencyConflict):
        capture.capture(ACTOR, req, CONTENT)


def test_forged_self_consistent_item_is_rejected_against_original(harness):
    capture, review, _ = harness
    result = capture.capture(ACTOR, request(), CONTENT)
    packet = review.draft(ACTOR, result.source_id)
    value = packet.model_dump(exclude={"output_sha256"})
    first = value["items"][0]
    first["line_start"] = first["line_end"] = 99
    first["id"] = review_item_id(
        packet.document_id, 1, packet.source_sha256, {k: v for k, v in first.items() if k != "id"}
    )
    forged = TextReviewPacket(**value, output_sha256=canonical_sha256(value))
    with pytest.raises(ObjectIntegrityError):
        review.verify_item(READER, forged, forged.items[0].id)
    with pytest.raises(KeyError):
        review.verify_item(READER, packet, uuid4())


def test_corrupted_original_fails_cached_review_and_readback(harness):
    capture, review, root = harness
    result = capture.capture(ACTOR, request(), CONTENT)
    packet = review.draft(ACTOR, result.source_id)
    path = root / "objects" / packet.source_sha256
    path.chmod(0o600)
    path.write_bytes(b"corrupted synthetic fixture")
    with pytest.raises(ObjectIntegrityError):
        review.draft(ACTOR, result.source_id)
    with pytest.raises(ObjectIntegrityError):
        review.verify_item(READER, packet, packet.items[0].id)


def test_concurrent_review_writes_one_checkpoint(harness):
    capture, _, root = harness
    result = capture.capture(ACTOR, request(), CONTENT)
    before = counts(capture)

    def draft():
        with SyntheticObjectStore(root) as store:
            return SyntheticTextReviewer(store, capture.registry).draft(ACTOR, result.source_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        results = list(pool.map(lambda _: draft(), range(2)))
    assert results[0] == results[1]
    assert len(list((root / "journal").glob("*.reviewdraft"))) == 1
    assert counts(capture) == before


def test_derived_write_failure_keeps_original_and_retries_without_db_changes(harness, monkeypatch):
    capture, review, root = harness
    result = capture.capture(ACTOR, request(), CONTENT)
    before = counts(capture)
    original_journal = review.store.journal

    def fail(key, stage, value=None):
        if stage == "reviewdraft" and value is not None:
            raise OSError("injected synthetic derivative failure")
        return original_journal(key, stage, value)

    monkeypatch.setattr(review.store, "journal", fail)
    with pytest.raises(OSError):
        review.draft(ACTOR, result.source_id)
    assert review.store.read_verified("objects", result.content_sha256) == CONTENT
    assert counts(capture) == before
    monkeypatch.setattr(review.store, "journal", original_journal)
    assert review.draft(ACTOR, result.source_id).status == "needs_human_review"


def test_invalid_version_and_non_text_document_denied(harness):
    capture, review, _ = harness
    result = capture.capture(ACTOR, request(), CONTENT)
    for version in [0, True, -1]:
        with pytest.raises(ValueError):
            review.draft(ACTOR, result.source_id, document_version=version)
    req = request().model_copy(update={"filename": "fictional.csv"})
    csv = capture.capture(ACTOR, req, b"name,value\nFictional,1.00")
    with pytest.raises(PermissionError):
        review.draft(ACTOR, csv.source_id)
