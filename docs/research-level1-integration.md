# Research Level 1 integration — IOS-ORCH-RI-001

Engineering candidate only. No Production, deployment, independent critic or Product GO.

## Immutable lineage

Main observed at `71cc4178607d717b403ffd143d3a01bff7c94758` is an ancestor of the Research source baseline PR178 `9167f54a2b2918d5a7480e514d3b7cea70e2e21a`. PR178 remains a tracker. This candidate restores the accepted 473-path tree `ff0a12e09470dfb2ec74253f1bf17237ed981518` on that verified ancestor; it does not merge old PR heads. Accepted archive SHA-256: `83c908d66630a1bfc6e18853c93dc686c2b17479d30876e4eb1eda32159f5c38`.

The exact supplied PIT v2 patch (`590ba3869383a21809c04ca25096e9e71f9af6c333a6f85b1f11f0588ce0173c`) reproduces tree `4fee81f981d6c27513507494ca3b9ce7fe7200dd`. Integration additionally closes pending-token withdrawal across canonical entrypoints. No package, lockfile, schema or trust policy change relative to the accepted source.

## Mechanical replay

Use a private disposable runner with no Production mounts or credentials, Node 24.22.2/ABI137, pnpm 11.16.0, git and native SQLite toolchain. Install the frozen lock with official integrity checks. Offline cache imports must use `--package-import-method=copy`; do not manually repair CAS or disable supply-chain verification. Application runs with network off except its own loopback.

```sh
pnpm install --offline --frozen-lockfile --package-import-method=copy
pnpm lint
pnpm typecheck
pnpm build
node scripts/research-level1.mjs /private/evidence/l1
```

The harness deduplicates files across L1-01…07 and runs their full scenarios (30s test / 120s hook bounds, two workers). It preserves logs, JSON results, signal/exit and log hash. A single case may be selected by appending its ID. The HTTP case performs real disposable Admin onboarding, OAuth consent, authenticated MCP and cold restart; no direct DB onboarding shortcut. Unit analyst/reviewer responses remain explicitly simulated. Company fixtures use TESTA/routine contact details; existing NVDA integration fixtures are synthetic, not issuer financial facts. Macro tests use Fictionland. No fixture is a real-source acceptance corpus.

Run the existing CI test, audit, image and browser jobs on the exact integrated commit separately; the focused harness is not a substitute. Legacy cross-version tests require the pinned git objects listed in CI. Keep first failures and report all skips. Existing Git child-lifetime restrictions remain subject to their strict tests; do not skip them or claim process containment from an API HOLD.

## Time and admission

`historyCutoff` is opt-in receipt-bound retrieval time, not analyst `knowledgeCutoffAsOf`, publication date or file mtime. It is sealed in the Judge input/body/history witness. PIT non-Source remains HOLD pending full source/event/reviewer time-binding authority. Source capture remains permitted when otherwise authorized.

Canonical PIT prepare/apply records a restrictive source-owned journal gate and advances the existing intake authority epoch. Old generic/canonical tokens cannot survive a PIT request, a Source-only PIT request, or an asynchronous Sync pause. Existing HOLD/FAIL is never replaced by PASS. Current-time reassessment requires the existing fresh sealed assessment and reviewer contract. No new reviewer identity or semantic authority is introduced.

## WORK / CHAT handoff (requires separate runtime grant)

1. Record candidate tree/commit, installed MCP descriptor digest, runtime image, isolated DATA_DIR/resource ID and OAuth issuer/audience. Disable external Sync and all Production/Prices bindings. Preserve the approved local-only C1 identity guard.
2. Authenticate a real principal with only the existing `vault:read`/`vault:edit` rights; authenticate the separate dashboard reviewer where required. API key/OAuth token possession is not proof of human review or model independence.
3. Capture authorized current-time original Source and exact locator/hash; obtain server packet, actual model analysis and typed risk assessment; prepare canonical writeback. Reviewer must inspect the exact bound diff. A material case missing critic remains Source-only/HOLD.
4. Apply exact operation IDs/tokens/CAS, inspect per-item status and real receipts, read back SHA/index/wikilinks, retry once for idempotency. Preserve appearance and zero independence increment for reposts. Never report Review saved solely from a preview.
5. Restart the disposable instance using the same resource/key under WORK authority. CHAT opens a genuinely new room and uses authenticated search/read/context against that resource, reporting provenance, as-of and restrictive Draft labels. Earlier chat content pasted into a new room is not proof.
6. L1-01, L1-02 and L1-06 require actual model/actor/fresh-room evidence; automated results do not replace them. All other real E2E rows also remain NOT_RUN until performed. The frozen eight-case quality A/B is separate.

## Stop / recovery

On stale seal/actor/scope, missing approval, integrity failure or unknown partial effect: stop non-Source apply and retain journal/receipts. Inspect `get_edit_status`; do not reset locks, rewrite receipts or auto-clear maintenance. Disposable cleanup only after preserving evidence and stopping owned processes. No merge/deploy or use of MA01 Source-only authority for Review.
