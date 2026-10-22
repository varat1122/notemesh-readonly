# P1 milestone 1 — Synthetic transactional registry

Date: 2026-10-22. **Implemented slice: PASS. Full Phase P1: incomplete.** Historical P0 results remain in IMPLEMENTATION_STATUS.md; they are not current test counts.

## Delivered

- A real PostgreSQL repository for ten unverified synthetic entity kinds, with a stable canonical serializer and explicit typed reference extraction.
- Atomic version/payload/reference/operation/audit persistence, actor-bound idempotency, stale-write rejection and serialized concurrent creation.
- Version-pinned references, readback hashes for payload and reference projection, source/document and issuer/claim/evidence consistency checks.
- Migration `0002_registry`, a repeatable CLI demonstration and stronger actual database restore checks. Public HTTP API stays read-only.
- ADR 011 documents encoding, consistency, trust boundaries and limits. No dependency or provider change.

## Actual validation

Run from `investment-os/`; evidence is in [validation/p1-registry/](validation/p1-registry/). All records are fictional. The test suite appends unique synthetic IDs; it does not truncate history.

| Check | Status | Command / observed result |
|---|---|---|
| Full automated suite | PASS | `IOS_TEST_DATABASE_URL=postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:55432/ios_synthetic .venv/bin/pytest` — **126 passed, zero skipped**, one upstream Starlette/httpx deprecation warning |
| Real PostgreSQL coverage | PASS | 33 registry integration tests plus 9 existing SQL tests within the full run; no mocked persistence |
| Concurrency and rollback | PASS | Same request commits once; competing creates/updates have one winner; injected audit storage failure leaves all transaction tables unchanged |
| Scope/security enforcement | PASS within synthetic scope | Reader/forged actor/protected kind/real provenance/rights expansion/classification downgrade rejected; raw P0 rows not silently adopted |
| Repeatable demo | PASS | `.venv/bin/python scripts/registry_demo.py`, run twice: ten original records and revision two; second run replays original operations; fresh-engine readback and stale-write denial |
| Backup/restore | PASS, PostgreSQL only | `.venv/bin/python scripts/restore_drill.py` — seven table digests match after pg_dump/pg_restore; migration downgrade/upgrade and repeat upgrade pass in a temporary restored DB |
| Frozen install / lint / format / schema drift / bounded secret scan | See evidence manifest | Commands and final observed statuses recorded in validation/p1-registry/evidence.json |
| Compose and local HTTP readiness | See evidence manifest | API readiness requires migration 0002_registry; no remote deployment |
| Draft PR and GitHub CI | BLOCKED pending observed remote result | Branch publication and PR attempt are recorded below after execution; no CI success inferred from local tests |

## Limitations and next work

This is a library and local synthetic demo, not a complete intake product. No document bytes have been captured/validated, no parser or durable job runner exists, no real principal or upload grants are configured, and no verified Evidence Register or protected thesis is writable. Production least-privilege writer roles and durable denial audit remain open. The schema owner remains trusted. Semantic reconciliation, cyclic graph policy and multi-entity snapshot requirements need later design/implementation.

Next P1 work: bounded synthetic PDF/CSV/XLSX intake into a local content-addressed object store, quarantine and byte hash readback, followed by safe parsing and exact excerpt locators. Use the existing P1 plan; real accounts/data, paid inference and production/Vault integration remain separate authorization boundaries. Owner schema sign-off and prior P0 visual/remote checks remain outstanding.

## GitHub

Repository: `varat1122/notemesh-readonly`. Working branch: `codex/investment-os-p1-registry-20261022`, based on P0 commit `12768c4975ef418239ce86cc7da2a0fdcf00401d`. Intended stacked Draft PR base: `codex/investment-os-greenfield-p0-20261022`. Publication outcome is recorded after the actual attempt. No merge or deployment.
