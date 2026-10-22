# P1 milestone 2 — Bounded synthetic original-file capture

Date: 2026-10-22. This is a local synthetic intake slice, not completed Phase P1 or a production upload service. The registry milestone and P0 evidence remain separate historical reports.

## Delivered

- Actual generated PDF/CSV/XLSX bytes, inspected before acceptance and stored unchanged in a marked, owner-only local object root.
- Separate quarantine, content-addressed originals, SHA-256 readback, checksum-protected append-only checkpoints and same-key replay.
- Static-content allowlists and bounded parser subprocesses with credential-free environments; malformed/active/oversized archive cases are rejected or quarantined.
- Document/Source registration through the existing PostgreSQL repository; both remain unverified with synthetic-only/local-research rights and unknown business dates preserved.
- Explicit partial recovery between filesystem, Document transaction and Source transaction. No false combined transaction claim and no premature successful receipt.
- Repeatable `scripts/intake_demo.py`, new contract JSON Schemas and ADR 012. The existing check.sh runs the demo twice; its GitHub workflow inherits this validation.

## Validation

**Implemented slice: PASS. Full P1: incomplete.** Observed evidence is in [validation/p1-intake/](validation/p1-intake/). Tests exercised valid formats, malformed/active content, symlinks/traversal/FIFO, immutable collision, tampered checkpoint/original, process restart, concurrent retry and injected failures before promotion, during Source registration and before final checkpoint.

| Check | Status | Observed result |
|---|---|---|
| Full automated suite | PASS | **191 passed, zero skipped**, one pre-existing Starlette/httpx deprecation warning; 57 real PostgreSQL integration tests included |
| New intake coverage | PASS | 65 new tests: format guards, local store and 15 real PostgreSQL capture tests |
| Restart and repeatable demo | PASS | Three captured originals and one quarantine; a second Python process replays all four with unchanged IDs/digests |
| Frozen install, lint/format, generated schemas, bounded secret scan | PASS | scripts/check.sh exited 0; no matched token pattern or unexpected dataset in deliverables |
| Docker Compose + HTTP | PASS | Built image recorded in evidence.json; API/DB healthy, migration exit 0, HTTP health and authorization checks pass |
| PostgreSQL backup/restore | PASS, DB only | Seven table digests match actual pg_dump/pg_restore; migration down/up/repeat-up passes in temporary restored DB |
| Coordinated object + DB backup, real grants, text extraction | NOT IMPLEMENTED | Explicit later gates, no success claim |
| GitHub Draft PR and remote CI | BLOCKED | Branch pushed successfully; actual GitHub GraphQL/REST attempts return Forbidden at api.github.com. No PR or remote CI success claim |

Run from investment-os/:

```bash
UV_CACHE_DIR=/workspace/.cache/uv-greenfield scripts/check.sh
uv run --frozen python scripts/restore_drill.py
```

`check.sh` installs the lock, checks lint/format/schema drift, scans repository text, builds/starts local Compose, runs all tests against actual PostgreSQL, checks HTTP health/denied actions, and runs the intake demo twice. The demo creates three accepted originals and one quarantined invalid PDF; retries reuse the same records. Files remain under ignored `artifacts/synthetic-intake-v1/`. Do not delete that root to repair an error: it contains the stable request/import checkpoints.

## Boundaries and next milestone

Source byte capture and structural inspection are implemented; extracted text/tables/cell locators, semantic dedup/corrections, source verification and general intake grants are not. Native Windows is not supported by the POSIX store/worker. The dummy operator is trusted and total storage quotas, malware scanning and coordinated object/database restore remain open. The fixture label is not an authorization system. There is no HTTP file upload endpoint and no provider, real Vault or paid inference call.

Next: deterministic extraction into bounded page/CSV-row/worksheet-cell excerpts, each bound to original hash and parser version. Then semantic reconciliation and human evidence review. Keep using generated fixtures until real authentication, source scope and licensing are explicitly addressed. Local workspace persistence is not durable backup across environment replacement.

## GitHub

Repository: varat1122/notemesh-readonly. Branch: codex/investment-os-p1-intake-20261022. Base: registry milestone 87c36f0f95df0a02bf959d395bd1a4edc93a1929. Intended stacked Draft PR base: codex/investment-os-p1-registry-20261022. Implementation commit `ed5fec12f0bff4e1b81ff181876b81dd59ea1fbd` was pushed successfully. Branch: https://github.com/varat1122/notemesh-readonly/tree/codex/investment-os-p1-intake-20261022 . Actual `gh pr create --draft` failed with `Post https://api.github.com/graphql: Forbidden`; the actions/runs REST lookup also returned Forbidden. No Draft PR URL exists and no remote CI success is claimed. A documentation follow-up records these observed outcomes. No merge or deployment.
