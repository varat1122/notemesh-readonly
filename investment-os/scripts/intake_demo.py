"""Capture only generated fictional samples into a persistent, marked local test root."""

import json
import os
import runpy
from datetime import UTC, datetime
from pathlib import Path

from investment_os.ingestion.capture import SyntheticCapture
from investment_os.policy.access import DUMMY_PRINCIPALS
from investment_os.ports.contracts import SyntheticCaptureRequest
from investment_os.storage.database import make_engine
from investment_os.storage.local_objects import SyntheticObjectStore
from investment_os.storage.registry import SyntheticRegistry


def main():
    project = Path(__file__).resolve().parents[1]
    parent = project / "artifacts"
    parent.mkdir(exist_ok=True)
    root = parent / "synthetic-intake-v1"
    if not root.exists():
        SyntheticObjectStore.create(root)
    samples = runpy.run_path(str(project / "tests/fixtures_synthetic/file_samples.py"))
    database = make_engine(
        "postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:"
        + os.environ.get("IOS_PG_PORT", "55432")
        + "/ios_synthetic"
    )
    results = {}
    try:
        with SyntheticObjectStore(root) as store:
            capture = SyntheticCapture(store, SyntheticRegistry(database))
            for name, extension, content in [
                ("pdf", "pdf", samples["pdf_bytes"]()),
                ("csv", "csv", samples["csv_bytes"]()),
                ("xlsx", "xlsx", samples["xlsx_bytes"]()),
                ("invalid", "pdf", b"This is a fictional invalid PDF fixture."),
            ]:
                request = SyntheticCaptureRequest(
                    filename="synthetic-" + name + "." + extension,
                    idempotency_key="intake-demo-v1-" + name,
                    received_at=datetime(2026, 1, 1, tzinfo=UTC),
                    publisher="Generated synthetic fixture",
                )
                result = capture.capture(DUMMY_PRINCIPALS["dummy-researcher"], request, content)
                assert result.status == ("quarantined" if name == "invalid" else "captured")
                results[name] = result.model_dump(mode="json")
        database.dispose()
        # Open fresh directory descriptors and DB connections after completing all captures.
        with SyntheticObjectStore(root) as reopened:
            registry = SyntheticRegistry(database)
            for value in results.values():
                if value["status"] == "captured":
                    from uuid import UUID

                    document = registry.get(
                        DUMMY_PRINCIPALS["dummy-reader"], UUID(value["document_id"]), 1
                    )
                    content = reopened.read_verified("objects", value["content_sha256"])
                    assert len(content) == document.byte_size
        print(
            json.dumps(
                {
                    "status": "PASS",
                    "scope": "generated synthetic files only; no source verification, parsing or Vault writes",
                    "fresh_connection_readback": True,
                    "store": str(root.relative_to(project)),
                    "results": results,
                },
                indent=2,
            )
        )
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
