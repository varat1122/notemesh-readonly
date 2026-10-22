# Investment OS — P0 foundation + first P1 registry milestone

A **synthetic-only development foundation** based on [Master Blueprint v1.0](docs/MASTER_BLUEPRINT.md). Python/FastAPI + PostgreSQL + portable Parquet/DuckDB + local Markdown contracts. This is an isolated subtree; the existing NoteMesh application is unchanged.

Implemented: strict canonical contracts, typed future module interfaces, policy evaluator, read-only synthetic Vault adapter, FastAPI health/schema endpoints, Alembic registry/audit foundation, Docker Compose and tests. **No research engine, business writeback, real ingestion, paid AI, broker execution, production auth or cloud deployment is implemented.**

## Prerequisites

- Python 3.12, `uv 0.12.23`, Docker Engine with Compose v2 and BuildKit.
- Verify: `python3 --version`, `uv --version`, `docker version`, `docker compose version`.
- If uv is absent, install into an isolated tool venv: `python3 -m venv /tmp/ios-uv-tool` then `/tmp/ios-uv-tool/bin/pip install uv==0.12.23`; use `/tmp/ios-uv-tool/bin/uv` or add that bin directory to PATH.
- Install Docker/Compose through the supported package or Docker Desktop for your OS; confirm the commands above before proceeding. P0 was actually tested on Linux x86_64; native Windows local-agent behavior is not verified.
- Ports 58000 (API) and 55432 (PostgreSQL) must be free. Override `IOS_API_PORT` / `IOS_PG_PORT` if needed.

## Start and verify

Run from this `investment-os/` directory:

```bash
uv sync --frozen
scripts/compose.sh up --build -d --wait
uv run --frozen python scripts/verify_compose.py
IOS_TEST_DATABASE_URL=postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:55432/ios_synthetic uv run --frozen pytest
uv run --frozen ruff check .
uv run --frozen ruff format --check .
uv run --frozen python scripts/export_schemas.py --check
uv run --frozen python scripts/check_repository.py
```

Or run `scripts/check.sh` for the sequence above. It sets the DB test URL, so integration tests cannot silently skip. Unit-only offline run: `uv run --frozen pytest -m 'not integration'`; that does **not** certify PostgreSQL or Compose.

Managed Codex environment: if HOME caches are read-only, prefix commands with `UV_CACHE_DIR=/workspace/.cache/uv-greenfield`. `scripts/compose.sh` automatically uses the managed local daemon and build-only CA secret when `CODEX_PROXY_CERT` exists. It keeps TLS verification and Docker credentials intact. On an ordinary developer machine it uses your selected Docker context. No production compose/deploy target exists.

Health: `http://127.0.0.1:58000/health/live` and `/health/ready`; development API docs: `/docs`. These are local URLs, not externally accessible deployments. Readiness requires the actual `0002_registry` PostgreSQL migration.

The Compose bootstrap runs a **one-shot migration owner** before API startup. API runs non-root with a read-only filesystem and uses `ios_app`, a SELECT-only DB role. All passwords/tokens are conspicuous **public dummy fixtures**. Ports bind loopback; never expose this stack to the Internet or real data. A project bridge allows local ports; outbound network denial is a host responsibility.

## Synthetic registry demo

After starting Compose, run `uv run --frozen python scripts/registry_demo.py` twice. The first run stores ten fictional metadata records and one new revision; the second replays the same operations. Both verify committed hashes through a new database connection and reject stale writes. This uses the local dummy database owner, not a production writer role. No document bytes or Vault notes are written. See [P1 milestone status](docs/P1_REGISTRY_STATUS.md) and [ADR 011](docs/adr/011.md).

## Local API without the API container

```bash
scripts/compose.sh up -d db
IOS_DATABASE_URL=postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:55432/ios_synthetic uv run --frozen alembic -c infra/migrations/alembic.ini upgrade head
IOS_ENABLE_DUMMY_AUTH=true IOS_DATABASE_URL=postgresql+psycopg://ios_app:dummy-read-only@127.0.0.1:55432/ios_synthetic uv run --frozen uvicorn investment_os.api.main:app --host 127.0.0.1 --port 58001 --no-access-log
```

No `.env` is automatically loaded. `.env.example` documents explicit settings. Dummy bearer tokens: `dummy-reader`, `dummy-researcher`, `dummy-owner`; unknown tokens are denied. Enabling dummy auth allows only schema validation and policy evaluation, never a write. `IOS_ENVIRONMENT=production` is rejected. The host process inherits its operator's environment, but application code only reads `IOS_` settings and does not consume provider credentials.

## Project layout

```text
src/investment_os/
  api/           health, contract validation, policy evaluation
  domain/        canonical IDs, provenance, time and 24 entity schemas
  ports/         typed future module/provider interfaces
  policy/        synthetic principals and deny-by-default capabilities
  storage/       PostgreSQL readiness and transactional synthetic registry
  adapters/      read-only synthetic local Vault boundary
infra/
  local-compose/ isolated API, PostgreSQL, migration owner and dummy roles
  migrations/    immutable registry versions, references, jobs/audit/receipts
scripts/         verification, schema generation, restore and repository guards
tests/           unit/security, real DB integration, synthetic fixtures
docs/            architecture, diagrams, contracts, security, ADRs, P1 plan, evidence
```

ADR 004 explains this compact Python package layout instead of empty folders for every future feature. A worker, research runtime and real Vault writer are deliberately later implementations, not fake stubs returning success.

## Schema changes and synthetic data

Python models are the schema source of truth. Change them deliberately, regenerate via `uv run --frozen python scripts/export_schemas.py`, review the diff and migration impact, and run tests. Regenerate fictional fixtures with `uv run --frozen python scripts/make_fixtures.py`. JSON Schema files are checked for drift. The first P1 slice now enforces typed, version-pinned references for ten synthetic draft kinds; later kinds remain disabled.

`tests/fixtures_synthetic/vault` contains a synthetic marker and one unverified example. No real Vault is mounted by Compose. Portfolio fixtures are explicitly fictional/confidential; all model/market adapters are interfaces only.

## Operations

- View state: `scripts/compose.sh ps -a`; migration exit 0 is expected.
- Stop while preserving DB: `scripts/compose.sh down`.
- Backup/restore + migration reversal drill: `uv run --frozen python scripts/restore_drill.py`. It seeds one fictional company in the P0 DB and creates/removes its own temporary restore database only.
- Delete **only this disposable synthetic stack** when intentionally resetting local tests: `scripts/compose.sh down --volumes`. Never run this against a real data deployment. No old evaluation/budget ledger is touched by these commands.
- If the first DB initialization is interrupted, do not pretend migration passed. Inspect logs and retry after resolving the error; only an explicitly disposable synthetic volume may be recreated.

See [operations](docs/operations/LOCAL_DEVELOPMENT.md), [status and actual test evidence](docs/IMPLEMENTATION_STATUS.md), [system architecture](docs/SYSTEM_ARCHITECTURE.md), [data model](docs/DATA_ARCHITECTURE.md), [security](docs/SECURITY_MODEL.md), [ADRs](docs/adr/README.md), [diagrams](docs/diagrams/README.md) and [P1 plan](docs/P1_TECHNICAL_PLAN.md).
