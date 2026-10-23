# Investment OS — consolidation and controlled closed-loop acceptance

Client date: 2026-10-23, Asia/Bangkok. Scope: existing PR #108 branch, offline
controlled sources and synthetic Vault only. **No production readiness claim.**

## Executive finding

The major delivery problem was developing/reporting from the old main checkout
while the existing stacked feature branch already contained the operational
path. This session resumed that branch instead of implementing another engine.
The existing core works without a paid model API when ChatGPT or a controlled
structured-analysis fixture supplies the draft.

**Result: PASS for the isolated synthetic Source A → context → analysis →
authorized write → persistent graph readback → Source B recall workflow.**
Real-source, live ChatGPT action publication, staging and production acceptance
remain separately gated. Release is **BLOCKED** by current dependency audit and
unverified latest remote CI, not by a requirement to use paid inference.

Machine-readable evidence and per-module decisions:
[consolidation-acceptance.json](validation/consolidation-acceptance.json).

## A. Preflight, continuity and development-loop audit

Initial checkout: branch `work`, HEAD
`b563c55fd99c5fb2738fda0682f7b6f76a0ef42a`, matching remote main. Sixteen pre-existing
untracked P0 files were hashed before operations and preserved byte-for-byte.
The same evaluation ledger/identity and development state remained available.
No reset, new checkout/workspace, worktree, stash, destructive cleanup or history
rewrite was used.

`AGENTS.md` and `docs/CODEX_MASTER_HANDOFF.md` were absent on that main snapshot
but present on the existing PR #108 source. The North Star, handoff, real-event
runbook, current P0 status/development/ADRs and actual code were read. The original
blueprint was also found in the existing remote greenfield branch; its full
SHA-256 matches the earlier attached document:
`e2abf6a2c31d997b1e05f0b31b529c2707cf0ddce461f4483049f14936e53130`.

All PR refs #84–#108 were fetched additively into the **same** Git object store.
Every successive head contains the preceding PR; #108 contains all #84–#107.
Current main is now a Git ancestor of #108, including reconciliation commit
`5173086`. Older handoff descriptions of content-only reconciliation/divergence
are historical, not current findings. The cumulative main→#108 diff still spans
258 files and needs release review; this is not permission to merge the stack.

The existing remote branch was resumed locally as
`feat/real-event-context-to-writeback-handoff-20261021`, source parent
`dd89be9c00bfc248c5d103c9eea327535febc372`. The PR is historically/user-reported
Draft; live Draft/open/base/check state could not be confirmed because
`gh pr view` returned `Forbidden` from `api.github.com/graphql`. Git refs prove
source/ancestry, not current PR administration or CI success.

| PRs | Incremental capability / disposition |
|---|---|
| #84–#88 | Historical change/narrative/brief/thesis/excerpt variants: preserve, consolidate operator entry through real context preparation; no new review engine. |
| #89–#97 | Semantic judges, benchmark/evaluation, exception/triage, synthetic orchestration, multi-claim/economic/reasoning wrappers: mostly DEFER; do not add them as prerequisites to core writing. |
| #98–#102 | Offline link plans, writer rehearsal/handoff, next-retrieval and Markdown formatting: retain useful helpers, consolidate delivery through actual MCP/Safe Edit. |
| #103–#105 | Independent authenticated graph verification, scoped bundle and actual next-event recall: KEEP as core assets. |
| #106 | Existing security patch work retained; latest audit must be evaluated afresh. |
| #107 | Narrow separately authorized Timeline-only recovery: KEEP, no automatic partial retry. |
| #108 | Source-first context preparation, source-hash binding and integrated core: COMPLETE controlled acceptance on this branch, not a production release. |

Loop findings:
- The serial stack is not 25 independent competing implementations; cumulative
  diffs must not be counted as repeated implementation. However, many offline
  wrappers each add a separate interface/test/document for adjacent review tasks.
- Repeated credential troubleshooting did not deliver the chosen workflow and is
  now paused. The standalone Python pilot runner is not another core engine.
- The uncommitted P0 schemas/docs and separate Python/PostgreSQL greenfield
  branches overlap design effort. Preserve them, defer integration, and do not
  create another registry/writer to finish this particular loop.
- Scope checks, exact-source CAS, guarded writer and independent readback protect
  different boundaries. They were not removed or collapsed into a model boolean.
- Stop extra benchmark corpora, schema-only layers, new model providers/local
  LLMs, PR proliferation and repeated full-suite runs without an acceptance goal.

## B. Canonical asset inventory

| Capability / module | Decision | Delivery choice |
|---|---|---|
| Original bytes — `research-source-archive`, `research-source-fetch`, `user-attachment-vault` | KEEP | Preserve current bytes/hash/revision implementations; do not replace Markdown Source identity with an attachment or URL alone. |
| Source/evidence identity — `source-observation-receipt`, `investment-claim-review`, `investment-writeback-router` | KEEP | Existing indexed records, bounded claim/event candidates and explicit verification status. A duplicate candidate is not semantic proof. |
| Historical context — `investment-context` | KEEP | One actual-note retrieval path, including Current Thesis, Evidence Register, source and archived-AI roles. |
| Review preparation — `investment-review-preparation` | KEEP | Read-only actual Source version + context + canonical destinations. |
| Two-note save — `investment-graph-bundle` | COMPLETE | Existing host-authorized Analysis + living Timeline action; controlled acceptance passed. |
| Mutation mechanics — `safe-edit/engine`, `safe-edit/sync` | KEEP | Existing CAS, approval, journal, backup, partial-state and Sync boundary. No alternate writer. |
| Independent verification — `knowledge-graph-readback` | KEEP | Actual operation receipts, physical bytes, FTS, canonical links and backlink checks. |
| Existing MCP resource — `mcp/safe-edit-server` | KEEP | Preserve scopes, annotations, feature gates and existing actions. |
| Legacy combined chat intake — `cloud-intake`, `intake`, save resource | CONSOLIDATE operator routing | Preserve compatibility; a combined imported AI analysis is not a separately authenticated source. No new intake implementation. |
| Offline plan/rehearsal/handoff/retrieval variants | CONSOLIDATE | Prefer the authenticated core for acceptance; no deletion or speculative refactor. |
| Offline economic judges, multi-claim orchestration, signature/enrollment and benchmarks | DEFER | Not dependencies of this controlled core workflow. |
| Older synthetic writeback rehearsal and external hand-written paid runner | REMOVE CANDIDATE | Review consumers/archival needs first; no files removed. |
| Native optional OpenAI adapter/readiness/budget | DEFER / BLOCKED reconciliation | Retain future integration; no calls or ledger repair in this work. |
| Separate greenfield P0/P1 registry/intake/extraction/text-review branches | DEFER integration | Existing Python/PostgreSQL capabilities are real code, not absent. Their dated local test reports were inspected, not rerun or accepted as this workflow's evidence. No merge, duplication or deletion. |

All 29 `vault/offline-*.ts` implementation modules and 18 relevant core/API paths
have individual classifications in the evidence JSON. Decisions concern the
current delivery path; they do not erase distinct legitimate future use cases.

## C. OpenAI optionalization and ledger preservation

The five development questions were answered before the narrow change:

1. **Already supported?** Yes: existing #108 preparation, context, bundle, engine
   and independent readback implement the runtime path.
2. **Proven gap?** The existing acceptance fixture initialized an evaluation
   campaign despite the current freeze; the single-loop evidence did not directly
   assert Current Thesis/Evidence retrieval or fresh-process persistence.
3. **Necessary for acceptance?** Yes: run that same loop without budget bootstrap,
   demonstrate the requested history/persistence and actual partial failure.
4. **Smaller correction?** Modify the existing test only; do not refactor runtime
   services, add dependencies, build a replacement engine or open another PR.
5. **Measurable done?** Actual MCP writes/receipts, independent bytes/FTS/links,
   next-event non-independence and refusal/partial cases, with frozen ledger hashes.

Runtime production paths for context preparation, dedup/evidence matching, graph
write and readback do not call the paid model adapter. ChatGPT/human reasoning
supplies structured draft content. Fully autonomous analysis/evaluation would
need a separately authorized model runtime and remains DEFERRED.

The existing core integration test unnecessarily bootstrapped a temporary paid
evaluation budget/campaign even for its offline fixture. That bootstrap and its
cost assertions were removed **from this test only**. The existing injectable
structured-analysis validation seam remains, using a controlled callback; no
campaign/ledger is created and a fetch spy asserts zero external calls in the
closed-loop case. Native provider/budget implementations were not removed or
rewritten, and their paid entrypoints were not executed.

The preserved live campaign remains
`investment-os-openai-evaluation-new-17e04411`, with one historic completed request,
eight uncertain reservations totalling USD 8, and a historic successful-call
token estimate of USD 0.000038. Reservations are **not confirmed provider charges**.
No release/reconciliation/reset of them occurred. New inference cost in this work:
zero. Provider invoice reconciliation remains unverified.

Read-only compatibility finding: the native budget adapter still names the older
`investment-os-openai-evaluation-20261021`, expects an `audit` hash-chain table and
`campaign`/`identity` sentinel keys. The retained new ledger instead has
`campaign`, `requests`, `events` and `campaign_id`/`ledger_uuid` metadata. Do not
run its initialization/status/paid commands to bridge this difference. Future
reconciliation is BLOCKED pending its own explicitly authorized evidence-based
plan; it is not necessary for core delivery.

Ledger/identity hashes before and after this work are identical, respectively:

```text
344b1c34c22c3db0726ec4c041a1e5d1b0c783dea97ff84613d5b28342561371
052b05f9cf99be994066d337af4bf210918613e7c1368e5096533a9ad91d3b3d
```

The environment runtime remains on its previously published version; its existing
P0 setup/start draft was inspected but not changed or published. No secret,
network policy, credential binding or provider account was changed.

## D. Core acceptance and exact limits

The existing test `single host-authorized Investment Graph bundle uses two
existing Safe Edit writes, reads back and never repeats` now demonstrates:

| Criterion | Observed controlled behavior |
|---|---|
| 1. Capture Source A | Actual MCP `create_note` preview then authorized `apply_edit`; exact original text, issuer/event/period/source metadata and readback/reindex. |
| 2. Identity/dedup | Existing source-bound preparation; saved-event hold and replay of identical operation without another Timeline item. |
| 3. Historical evidence/thesis | Real indexed synthetic Current Thesis, Evidence Register, Company and historical primary-labelled fixture are asserted in context; protected reference hashes remain unchanged. |
| 4. Evidence-linked context | Actual preparation produces original Source SHA, excerpts, canonical destinations and separate historical roles. |
| 5. Analysis input | Controlled structured analysis callback consumes the actual handoff; mismatched source/citations/false-independence drafts are rejected. No live model reasoning claim. |
| 6. Authorization | Existing scoped MCP/handler checks plus feature-disabled rejection; analysis output itself never grants write authority. |
| 7. Existing write path | Existing two-note bundle calls real Safe Edit engine for Analysis and existing Timeline in one temporary synthetic Vault. |
| 8. Persistent readback | Source/Analysis/Timeline bytes, hashes, FTS, resolved links and Timeline backlink verified; a fresh OS process reopens SQLite read-only and independently reads hashes and links. |
| 9. Receive Source B | Actual second source preview/apply with distinct event identity. |
| 10. Next-event reuse | Preparation retrieves Analysis A as `role=analysis`, `archived_ai`, `independent_evidence=false`, distinct from the primary-labelled historical fixture. |

Critical cases: missing scopes/admin flag, wrong issuer, Source SHA/index drift,
duplicate event, source rebinding and incomplete graph receipts are refused.
The existing partial-recovery test now also injects a real second-note rename
failure after the actual Analysis commit. Analysis remains persisted, Timeline
bytes remain unchanged, the journal says `writing`/pending, graph status says
manual reconciliation, and another recovery call executes no write. No automatic
retry/rollback or false full-graph success is accepted.

The first attempt to inject that fault matched a caller absolute path and did not
trigger: the existing writer correctly uses a directory-FD path. The test was
corrected to match only the synthetic target basename and explicitly assert the
fault occurred. The final assertions pass without changing runtime code.

Validation on the existing #108 source plus this reviewed patch:
- Frozen install: PASS, signatures/checksums/TLS policy retained, no dependency edits.
- Lint/typecheck: PASS. Build: PASS with clean prerender/client/runtime guards.
- Relevant integration/regression: **111 passed / 111, six files, zero skipped**.
- Dependency audit: **FAIL, 2 high and 14 moderate findings, zero critical**.
  High finding: Zod [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5),
  oversized constrained-collection memory exhaustion; the advisory lists a fix in
  `>=4.6.6`. This includes existing v3/direct and v4/transitive paths. Do not
  blindly force the direct v3 API to v4 or add an ignore entry. Scoped security
  remediation/review is a release prerequisite and was not hidden as a pass.
- Full suite, browser E2E, Docker and latest remote CI were not rerun/verified.
  No release is proposed. Prior 1,408 main tests are not transferred to #108.

### Reproduce the controlled acceptance

From the checked candidate branch in this same checkout, use Node 24, frozen
pnpm 11.16.0 installation and a private synthetic test environment. The run used
one worker, a 15-second default timeout and workspace TMPDIR (the cloud `/tmp`
mount differs from `/`). No `NM_EVAL_*` or real sync/provider values were passed
to the runner. Equivalent command after supplying a synthetic app encryption key:

```bash
pnpm exec vitest run \
  src/server/mcp/safe-edit-server.test.ts \
  src/server/safe-edit/knowledge-graph-readback.test.ts \
  src/server/safe-edit/engine.test.ts \
  src/server/vault/investment-context.test.ts \
  src/server/vault/investment-writeback-router.test.ts \
  src/server/research-source-archive.test.ts \
  --maxWorkers=1 --testTimeout=15000
```

Logs and full JSON results are retained under
`/workspace/.investment-os-foundation/consolidation/`. The repository evidence
includes source hashes, test purpose/mapping, ledger preservation and PR/module
inventory. Tests clean up only their own temporary fixtures, not the user's
workspace or evaluation state.

**Boundary:** the daemon pause boundary is stubbed; OAuth contexts are controlled
fixtures, not a live user consent/token exchange. Declared primary metadata is
fictional and proves classification separation, not issuer authenticity. This
does not prove real ChatGPT action availability, source truth, production
authorization, economic reasoning quality or remote/device Sync.

## E. Bounded roadmap and owner approvals

Immediate: controlled core acceptance is closed; retain its single canonical
path and reproducible checks. Resolve the inherited security advisory and obtain
current PR/CI/release review before staging or release. Do not expand the system
to avoid these blockers.

Next: owner chooses an exact non-sensitive real source, duplicate classification,
test Vault, reviewed candidate, scope/backup and staging/action publication if
needed. Then ChatGPT supplies actual cited analysis through existing tools and
the same bounded readback/next-event acceptance is repeated. Live Vault writes,
credentials, deployments and action/config publication need separate approval.

Later: only evidence-justified Quant, Portfolio, Monitoring and optional autonomous
research. Preserve the separate PostgreSQL/ingestion work for an explicit future
integration decision; do not rebuild those capabilities here.

P0 foundation schema/architecture ratification is **not recorded**. Neither the
owner's consolidation instruction nor synthetic acceptance is treated as that
approval or as a new standing protected-write policy.

## F. Git, preservation and handoff

Development changes are limited to the existing core integration test, the
owner's consolidation policy in root AGENTS, this report and its bounded evidence
JSON. No runtime production module, dependency declaration, lockfile, ledger or
credential is changed. New code is a readonly persistence/fault acceptance check,
not a second writer or service.

The reviewed changes are committed locally on the existing PR #108 branch;
commit identity is supplied in the final handoff. No push, PR creation/closure,
force push, main merge, deployment or environment publication occurs. The original
16 untracked P0 files remain uncommitted and byte-identical; they are not silently
staged with this work. Their earlier main-only status is superseded by this audit,
not erased or rewritten.

Remaining risks: inherited Zod audit failure; blocked latest GitHub metadata/CI;
large existing stack review; unratified foundation schema proposals; ledger/API
adapter incompatibility for a future paid restart; and all real-source/live
authorization/device-sync acceptance. **Synthetic core PASS, release/live gate
BLOCKED, Production Ready NO.**
