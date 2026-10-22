"""Local synthetic database-only backup/restore and migration reversal drill.

Creates a uniquely named restore database in the P0 Compose server, then removes
ONLY that restore database. Does not access any NoteMesh/Vault/budget ledger.
"""

import hashlib
import json
import os
import subprocess
import tempfile
from pathlib import Path
from uuid import uuid4

from sqlalchemy import text

from investment_os.storage.database import make_engine

root = Path(__file__).resolve().parents[1]
compose = [str(root / "scripts/compose.sh")]
url = (
    "postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:"
    + os.getenv("IOS_PG_PORT", "55432")
    + "/ios_synthetic"
)
database = make_engine(url)
payload = json.loads((root / "tests/fixtures_synthetic/entities.json").read_text())[2]
assert payload["kind"] == "company" and payload["provenance"]["origin"] == "synthetic"
encoded = json.dumps(payload, sort_keys=True, separators=(",", ":"))
digest = hashlib.sha256(encoded.encode()).hexdigest()
# One explicit synthetic fixture is preserved in the dev DB for restart/readback.
with database.begin() as conn:
    if not conn.execute(
        text("SELECT 1 FROM entities WHERE id=:id"), {"id": payload["id"]}
    ).scalar():
        conn.execute(
            text("INSERT INTO entities(id,kind) VALUES (:id,'company')"), {"id": payload["id"]}
        )
        conn.execute(
            text("""INSERT INTO entity_versions(entity_id,version,schema_version,payload,content_sha256)
            VALUES (:id,1,'1.0',CAST(:p AS jsonb),:sha)"""),
            {"id": payload["id"], "p": encoded, "sha": digest},
        )
name = "ios_p0_restore_" + uuid4().hex[:12]
with tempfile.TemporaryDirectory(prefix="ios-p0-restore-") as tmp:
    dump = Path(tmp) / "synthetic.dump"
    with dump.open("wb") as handle:
        subprocess.run(
            compose
            + ["exec", "-T", "db", "pg_dump", "-U", "ios_dummy", "-d", "ios_synthetic", "-Fc"],
            stdout=handle,
            check=True,
        )
    subprocess.run(compose + ["exec", "-T", "db", "createdb", "-U", "ios_dummy", name], check=True)
    try:
        with dump.open("rb") as handle:
            subprocess.run(
                compose
                + [
                    "exec",
                    "-T",
                    "db",
                    "pg_restore",
                    "-U",
                    "ios_dummy",
                    "-d",
                    name,
                    "--exit-on-error",
                ],
                stdin=handle,
                check=True,
            )
        restored = make_engine(url.rsplit("/", 1)[0] + "/" + name)
        with restored.connect() as conn:
            row = conn.execute(
                text("SELECT payload,content_sha256 FROM entity_versions WHERE entity_id=:id"),
                {"id": payload["id"]},
            ).one()
            assert row[0] == payload and row[1] == digest
            assert (
                conn.execute(text("SELECT version_num FROM alembic_version")).scalar() == "0001_p0"
            )
        restored.dispose()
        env = dict(os.environ, IOS_DATABASE_URL=url.rsplit("/", 1)[0] + "/" + name)
        command = [
            str(root / ".venv/bin/alembic"),
            "-c",
            str(root / "infra/migrations/alembic.ini"),
        ]
        subprocess.run(command + ["downgrade", "base"], env=env, check=True)
        subprocess.run(command + ["upgrade", "head"], env=env, check=True)
        subprocess.run(command + ["upgrade", "head"], env=env, check=True)
        print(
            json.dumps(
                {
                    "status": "PASS",
                    "restored_payload_and_hash": True,
                    "migration_down_up_idempotent": True,
                    "scope": "synthetic PostgreSQL only; no cross-store recovery claim",
                }
            )
        )
    finally:
        subprocess.run(
            compose + ["exec", "-T", "db", "dropdb", "-U", "ios_dummy", name], check=True
        )
database.dispose()
