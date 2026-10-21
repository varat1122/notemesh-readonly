# Investment OS — Codex Master Handoff

**As-of:** 2026-10-21, Asia/Bangkok  
**Owner intent:** continuity of product decisions and engineering, **not** an approved Investment Thesis, a source of current financial facts, or permission to perform production operations.  
**Repository:** [varat1122/notemesh-readonly](https://github.com/varat1122/notemesh-readonly)  
**Vault:** `Investment_OS` (Obsidian); **not included as GitHub source files**  
**Status of this handoff:** instructions and a *dated snapshot*. Recheck latest GitHub HEAD, main, PRs, deployed SHA, CI, connector registry and permissions before acting.

> **The owner’s non-negotiable North Star:** make one complete, usable Investment Knowledge Graph loop, not another pile of disconnected validators or Draft PRs. **New Intelligence → historical Source/Thesis/Evidence recall → actual AI investment reasoning → selectively chosen exact Obsidian Markdown links → authorized Safe Vault Writeback → independently verified physical/FTS/link/backlink readback → retrieval and reuse at the NEXT event.**

## 0. The contract for Codex (read before any command)

1. Use this handoff **together** with [Product North Star](./INVESTMENT_OS_PRODUCT_NORTH_STAR.md), [Real-event Pilot Runbook](./REAL_EVENT_CLOSED_LOOP_PILOT_RUNBOOK.md), the actual code and Git history. Conflicts: **the owner's latest explicit decision and observed implementation/security constraints prevail** over dated assumptions here. Surface discrepancies; never silently improvise policy.
2. Start with a **READ-ONLY engineering audit** (actual checkout, tree, diff and history; test inspection). The owner initially requested that Codex *report evidence and next steps before making changes*. Do not silently treat this handoff as permission to edit or deploy.
3. When separately directed to implement development changes, work in a **dedicated non-production branch/worktree** and verify exact base/head. Prefer focused changes to existing code over another standalone experimental branch; run applicable Lint, Typecheck, Build, unit/integration, E2E and Docker tests, plus security audit.
4. **Never merge into `main`, retarget/publish a live App, deploy Railway, create/modify Production services or credentials, toggle production writer flags, run live Vault writes, modify protected investment notes, or incur paid model/API usage without the owner's separate explicit approval.** A broad “ทำต่อ” is permission for ordinary safe engineering work, **not** these escalations.
5. Do not ask the owner to paste API keys or secrets into chats, GitHub PRs, logs, files, or code. Use scoped secret configuration only after explicit approval.
6. **Do not auto-run paid model evaluation**: the owner's OpenAI API test remains **PAUSED** until explicit restart. Merely discussing Codex or Work is not budget approval.
7. Tests on synthetic or temporary Vault fixtures do **not** establish actual issuer authenticity, model investment judgment, Railway deployment, desktop/mobile Obsidian Sync, or a live production closed loop. Mark claims precisely.
8. The installed ChatGPT App/Plugin registry can lag server source; never claim a new MCP tool is callable from ChatGPT until actually visible and authenticated in that client.

## 1. Why this system exists

The owner wants an **AI-driven, institutional-grade investment research memory system**, not a generic stock chatbot, static Markdown exporter or note search. New items can be issuer filings, earnings/guidance, broker research, global macro, industry/supply chain, price action, portfolio observations or user interpretations.

For every material item, the system must:
- Recover *what was known before*, including the issuer's draft Current Thesis, Evidence Register, dated Company Evolution, original Source/Evidence, relevant Industry/Supply Chain, contradictory evidence and prior AI analyses.
- Judge whether the event is `new_event`, `duplicate`, `added_detail`, `correction`, `contradiction`, `unresolved` or genuinely thesis-changing. One issuer event reposted across notes is **one event**, not multiple independent observations.
- Analyze actual business/economic transmission: **Macro → Asset Class → Industry/Supply Chain → Company → Demand → Revenue Conversion → Gross Profit → Operating Profit → Earnings → Cash Flow → ROIC → Valuation → Portfolio**, *only where evidence supports the steps*.
- Resolve and link real canonical existing Markdown files, never fabricate wiki targets or indiscriminately link every mentioned company.
- Persist correctly attributed **Source and AI Analysis as distinct records** and append a new reference to the **existing Company Evolution**, without secretly overwriting a Thesis.
- Verify that bytes were written, SQLite/FTS matches physical notes, Wikilinks resolve to exact existing targets, timeline links back, duplicate/replay does not add another item, and the NEXT new event reads the previous saved analysis as **historical AI** only.

### What counts as done

**Not** “AI wrote a plausible investment paragraph,” “tests green,” “MCP returned a queued receipt,” or “Railway online.” Done requires a **genuinely authorized real-source pilot**, grounded model/human analysis, correct graph write, independent source/version/path/operation readback and later knowledge reuse; separate endpoint-device sync proof if cross-device completion is claimed.

## 2. Investment semantics / evidence discipline

### 2.1 Separate categories (never conflate)

- **User supplied**: an input and its authorial provenance; not automatically verified.
- **Issuer / primary / regulatory**: actual filing/IR/official original **read and checked**; a frontmatter label or URL alone is not independent authentication.
- **Management commentary/guidance** vs actual financial result.
- **Broker opinion/consensus/whisper**, **market expectation/positioning**, **price action**, **AI interpretation**.
- **Archived AI** (`source_type: archived_ai`, `independent_evidence: false`, often `verification: not_reverified`): historical reasoning, **not a second issuer fact**, not owner-endorsed Thesis.
- **Owner-approved changes** vs draft candidate notes.

Source preference: original company filings/IR → regulatory/official → call transcript → reputable reporting → named broker/industry research. Attribute dates and sources. When evidence is unavailable, state unknown, competing hypotheses, confidence, required evidence; do **not** fill facts in from intuition.

### 2.2 Institutional analysis questions

Use `Demand → Revenue Conversion → Gross Profit → Operating Profit → Earnings → Cash Flow → Return on Capital`. Inspect volume/price/mix, order-backlog-capacity-yield-delivery and concentration, incremental margins/operating leverage, SBC/dilution, CapEx/working capital and ROIC/cost of capital. Separate **Demand Risk, Conversion Risk, Execution Risk, Economic Risk, Balance Sheet Risk and Valuation Risk**. Identify the supported *primary bottleneck*, unlock, catalyst, invalidation, counter-evidence and magnitude/timing, if defensible.

Market reactions require **Fundamental Change vs Expectation Gap**. Without contemporaneous price, consensus and positioning, **do not declare what is priced in** or create a target price. Do not infer product gross margin from consolidated gross margin or equate announced spending with actual capacity/FCF.

Thesis delta: `New`, `Confirmation`, `Incremental`, `Contradiction`, `Thesis-Changing`, `Duplicate`; recommendations only when grounded. Protect analytical independence: never elevate AI text because it was copied into more notes.

### 2.3 Timeline and duplicate keys

Track event date, publication date, received/captured date, imported date and verified date **separately**; never use file-modified or ingestion date as news date. Deduplicate using issuer + original event + metric + reporting period + upstream source/vintage, not titles or content similarity alone. For added details/corrections preserve chronology and old record; do not create parallel Company Evolution timelines.

## 3. Boundaries: who does what

| Component | Responsibility | What it does NOT prove |
| --- | --- | --- |
| ChatGPT / model / research prompt | Semantic investment reasoning, source qualification, relevance, evidence versus hypothesis, selective related links | Does not guarantee file bytes, auth, actual original, or a safe write |
| NoteMesh on Railway | Authenticated MCP endpoints, access control, source/context fetch, safe edit, journal and SQLite index | Server online ≠ new Draft deployed; hash ≠ genuine issuer |
| `Investment_OS` Vault / Obsidian | Markdown historical knowledge, canonical graph, Source/Thesis/Timeline | A cloud-side save ≠ desktop/mobile arrival |
| SQLite/FTS & link resolver | Indexed metadata, exact paths/Wikilinks/backlinks, readback | Match ≠ economic truth; bounded recall ≠ entire Vault |
| GitHub / Codex | Source code, safe branch/test/release work | CI passing ≠ live AI+Vault acceptance |
| ChatGPT App/Plugin layer | OAuth and published tool registry, per-action host authorization | Server-defined tools ≠ actions published to connected ChatGPT client |

**No second unguarded writer.** Reuse the protected Safe Edit engine/paused Obsidian Sync, CAS/hash/version, journaling and feature gates.

## 4. Concrete architecture and code map

Open these files in the *actual checkout*; paths are from the 21 Oct Draft and can change:

- `docs/INVESTMENT_OS_PRODUCT_NORTH_STAR.md` — owner-confirmed North Star.
- `docs/REAL_EVENT_CLOSED_LOOP_PILOT_RUNBOOK.md` — source-first, preflight, restricted pilot, no-go criteria.
- `docs/REAL_EVENT_CONTEXT_TO_GRAPH_WRITEBACK.md` and `docs/SCOPED_GRAPH_WRITEBACK_BUNDLE.md` — preparation/writeback contract.
- `src/server/vault/investment-context.ts` — real indexed issuer-scoped history retrieval; draft PR adds `analysis` recall, while later `main` improvements added issuer metadata heuristics, curated industry links, extra legacy Company Index paths and research-event title relevance. **Check both changes survived reconciliation.**
- `src/server/vault/investment-writeback-router.ts` — read-only intake routing and source/event duplicate candidates; a candidate is **not** a verified duplicate.
- `src/server/safe-edit/investment-review-preparation.ts` — read-only source SHA, canonical Source/Company/Timeline paths, retrieved Current Thesis/Evidence Register/Industry and prior Archived AI; no model API or mutation.
- `src/server/safe-edit/investment-graph-bundle.ts` — guarded one-host-authorized action for Analysis creation + existing Company Evolution append; source hash lock, explicit partial recovery constraints.
- `src/server/safe-edit/knowledge-graph-readback.ts` — actual receipt, Markdown bytes, SQLite/FTS and reciprocal Wikilink checks.
- `src/server/safe-edit/engine.ts` and `sync.ts` — protected Safe Edit preview/apply, writer gate, CAS, journal, backup and paused/idle Obsidian Sync.
- `src/server/mcp/safe-edit-server.ts` — OAuth-scoped MCP read, inspection and mutating tools; inspect annotations and registry tests.
- `src/server/research-source-archive.ts`, `src/server/user-attachment-vault.ts` — original-byte archive/attachment integrity, distinct from a canonical Source Markdown record.
- `src/server/mcp/intake-tools.ts`, `src/server/cloud-intake.ts`, `scripts/intake-importer.cjs` — **legacy separate** submission path: importing combined chat analysis into `00_Inbox/ChatGPT` is not the source-first investment graph bundle.
- `src/server/mcp/safe-edit-server.test.ts`, `src/server/vault/investment-context.test.ts`, `.github/workflows/ci.yml`, `pnpm-lock.yaml` — test and CI gates.

**Important Vault schema compatibility (read-only metadata observed on 21 Oct):** existing `08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md` declares `company: NVDA`, not `entity: NVDA`. Graph preparation and writer in #108 were corrected to accept **consistent** company/optional entity fields and reject disagreement. Its FY27Q2 Primary Evidence Review has `status: source_verified_dedup_pending`, `source_sha256: null`, and no canonical `event_key`; **do not automatically relabel it a brand-new event**. NVDA draft Current Thesis/Evidence Register are `not_reverified`. Historical note dates are **not** a fresh-market fact check.

### 4.1 Example canonical paths (verify actual existence each time)

- Company Hub: `01_Companies/NVDA.md`
- Existing Company Evolution: `08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md`
- Draft Current Thesis: `05_Thesis/NVDA - Current Thesis.md` (reference only)
- Evidence Register: `05_Thesis/NVDA - Evidence Register.md` (reference only)
- New *proposed* analysis: `08_Daily_Weekly/Research Indexes/Investment Review - {ISSUER} - {EVENT_KEY}.md`
- Source-first staging: `10_Knowledge/Company Research/...md` if genuinely in-scope and existing/created via authorized tool; normal Safe Edit intentionally protects `07_Sources/`.

Always generate existing exact vault-relative `[[Full/Path/WithoutExtension]]` links and verify relevance; a guessed basename is not enough. General Safe Edit `create_note`/authorized `apply_edit` may be needed for a separate original text Source. Original downloaded external bytes, binary user attachment and Source Markdown have distinct provenance and APIs.

### 4.2 Safe graph mechanics and returns

Intended sequence:
1. Capture original user-provided source separately via preview/create then **separately host-authorized** `apply_edit`; ensure physical readback + reindex, do not mark authentic.
2. `prepare_investment_graph_review` — read-only, exact indexed Source and real context, detects existing event, returns source SHA and canonical paths/headings.
3. Actual evidence-grounded human/model **semantic reasoning** → complete provisional `investment_review` Markdown with original Source and Company/Timeline references, selective Industry/Thesis links, risk, alternatives and non-independence labels.
4. In an explicitly approved staging scope, `write_investment_graph_bundle` **must pass** `expectedSourceSha256` obtained at #2; feature gate off by default. Uses two protected note writes, **not atomic together**. Never silently retry a partial save.
5. `verify_investment_graph_writeback` with same OAuth actor, operation IDs and exact paths; confirms server-side graph, not remote device.
6. Capture a different event and re-run preparation: previously written Review is selected as `role=analysis`, `source_type=archived_ai`, `independent_evidence=false`. Same event replay must not add another event.
7. If first Analysis is durably written and Timeline **never started**, separate newly host-authorized `recoverTimelineOnly=true` may complete; if Timeline operation already exists, **manual reconciliation**.

Actual Source/prepared excerpt is bounded; avoid claiming it includes the **full original filing** or exhaustive historical coverage. If material source sections are missing, fetch/read those with approved provenance before analysis.

## 5. Historical engineering milestones — chronology, not live deployment

Earlier Draft engineering PRs **#93–97** added offline reconciliation/safety/model contracts; **#98–105** moved to canonical links, disposable two-note writeback, next-event retrieval, source-labeled Markdown, authenticated graph readback, one explicit authorized bundle and real context recall. **#106** addressed the prior security-audit transitive package blocker. **#107** added a narrowly conditioned, separately authorized recovery of an unstarted Timeline append. **#108** added real Source-context preparation + source SHA binding, source-first synthetic MCP integration, legacy `company` timeline compatibility and main-content reconciliation.

PR #108 remains an **existing stacked Draft**, not a single isolated release-ready PR. The chain contains earlier projects/branches, and CI success on a child PR is not authorization to merge all parents.

### 5.1 Verified development snapshot from GitHub, 21 Oct 2026

- Repo: `varat1122/notemesh-readonly`; existing [Draft PR #108](https://github.com/varat1122/notemesh-readonly/pull/108) — **Open, Draft, Unmerged**, base `feat/authorized-partial-timeline-recovery-20261021`.
- Current handoff base head **before these documentation commits**: `72da6080790d4d18ddadb2267014780fe74f9a38`, branch `feat/real-event-context-to-writeback-handoff-20261021`. **Never treat this frozen hash as latest**; update from GitHub.
- [CI run #39528935204](https://github.com/varat1122/notemesh-readonly/actions/runs/39528935204) — **Completed Success** on that exact head: Lint, Typecheck, Build, Unit/Integration, Playwright E2E, Docker and dependency security audit. Old reviewed audit exceptions may still exist; passing audit ≠ zero advisories.
- At comparison time, feature branch **591 commits ahead, 8 behind `main`**, common ancestor `971b0d4495810018cb19a25d168498014027e375`; `main` checked at `b563c55fd99c5fb2738fda0682f7b6f76a0ef42a`. Later main improvements were reconciled **at source-file content level** into #108, **not git ancestry merged**, not a verified release merge. Examine 252-file cumulative diff; **do not blind-merge/squash 591 commits**.
- Railway Production was previously observed **online 1/1** on the **older 19 Oct deployment** with no pending deployment. Feature branch #108 not deployed; do not claim current production commit without live check.
- ChatGPT's **installed Safe Edit Chat** connector was observed to expose **12 tools**, whereas new graph tools `prepare_investment_graph_review`, `write_investment_graph_bundle`, `verify_investment_graph_writeback` exist in **unmerged Draft code**, not yet published into the live App registry.
- User showed **Codex Cloud environment published** for this GitHub repo from an Android Chrome interface. Its setup message reported pnpm 11.16.0, 136 tests + basic lint/typecheck/build checks, unchanged tracked files, **no validated browser E2E/Docker/live Sync in that setup**. This setup result is **not equivalent to running full Draft PR #108 CI**; verify the Codex checkout ref and worktree.
- **Paid API evaluation PAUSED**. No run billed or authorized by the request to create this handoff.

### 5.2 Current real gaps (do not mistake code for product)

1. **Release integration:** reconcile Git ancestry/stack dependencies and latest main on an isolated candidate, inspect substantive 200+ file changes, review authorizations, security and changes to main's functionality. Run CI on the **actual proposed release SHA**. *No production merge yet.*
2. **Actual semantic investment model test:** no permitted paid OpenAI API eval has been run; synthetic drafts do not prove AI recognizes contradictory evidence, materiality or real issuer text. Need budget/model/key authorization first.
3. **Staging deploy and App action refresh:** server Graph tools not live/published in installed ChatGPT Safe Edit App; Cloud Codex cannot assume connector binding to unpublished tools.
4. **Real original Source ingestion/verification:** existing legacy chat inbox notes are combined AI/user records, not automatically qualifying `source_type=primary|attributed|user_supplied` with exact `event_key`. Do not use duplicated older NVDA FY27Q2 as new data.
5. **Non-production real-event pilot:** source-first, historical recall, reasoning/citations, strict canonical links, authorized bundle, independent graph readback, next-event unverified AI recall, duplicate and fault tests.
6. **Cross-device sync acceptance:** server-side receipt or aggregate upload counters **never prove** desktop/mobile Obsidian received a specific note; actual target-device readback is separate.
7. **Continuous auto-save policy:** owner desires eventual permitted non-protected automatic saving, but current platform needs per-action OAuth/host authorization. No standing write permission or protected Thesis updates without separately reviewed explicit policy.

## 6. Prioritized handoff tasks — minimum path to P0

**Task A — first Codex Cloud audit (READ-ONLY, no file edits):**
- Confirm environment selected repository and **actual checkout** (often `main`, not PR #108 by default). Fetch latest `main`, PR #108 head/base, merge base and PR ancestry; list unmerged parents. Examine `AGENTS.md` and this document **in the PR #108 branch** (they are not automatically visible when checked out to `main`).
- Compare main's newer change sets to the integrated feature code; do a targeted side-by-side review of `investment-context.ts`, `investment-writeback-router.ts`, `safe-edit-server.ts`, its tests, source archive/Sync files. Check issuer scoping, unintended data disclosure, name collisions and security/permission regressions.
- Assess realistic merge strategy and rollback plan on an **isolated candidate**; do not merge protected main or update production. Confirm which tests *actually ran* in Codex Cloud versus GitHub Actions; report blockers with file/line, evidence, severity and suggested fix.
- Report a concrete plan **before** substantive changes, per owner's first-audit request.

**Task B — only after development instructions:** fix demonstrated integration blockers on an isolated nonprod branch; reduce unreviewed changes, keep real authorization, run full CI on exact candidate and inspect Test/Image/Audit separately. Prefer merging/correcting existing stacked chain over multiplying drafts.

**Task C — paid model/API evaluation (separate explicit owner go-ahead):** configure staging network + scoped secret + spending cap, run a tiny disclosed test set first, grade source attribution, issuer/period, duplicate/correction, causal thesis impact, counter-evidence, hallucination/abstention, relevant exact links and refusal/permission boundaries. Record model/version, inputs/provenance, outputs, token usage/cost, failures and revisions. **Do not auto-write results into real Vault during API testing.**

**Task D — permissioned staging acceptance:** deploy exact reviewed SHA to isolated staging (only with owner approval), connect only test Vault, safely refresh App action registry, authorize one source and one bounded Analysis/Timeline operation, independently verify readback and different-event recall; finally verify target-device sync separately if required. Every escalation must be explicitly approved and logged.

### Engineering changes to avoid

No speculative refactor, separate writer, broad automatic Thesis edit, new multi-agent framework, synthetic benchmark explosion, accounting check expansion, extra unsupported App registry, unbounded Vault scraping or API trial solely for “progress.” If a task does not remove a **proven P0 blocker**, defer it.

## 7. Truthful progress reporting template

At each milestone, report **Thai, concise, precise**:

1. `North Star step improved:` the *one* closed-loop link materially advanced.
2. `Verified facts:` commit SHA, branch/PR base, files/functions, exact tests and CI job conclusions, real/fixture/prod boundary.
3. `Remaining blocker:` what cannot yet work and why; priority P0/P1.
4. `Security/permissions:` explicitly say **NO** merge, production deploy, real Vault mutation, paid API, protected Thesis edit unless an authorized operation actually happened.
5. `Decision / next step:` smallest real test/action to close the next gap, owner approval required if applicable.

Use terms `implemented`, `fixture-tested`, `live-observed`, `owner-approved` and `not verified` separately. Dates/commit SHAs are snapshots, not permanent state.

## 8. Canonical references and precedence

**Read these in this order for engineering continuity:**
1. `AGENTS.md` (the root file accompanying this document on Draft #108).
2. `docs/INVESTMENT_OS_PRODUCT_NORTH_STAR.md` — owner's official product intent.
3. `docs/CODEX_MASTER_HANDOFF.md` — this bounded continuity document.
4. `docs/REAL_EVENT_CLOSED_LOOP_PILOT_RUNBOOK.md`; `docs/REAL_EVENT_CONTEXT_TO_GRAPH_WRITEBACK.md`.
5. Actual relevant code, tests and GitHub Actions traces on the checked-out ref.
6. Older `INVESTMENT_OS_MASTER_HANDOFF_2026-10-21_PR105.md` (historical engineering detail **only until PR #105**; its security audit failure was addressed in #106). Older 2026-07/08 Project Context files cover research methods, but their historical investment/portfolio numbers must never be treated as live brokerage or market data.

**Vault when relevant and authorized:** `10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md` (observed `updated: 2026-10-12`), `05_Thesis/NVDA - Current Thesis.md` (draft/not_reverified), `05_Thesis/NVDA - Evidence Register.md` (not_reverified), `08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md` and selected original notes. NoteMesh Read Only can read them when available; Codex Cloud does not inherit ChatGPT's plugin access automatically.

**Exclusions:** user's private portfolio spreadsheets/history, unrelated chats, credentials and financial records are not copied into this GitHub engineering handoff. This document captures **the operating objective, architectural decisions, current engineering state and gates**, not every message ever exchanged.

## 9. Definition of done — objective Go / No-Go

- [ ] Verified source item and exact event identity, with provenance/dates and no unresolved duplication.
- [ ] Historical issuer, draft Thesis, Evidence Register, Timeline, original Source and counter-evidence actually retrieved; gaps flagged.
- [ ] Human/model reasoning checks economic causality and contradictory scenarios, with sourced claims and abstentions; **actual evaluation**, not static template.
- [ ] Only substantively relevant exact existing canonical Obsidian Wikilinks; full-path resolution and correct backlinks.
- [ ] Explicitly permitted Source stored separately, AI Analysis Draft written, one existing Company Evolution append; protected Thesis/Portfolio unchanged.
- [ ] Physical Markdown bytes, source and after hashes, two Safe Edit receipts, SQLite/FTS, resolved graph, idempotent replay independently verified.
- [ ] A genuinely different NEXT event retrieves prior Analysis as `archived_ai` / non-independent source.
- [ ] Partial failures yield durable truthful repairable receipts; rollback/DR and OAuth/Sync controls maintained.
- [ ] Actual staging and installed ChatGPT App actions tested under separately granted permissions; **not** a claim of mobile sync.
- [ ] Full release ancestry/security/code review + exact release SHA CI + separate owner-approved production change when ready.
- [ ] Target-device delivery verified **separately** before claiming Obsidian mobile/desktop Sync.

**Stop if evidence or permission is absent. Never turn a hypothetical checkmark into a completion claim.**

---
*Handoff authored 21 Oct 2026 from the Investment OS owner's project directives, previously provided PR #105 handoff and direct inspection of GitHub PR #108/North Star/Pilot Runbook. It is intentionally a bounded, source-distinguished engineering document rather than a reconstructed transcript of every past conversation.*
