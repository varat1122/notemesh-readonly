"""Repeatable metadata-only demo against the dedicated local synthetic database."""

import copy
import json
import os
from dataclasses import asdict
from pathlib import Path
from uuid import NAMESPACE_URL, UUID, uuid5

from investment_os.domain.canonical import canonical_sha256
from investment_os.domain.entities import EntityEnvelope
from investment_os.domain.references import REFERENCE_RULES, extract_references
from investment_os.policy.access import DUMMY_PRINCIPALS
from investment_os.storage.database import SCHEMA_REVISION, make_engine
from investment_os.storage.registry import SyntheticRegistry, VersionConflict


def main():
    root = Path(__file__).resolve().parents[1]
    fixtures = json.loads((root / "tests/fixtures_synthetic/entities.json").read_text())
    ids = {
        r["id"]: str(uuid5(NAMESPACE_URL, "investment-os/p1-registry-demo/v1/" + r["id"]))
        for r in fixtures
    }

    def remap(value):
        if isinstance(value, dict):
            return {k: remap(v) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v) for v in value]
        return ids.get(value, value) if isinstance(value, str) else value

    actor = DUMMY_PRINCIPALS["dummy-researcher"]
    records = {r["kind"]: remap(r) for r in fixtures if r["kind"] in REFERENCE_RULES}
    for record in records.values():
        record["provenance"]["actor_id"] = str(actor.actor_id)
    by_id = {r["id"]: r for r in records.values()}
    url = (
        "postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:"
        + os.getenv("IOS_PG_PORT", "55432")
        + "/ios_synthetic"
    )
    engine = make_engine(url)
    registry = SyntheticRegistry(engine)
    results = {}

    def create(kind):
        if kind in results:
            return
        record = records[kind]
        for ref in extract_references(EntityEnvelope.model_validate(record).root):
            create(by_id[str(ref.target_id)]["kind"])
        results[kind] = registry.put(
            actor, record, expected_version=0, idempotency_key="demo-v1-" + record["id"]
        )

    try:
        for kind in records:
            create(kind)
        revised = copy.deepcopy(records["technology"])
        revised.update(version=2, name="Synthetic demo technology revision two")
        update = registry.put(
            actor, revised, expected_version=1, idempotency_key="demo-v2-" + revised["id"]
        )
        try:
            registry.put(
                actor,
                revised,
                expected_version=1,
                idempotency_key="demo-stale-" + revised["id"],
            )
        except VersionConflict:
            stale_denied = True
        else:
            raise AssertionError("stale write was accepted")
    finally:
        engine.dispose()

    # A separate engine/connection verifies committed state, not an in-memory cache.
    engine = make_engine(url)
    try:
        reader = SyntheticRegistry(engine)
        for result in results.values():
            stored = reader.get(DUMMY_PRINCIPALS["dummy-reader"], result.entity_id, result.version)
            assert canonical_sha256(stored) == result.payload_sha256
        assert reader.get(actor, UUID(revised["id"])).version == 2
    finally:
        engine.dispose()
    print(
        json.dumps(
            {
                "status": "PASS",
                "schema_revision": SCHEMA_REVISION,
                "scope": "synthetic registry metadata only; no document byte capture or Vault write",
                "originals": {kind: asdict(result) for kind, result in results.items()},
                "revision_two": asdict(update),
                "fresh_connection_readback": True,
                "stale_write_denied": stale_denied,
            },
            default=str,
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
