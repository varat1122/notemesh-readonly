# Product requirements — P0 baseline

Baseline: [MASTER_BLUEPRINT.md](MASTER_BLUEPRINT.md), v1.0.0, 2026-10-22. The supplied file is preserved verbatim. This document makes its phase boundary executable; it does not replace the blueprint. Architecture changes use ADRs. Product owner approval of detailed schemas is still pending.

## Outcome and users

Investment OS turns data into evidence, insight, thesis, mandate-specific decisions, outcomes and learning. The owner, researcher, curator, independent risk reviewer and portfolio analyst share canonical identities and evidence. An AI frontend is a client; it does not own persistence or grant authority.

The knowledge loop is Event → historical context → review → typed links → approved write → readback → next event. The decision loop is research + quant + tactical + independent risk → proposal → authorized decision/ledger → outcome → attribution → review. A profitable trade does not verify a business claim. An AI review does not create independent source evidence.

## P0 requirements and traceability

| Requirement | Implemented artifact | Gate / later implementation |
|---|---|---|
| P0.1 isolated project | `investment-os/`, pyproject, lock, README | Existing NoteMesh files/history unchanged |
| P0.2 architecture | SYSTEM_ARCHITECTURE, diagrams | Render Mermaid; owner design review remains |
| P0.3 canonical identities | domain entities, JSON Schemas, synthetic examples | UUID, version, chronology, provenance tests |
| P0.4 storage ownership | DATA_ARCHITECTURE, ADRs 1–3 | PostgreSQL migration; Parquet roundtrip; no real Drive |
| P0.5 security | SECURITY_MODEL, policy, read-only local adapter | Denial/path/role/log tests; no production authentication claim |
| P0.6 reproducible development | uv.lock, Dockerfile, Compose, Alembic | Install, HTTP readiness, real PostgreSQL tests |
| P0.7 interfaces | ports/contracts.py, API_CONTRACTS | JSON Schema; Protocol definitions; no engine runtime |
| P0.8 decisions | ADR 001–010 | Accepted within P0 vs proposed vs owner approval |
| P1 preparation | P1_TECHNICAL_PLAN | Ordered implementation and stop conditions |

## Invariants

1. Stable UUID identity; ticker + venue + effective period is an alias. Never merge ambiguous matches automatically.
2. Preserve original source bytes and rights; URLs/hashes do not establish publisher truth.
3. All model output is a draft; distinguish facts, quotes, estimates, user views and AI hypotheses.
4. Canonical logical truth across stores; ownership and derived indexes are explicit.
5. Versioned artifacts and point-in-time availability; unknown time stays null.
6. Research and tactical mandates remain separate; risk can disagree; no forced consensus.
7. Protected thesis/evidence/portfolio changes require separate human authority. No standing auto-save.
8. No market/consensus data means no invented price-in, valuation precision or quant performance.
9. Committed means durable physical/index/link checks, not a model's success statement.
10. Models, market data and storage vendors sit behind internal contracts.

## What P0 does and does not do

P0 runs a synthetic-only API, DB schema, policy evaluator, contract validator and read-only synthetic Vault adapter. It defines logical schemas for later features without implementing ingestion, specialist orchestration, retrieval ranking, graph economics, writeback, quant strategy, decision scoring or portfolio accounting. There is no worker process because there are no jobs to execute yet. The module boundary is a typed interface, not an empty directory for each future feature.

Optional Web/Mobile/LINE/X integrations have design boundaries only. Bloomberg starts with user-authorized manual Excel/CSV, never an assumed Terminal API entitlement. No real Drive account, real Vault, broker, paid inference or production deployment is used.

## Acceptance interpretation

Implementation readiness is distinct from owner design acceptance, GitHub CI and production readiness. `IMPLEMENTATION_STATUS.md` records observed commands, failures/retries, skips and evidence. A missing tool or unavailable integration is BLOCKED, never replaced by a fabricated test. P1 real-data activation requires source rights/permissions; P0 tests cannot supply them.
