"""Reopen captured fictional originals and reproduce page/row/cell citations."""

import json
import os
import runpy
from datetime import UTC, datetime
from pathlib import Path

from investment_os.ingestion.capture import SyntheticCapture
from investment_os.ingestion.extraction import SyntheticExtractor
from investment_os.policy.access import DUMMY_PRINCIPALS
from investment_os.ports.contracts import SyntheticCaptureRequest
from investment_os.storage.database import make_engine
from investment_os.storage.local_objects import SyntheticObjectStore
from investment_os.storage.registry import SyntheticRegistry


def main():
    project = Path(__file__).resolve().parents[1]
    root = project / "artifacts/synthetic-intake-v1"
    if not root.exists():
        raise SystemExit(
            "Run scripts/intake_demo.py first; the extraction demo does not create/reset source storage."
        )
    samples = runpy.run_path(str(project / "tests/fixtures_synthetic/file_samples.py"))
    engine = make_engine(
        "postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:"
        + os.environ.get("IOS_PG_PORT", "55432")
        + "/ios_synthetic"
    )
    results = {}
    try:
        with SyntheticObjectStore(root) as store:
            registry = SyntheticRegistry(engine)
            capture, extractor = (
                SyntheticCapture(store, registry),
                SyntheticExtractor(store, registry),
            )
            for kind in ["pdf", "csv", "xlsx"]:
                request = SyntheticCaptureRequest(
                    filename="synthetic-" + kind + "." + kind,
                    idempotency_key="intake-demo-v1-" + kind,
                    received_at=datetime(2026, 1, 1, tzinfo=UTC),
                    publisher="Generated synthetic fixture",
                )
                receipt = capture.capture(
                    DUMMY_PRINCIPALS["dummy-researcher"], request, samples[kind + "_bytes"]()
                )
                artifact = extractor.extract(
                    DUMMY_PRINCIPALS["dummy-researcher"], receipt.document_id
                )
                excerpt = next(e for e in artifact.excerpts if "123.45" in e.text)
                assert (
                    extractor.verify_excerpt(DUMMY_PRINCIPALS["dummy-reader"], artifact, excerpt.id)
                    == excerpt
                )
                results[kind] = {
                    "document_id": str(artifact.document_id),
                    "source_id": str(receipt.source_id),
                    "source_sha256": artifact.source_sha256,
                    "output_sha256": artifact.output_sha256,
                    "excerpt_count": len(artifact.excerpts),
                    "citation": excerpt.model_dump(mode="json"),
                    "warnings": artifact.warnings,
                }
        print(
            json.dumps(
                {
                    "status": "PASS",
                    "scope": "synthetic extraction and original-source readback; no fact verification or financial normalization",
                    "results": results,
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        engine.dispose()


if __name__ == "__main__":
    main()
