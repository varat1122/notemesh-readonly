import hashlib
import json
import os
import runpy
from concurrent.futures import ThreadPoolExecutor
from datetime import UTC, datetime
from pathlib import Path
from uuid import uuid4

import pytest
from sqlalchemy import text

from investment_os.ingestion.capture import SyntheticCapture
from investment_os.ingestion.extraction import (
    ExtractionError,
    SyntheticExtractor,
    build_artifact,
    current_profile,
)
from investment_os.policy.access import DUMMY_PRINCIPALS
from investment_os.ports.contracts import SyntheticCaptureRequest
from investment_os.ports.extraction import ExtractedValue
from investment_os.storage.database import make_engine
from investment_os.storage.local_objects import ObjectIntegrityError, SyntheticObjectStore
from investment_os.storage.registry import SyntheticRegistry

pytestmark = pytest.mark.integration
ACTOR, READER = DUMMY_PRINCIPALS["dummy-researcher"], DUMMY_PRINCIPALS["dummy-reader"]
samples = runpy.run_path(str(Path(__file__).parents[1] / "fixtures_synthetic/file_samples.py"))


@pytest.fixture
def harness(tmp_path):
    url = os.environ.get("IOS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("IOS_TEST_DATABASE_URL required for actual PostgreSQL")
    if not url.split("?")[0].endswith("/ios_synthetic"):
        pytest.fail("synthetic database required")
    root = tmp_path / "synthetic-objects"
    SyntheticObjectStore.create(root)
    engine = make_engine(url)
    with SyntheticObjectStore(root) as store:
        registry = SyntheticRegistry(engine)
        yield SyntheticCapture(store, registry), SyntheticExtractor(store, registry), root
    engine.dispose()


def capture(service, kind="csv", data=None):
    req = SyntheticCaptureRequest(
        filename="synthetic." + kind,
        idempotency_key="extract-" + uuid4().hex,
        received_at=datetime(2026, 1, 1, tzinfo=UTC),
        publisher="Synthetic fixture",
    )
    return service.capture(ACTOR, req, samples[kind + "_bytes"]() if data is None else data)


def counts(registry):
    with registry.engine.connect() as conn:
        return tuple(
            conn.execute(text("SELECT count(*) FROM " + name)).scalar()
            for name in [
                "entities",
                "entity_versions",
                "entity_references",
                "operations",
                "registry_commits",
                "audit_events",
            ]
        )


@pytest.mark.parametrize("kind", ["pdf", "csv", "xlsx"])
def test_extract_restart_and_reader_reparse_original_without_registry_writes(harness, kind):
    intake, extractor, root = harness
    original = capture(intake, kind)
    before = counts(intake.registry)
    artifact = extractor.extract(ACTOR, original.document_id)
    assert artifact.source_sha256 == original.content_sha256
    excerpt = next(e for e in artifact.excerpts if "123.45" in e.text)
    with SyntheticObjectStore(root) as reopened:
        intake.registry.engine.dispose()
        fresh = SyntheticExtractor(reopened, intake.registry)
        assert fresh.extract(ACTOR, original.document_id) == artifact
        files = sorted(root.rglob("*"))
        assert fresh.verify_excerpt(READER, artifact, excerpt.id) == excerpt
        assert sorted(root.rglob("*")) == files
    assert counts(intake.registry) == before
    assert (
        intake.store.read_verified("objects", original.content_sha256) == samples[kind + "_bytes"]()
    )
    saved = json.loads(next((root / "journal").glob("*.extracted")).read_text())["payload"]
    assert saved["created_by"] == str(ACTOR.actor_id)


def test_reader_cannot_create_derivative_or_use_forged_principal(harness):
    intake, extractor, root = harness
    original = capture(intake)
    with pytest.raises(PermissionError):
        extractor.extract(READER, original.document_id)
    with pytest.raises(PermissionError):
        extractor.extract(ACTOR.model_copy(update={"actor_id": uuid4()}), original.document_id)
    assert not list((root / "journal").glob("*.extracted"))


def test_original_tampering_blocks_cached_artifact_and_citation(harness):
    intake, extractor, root = harness
    original = capture(intake)
    artifact = extractor.extract(ACTOR, original.document_id)
    file = root / "objects" / original.content_sha256
    file.chmod(0o600)
    file.write_bytes(b"corrupted")
    with pytest.raises(ObjectIntegrityError):
        extractor.extract(ACTOR, original.document_id)
    with pytest.raises(ObjectIntegrityError):
        extractor.verify_excerpt(READER, artifact, artifact.excerpts[0].id)
    assert file.read_bytes() == b"corrupted"


def test_forged_but_self_consistent_excerpt_fails_actual_original_readback(harness):
    intake, extractor, _ = harness
    original = capture(intake)
    real = extractor.extract(ACTOR, original.document_id)
    values = [ExtractedValue.model_validate(e.model_dump(exclude={"id"})) for e in real.excerpts]
    data = values[-1].model_dump()
    data.update(text="999.99", text_sha256=hashlib.sha256(b"999.99").hexdigest())
    values[-1] = ExtractedValue.model_validate(data)
    forged = build_artifact(
        intake.registry.get(ACTOR, original.document_id),
        current_profile(),
        {"excerpts": values, "pages_without_text": [], "warnings": real.warnings},
    )
    with pytest.raises(ObjectIntegrityError, match="reproduce"):
        extractor.verify_excerpt(READER, forged, forged.excerpts[-1].id)


def test_changed_parser_environment_cannot_certify_old_artifact(harness, monkeypatch):
    import investment_os.ingestion.extraction as module

    intake, extractor, _ = harness
    original = capture(intake)
    artifact = extractor.extract(ACTOR, original.document_id)
    monkeypatch.setattr(
        module,
        "current_profile",
        lambda: artifact.profile.model_copy(update={"pypdf_version": "0.0.0"}),
    )
    with pytest.raises(ExtractionError, match="matching parser"):
        extractor.verify_excerpt(READER, artifact, artifact.excerpts[0].id)


def test_failed_derivative_commit_can_retry_without_modifying_source_or_database(
    harness, monkeypatch
):
    intake, extractor, root = harness
    original = capture(intake)
    before = counts(intake.registry)
    journal = extractor.store.journal

    def fail(key, stage, value=None):
        if stage == "extracted" and value is not None:
            raise OSError("injected derivative storage failure")
        return journal(key, stage, value)

    monkeypatch.setattr(extractor.store, "journal", fail)
    with pytest.raises(OSError):
        extractor.extract(ACTOR, original.document_id)
    assert not list((root / "journal").glob("*.extracted"))
    monkeypatch.setattr(extractor.store, "journal", journal)
    result = extractor.extract(ACTOR, original.document_id)
    assert result.status == "text_extracted" and counts(intake.registry) == before
    assert intake.store.read_verified("objects", original.content_sha256) == samples["csv_bytes"]()


def test_corrupt_artifact_checkpoint_and_unknown_excerpt_are_denied(harness):
    intake, extractor, root = harness
    original = capture(intake)
    artifact = extractor.extract(ACTOR, original.document_id)
    with pytest.raises(ExtractionError, match="does not belong"):
        extractor.verify_excerpt(READER, artifact, uuid4())
    file = next((root / "journal").glob("*.extracted"))
    value = json.loads(file.read_text())
    value["sha256"] = "0" * 64
    file.chmod(0o600)
    file.write_text(json.dumps(value))
    with pytest.raises(ObjectIntegrityError):
        extractor.extract(ACTOR, original.document_id)


def test_concurrent_extraction_writes_one_immutable_artifact(harness):
    intake, extractor, root = harness
    original = capture(intake)

    def run():
        with SyntheticObjectStore(root) as store:
            return SyntheticExtractor(store, intake.registry).extract(ACTOR, original.document_id)

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(run) for _ in range(2)]
        a, b = [f.result(timeout=20) for f in futures]
    assert a == b and len(list((root / "journal").glob("*.extracted"))) == 1


def test_oversized_extraction_preserves_original_without_partial_artifact(harness):
    intake, extractor, root = harness
    content = b"column\n" + b"word\n" * 2001
    original = capture(intake, data=content)
    assert original.status == "captured"
    before = counts(intake.registry)
    with pytest.raises(ExtractionError, match="budget"):
        extractor.extract(ACTOR, original.document_id)
    assert not list((root / "journal").glob("*.extracted"))
    assert intake.store.read_verified("objects", original.content_sha256) == content
    assert counts(intake.registry) == before


def test_extraction_pins_document_revision_and_changes_artifact_identity_on_revision(harness):
    intake, extractor, _ = harness
    original = capture(intake)
    one = extractor.extract(ACTOR, original.document_id, 1)
    record = intake.registry.get(ACTOR, original.document_id).model_dump()
    record["version"] = 2
    record["provenance"]["basis"] = "Revised synthetic metadata only"
    intake.registry.put(
        ACTOR, record, expected_version=1, idempotency_key="revision-" + uuid4().hex
    )
    two = extractor.extract(ACTOR, original.document_id, 2)
    assert one.output_sha256 != two.output_sha256 and one.excerpts[0].id != two.excerpts[0].id
    assert one.source_sha256 == two.source_sha256
    assert extractor.verify_excerpt(READER, one, one.excerpts[0].id) == one.excerpts[0]
