"""Produce a durable offline review document using generated fictional text only."""

import hashlib
import json
import os
import runpy
from datetime import UTC, datetime
from pathlib import Path

from investment_os.ingestion.capture import SyntheticCapture
from investment_os.ingestion.review_html import render_review
from investment_os.ingestion.text_review import SyntheticTextReviewer
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
    content = runpy.run_path(str(project / "tests/fixtures_synthetic/text_sample.py"))[
        "text_bytes"
    ]()
    database = make_engine(
        "postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:"
        + os.environ.get("IOS_PG_PORT", "55432")
        + "/ios_synthetic"
    )
    actor, reader = DUMMY_PRINCIPALS["dummy-researcher"], DUMMY_PRINCIPALS["dummy-reader"]
    try:
        registry = SyntheticRegistry(database)
        with SyntheticObjectStore(root) as store:
            capture = SyntheticCapture(store, registry).capture(
                actor,
                SyntheticCaptureRequest(
                    filename="fictional-spending.txt",
                    idempotency_key="text-review-demo-v1-fictional-spending",
                    received_at=datetime(2026, 1, 1, tzinfo=UTC),
                    publisher="Generated fictional text fixture",
                ),
                content,
            )
            assert capture.status == "captured"
            packet = SyntheticTextReviewer(store, registry).draft(actor, capture.source_id)
        database.dispose()
        # Actual fresh connections/descriptors, original byte readback and every citation checked.
        with SyntheticObjectStore(root) as reopened:
            reviewer = SyntheticTextReviewer(reopened, SyntheticRegistry(database))
            for item in packet.items:
                assert reviewer.verify_item(reader, packet, item.id) == item
            original = reopened.read_verified("objects", packet.source_sha256)
            html = render_review(packet, original)
            html_name = hashlib.sha256(html).hexdigest() + ".html"
            reopened.write_once("journal", html_name, html)
        print(
            json.dumps(
                {
                    "status": "PASS",
                    "scope": "fictional text; unverified local review draft only",
                    "fresh_connection_citation_readback": True,
                    "html": str((root / "journal" / html_name).relative_to(project)),
                    "packet": packet.model_dump(mode="json"),
                },
                ensure_ascii=False,
                indent=2,
            )
        )
    finally:
        database.dispose()


if __name__ == "__main__":
    main()
