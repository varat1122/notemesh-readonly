# P1 milestone 3 — Deterministic excerpts and citation readback

Date: 2026-10-23. Full Phase P1 remains incomplete; this milestone covers extraction and attribution using synthetic originals only.

## Delivered

- Actual PDF page-text chunks, CSV field values with logical/physical row locations, and XLSX raw cell values with sheet/cell locations.
- Stable excerpt UUIDs, original/document/output digests and exact parser-version metadata; original numbers are not rounded through floats.
- Immutable derived checkpoints with producer/time metadata and safe replay; document/source registry records and original bytes remain unchanged.
- Fresh-original citation verification, including rejection of forged excerpts, changed bytes, unknown IDs and mismatched parser environments.
- Explicit empty-text/page notices, output budgets without silent truncation, typed contracts/JSON Schemas and ADR 013.
- Runnable `scripts/extraction_demo.py`; `scripts/check.sh` now runs it twice after the intake demo.

## Actual validation

Targeted new checks: **28 passed**, including **12 actual PostgreSQL integration tests**. They cover all three formats, Thai/multiline CSV, exact long numeric XLSX lexemes, shared strings/booleans, page chunk reconstruction, no-text PDFs, locator ambiguity, resource budgets, authorization, original/checkpoint corruption, forged but self-consistent excerpts, concurrent replay, revision pinning and injected derivative-write failure. Two separate demo processes produced identical JSON output.

**Implemented slice: PASS.** Actual evidence is in [validation/p1-extraction/](validation/p1-extraction/).

| Check | Status | Observed result |
|---|---|---|
| Full automated suite | PASS | **219 passed, zero skipped**, one pre-existing Starlette/httpx deprecation warning; 69 real PostgreSQL integration tests |
| New extraction and source attribution | PASS | 28 new tests; tampered originals, forged excerpts, stale profile and unknown citation rejected |
| Restart/concurrency/fault recovery | PASS | Two demo processes give identical output; concurrent extraction writes one checkpoint; write failure preserves source and database |
| Frozen install, lint/format, schemas and bounded repository scan | PASS | scripts/check.sh exit 0; no matched credential pattern or unexpected repository data binary |
| Docker Compose and HTTP | PASS | API/DB healthy, migration exit 0, readiness/authorization checks pass; image digest recorded |
| PostgreSQL backup/restore | PASS, DB only | Seven table digests match actual pg_dump/pg_restore; migration down/up/repeat-up passes |
| Draft PR and GitHub CI | Pending actual remote attempt | Local PASS does not establish remote CI; publication result follows below |
| Full P1 / production readiness | NOT COMPLETE | Semantic reconciliation, financial normalization, real grants and coordinated object/DB recovery remain open |

Commands run from investment-os/:

```bash
UV_CACHE_DIR=/workspace/.cache/uv-greenfield scripts/check.sh
uv run --frozen python scripts/extraction_demo.py
```

A demo citation for the fictional value 123.45 points to PDF page 1, CSV record 2/column 3, and worksheet `Synthetic` cell `C2`. Source hashes, IDs and output hashes are recorded in demo evidence, not invented examples substituted for execution.

## Limits and next steps

PDF offsets refer to extracted text, not visual coordinates or original PDF bytes. OCR/table reading order is not implemented; no-text pages and OCR limitations are exposed. Excel date serials/styles stay uninterpreted, CSV values stay strings, and no units/currencies/business dates are inferred. Readback does not verify investment facts and cannot promote protected evidence.

Next P1 work is source/event duplicate-versus-correction reconciliation with a human review boundary, followed by controlled Claim/Evidence proposals and financial normalization. Real auth/grants, source rights, coordinated original+DB recovery and production hardening remain prerequisites for actual private/licensed inputs. P0 external PR/CI/visual review gates are unchanged.

## GitHub

Repository: varat1122/notemesh-readonly. Branch: codex/investment-os-p1-extraction-20261023, based on intake commit 28ee279a4d6fb2441734f9175cbb5ca148d89339. Intended stacked Draft PR base: codex/investment-os-p1-intake-20261022. Actual publication outcome is recorded after the attempt. No merge or deployment.
