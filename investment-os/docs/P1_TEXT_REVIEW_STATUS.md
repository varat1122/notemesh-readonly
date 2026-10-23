# P1 milestone 4 — Synthetic text capture and paragraph review

Date: 2026-10-23. **Implemented local slice: PASS. Full P0/P1 acceptance remains incomplete.**

## Delivered

Strict UTF-8 `.txt` capture now preserves original bytes and unverified Source/Document records. A deterministic paragraph queue keeps exact numeric strings, Unicode offsets and physical line references. All items require human review; no year, unit conversion, fact/opinion classification or investment conclusion is inferred. Original PDF/CSV/XLSX capture policies and parser identities remain compatible.

The runnable `scripts/text_review_demo.py` creates a fictional eight-paragraph AI-spending example and an offline Thai HTML review document with source anchors and a review checklist. It reopens actual registered originals through fresh database/file connections to verify every citation. Drafts are immutable local derived artifacts, not verified Claim/Evidence records. There is no HTTP upload/write route or dashboard.

## Actual validation

Evidence: [validation/p1-text-review/](validation/p1-text-review/). Full command log: `/workspace/scratch/investment-os-p1-text-review-20261023/check.log`.

| Check | Result | Evidence |
|---|---|---|
| Full automated suite | PASS | **247 passed, zero skipped**; 78 actual PostgreSQL integration tests; one pre-existing Starlette/httpx deprecation warning |
| New text/review coverage | PASS | 28 new tests: Unicode/CRLF, exact financial lexemes, budgets, control rejection, source attribution, forged/corrupted sources, authorization, replay, concurrency and failure recovery |
| Frozen install, lint/format, schema drift and bounded secret/data scan | PASS | `scripts/check.sh` exit 0; no new dependency or migration |
| Docker Compose, migration and API | PASS | Rebuilt image; API and DB healthy; migration exit 0; HTTP health 200 and denied actions 401/403 |
| Original preservation and replay | PASS | Two separate demo processes produce identical JSON; old three-format demo captures also replay without resetting their store |
| Offline HTML safety and anchors | PASS | Escaped attack text remains text; links resolve to local IDs; original paragraph coverage checked; restrictive CSP |
| Browser visual review | BLOCKED / unverified | No browser rendering certification in this environment; HTML structure/links tested programmatically |
| PostgreSQL backup/restore | PASS, DB only | Actual dump/restore compares seven registry table hashes; migration down/up/repeat-up passes |
| Coordinated object/DB backup | BLOCKED | Marked object root is workspace-local; this drill does not back it up |
| GitHub Draft PR and remote CI | BLOCKED | Branch push succeeds; actual GraphQL PR creation and REST CI lookup return `Forbidden` at api.github.com |

Commands run from `investment-os/`:

```bash
UV_CACHE_DIR=/workspace/.cache/uv-greenfield scripts/check.sh
UV_CACHE_DIR=/workspace/.cache/uv-greenfield uv run --frozen python scripts/restore_drill.py
```

The first full run passed 246 tests. Subsequent review found a CRLF boundary case at a trailing newline; it was corrected, a regression test added, and the final full run above passed 247. Both full logs are retained. No failing result is substituted with a fabricated success.

## Remaining work and user workflow

See [Thai walkthrough](NEWS_TO_RESEARCH_GUIDE_TH.md) and [ADR 014](adr/014.md). This milestone prepares source-linked review material. It does not atomize all claims, establish truth, assign business dates, compare real reports, run AI research or approve thesis changes. The user-provided news passage was not relabeled as synthetic or published as a fixture; the demo uses different, entirely invented figures/providers.

Next: human duplicate/correction classification, atomic Claim/Evidence proposals with review authority, real-source identity/grants/licensing and coordinated original+database recovery. P0's outstanding external PR/CI, visual architecture review and owner review gates are unchanged. No paid model call, real Vault/credential modification, budget-ledger operation, merge or deployment.

## GitHub

Repository: `varat1122/notemesh-readonly`. Branch: [codex/investment-os-p1-text-review-20261023](https://github.com/varat1122/notemesh-readonly/tree/codex/investment-os-p1-text-review-20261023), based on extraction commit `7c376149a5cf366a17d8a724439ac9768450b3cd`. Tested implementation commit `8e2f570d95379b9331ab6d5a9feb2d23e1a4582f` was pushed successfully. Intended stacked Draft PR base: `codex/investment-os-p1-extraction-20261023`.

Actual `gh pr create --draft --body-file docs/P1_TEXT_REVIEW_PR_DESCRIPTION.md` failed with `Post https://api.github.com/graphql: Forbidden`. The branch Actions runs REST lookup likewise returned Forbidden. No Draft PR URL exists and no remote CI result is asserted. [Publication evidence](validation/p1-text-review/github.json) records these outcomes. A documentation-only follow-up records them on the same branch; no merge or deployment.
