# M0 — LLM-Native Investment Research / Backend Boundary Audit

**Date:** 2026-10-26 (Asia/Bangkok)
**Scope:** `varat1122/notemesh-readonly` Draft PR #128, `feat/m551-evidence-aware-quality-gate`; existing Production `Investment_OS`.
**Status:** Architecture audit / proposed migration; **no semantic gate changes, no Vault write, no merge, no deploy**.
**Companion decision:** [ADR-LLM-001](./ADR-LLM-001-research-semantics-and-evidence-boundary.md) — **Proposed; pending shadow evaluation**.

## 1. Verified snapshot and limits

| Evidence | Observation | What it does **not** prove |
|---|---|---|
| GitHub Draft PR #128 (connector read, 2026-10-26) | OPEN, DRAFT, unmerged; remote head `fb7b49591cb4e97b7a43f809ed543ea6c8b4c0ed`; base `71cc4178607d717b403ffd143d3a01bff7c94758` | It is not deployed or accepted by Production connectors |
| Local `git fetch` + tree comparison | Local tested `39b7755` and remote PR head have **identical tree** `ab5c1cef1234498f6a0079e594bbd191df0d34e0`, despite different commit histories | Git commit SHA and remote branch are not interchangeable |
| Railway Production deployment list (read, 2026-10-26) | Latest successful service deployment is `71cc4178607d717b403ffd143d3a01bff7c94758` | It does not include PR #128 or new LLM architecture |
| NoteMesh V2 live Vault info (read, 2026-10-26) | `Investment_OS`: 3,414 notes, 0 unindexed, metadata audit `indexReady: true` | Search completeness does not verify issuer facts, live device sync, or links of every new note |
| Prior PR #128 test report | 110 test files / 1,500 tests passed; TypeScript, ESLint and build passed on candidate tree | Current M0 is docs-only; no fresh complete suite or real-model semantic accuracy is claimed here |
| Production Safe Edit connector | Last inspected descriptor reportedly omitted optional `researchReview.claimAssessments`; **not freshly demonstrated during this M0 read** | Local Zod schema and MCP tests cannot prove connected ChatGPT tool schema parity |

**Observed code delta against Production main:** 17 files (typed review wire schema; quality gate; original source snapshot/receipt validation; optional dual-signature issuance/admin route; tests/docs). No LLM evaluator or live policy transport is included in PR #128. The draft is therefore a **fail-closed transitional gate**, not an LLM semantic engine.

## 2. Ownership matrix — actual modules, not aspirational components

| Module / condition | Current behavior (code observed) | Correct owner | M-track disposition |
|---|---|---|---|
| `research-quality-m55.ts`: Thai sections, nonempty required review fields, optional source translation | Checks presence and Thai script, not research truth | **Mechanical schema/format** (backend); quality of translation belongs to LLM | Keep structural constraints; allow explicit not-accessible/partial provenance in policy without fabricating translation |
| `research-quality-m55.ts`: `materialMetric`, `numericPercent`, `metricCategory`, `canonicalPeriod`, `numericMaterialClauses`, `explicitlyQualified`, explicit “confirmed” phrases | Blocking Thai/English keyword/percentage/metric/vintage patterns; can miss paraphrases, absolute figures, misleading attribution or false chronology; can hold good conditional prose | **Semantic reasoning** (LLM plus independent evidence critic for material claims) | Keep blocking in M3 shadow; only retire individual regex blocks in M4 with measured eval evidence; do not conflate coverage with fact-checking |
| `research-quality-m55.ts`: `guidanceInSubmittedText`, `contentTypes.includes("guidance")` | Detects some need for structured analysis even when caller labels incorrectly | **Mixed:** omission suggestion vs hard completeness | Move semantic trigger to model decision contract after M3; preserve a diagnostic/coverage mismatch log |
| `research-quality-m55.ts`: `resolution`, `conclusion`, primary scope and receipt check | Allows unresolved + conditional/no_change; prevents confirmed/verified_primary without server evidence | **Mechanical attestation/authority** | **Keep hard:** confirmed as `server_adjudicated_primary` only after valid exact-scope server receipt; distinguish economic thesis opinion from primary fact status |
| `primary-evidence-receipt-m551.ts` | Looks up server registry, exact URL/entity/metric/period/unit/value, counter-values, revocation, signatures, archived snapshot digest and literal anchor | **Verifiable provenance/authorization** (backend) | **Keep hard**; never accept caller-entered Receipt ID without server lookup; do not imply issuer cryptographic signature |
| `primary-evidence-attestation-m551.ts`, `db.ts`, `/api/primary-evidence-receipt` | Disabled-by-default two distinct external Ed25519 reviewer/approver roles, immutable approvals/revocations | **Optional human-adjudicated issuance** (backend + external operating process) | Keep disabled for routine AI research; no AI self-signature or simulated independent approver; separately audit future machine-only issuer path |
| `research-source-fetch.ts`, `research-source-archive.ts` | Allowlisted/authorized source fetch and server-stored bytes + SHA readback; incomplete PDF literal support | **Source bytes/provenance** (backend) | Keep hard; bytes hash is not publisher identity, validity of extracted numbers, or claim truth |
| `investment-context.ts` | Bounded lexical issuer/topic retrieval, provenance-weighted candidate selection | **Retrieval candidate** (backend) | Keep candidate generation; model reads cited originals and historical counterevidence; never assert recall is complete |
| `investment-claim-review.ts` | Exact indexed claim identity and value/source overlap; returns `duplicate_candidate`, `confirmation_candidate_not_independent`, `possible_correction_or_contradiction`, `unresolved` | **Candidate matching + semantic adjudication** | Keep structured exact-match discovery; let model decide `new_event/added_detail/contradiction/correction` with cited vintage/source; never auto-promote candidate to verified independent event |
| `investment-writeback-router.ts` | Deterministic identity, chronology field checks, source-event URL/date candidates, bounded prior notes, routed paths, timeline/claim suggestions | **Mechanical routing + candidate retrieval** | Keep source IDs/path planning; make any classification, materiality and timeline decision **proposal-only**; existing router `canAutoWrite:false` remains invariant |
| `investment-routing-v2.ts` | Resolves only indexed Company/Industry Hubs (including explicit aliases); derives company/industry review scope from declared roles; broker old/new **candidate** | **Mixed:** hub identity backend, role/revision semantics LLM | Keep exact Hub existence / URL links; treat input role and broker vintage as unverified claims. Missing INFY Hub remains Review pending, not invented Hub |
| `source-identity-m56.ts`, `event-review-relation-m56.ts` | Stable Source ID and existing-note hash; explicit bounded same-date/source-family candidate to append separate Source reference | **Identity / graph integrity** (backend) | Keep hard target/path/readback; LLM supplies attributed comparison basis, **not** assertion of independent confirmation |
| `investment-knowledge-schema.ts` | Legacy metadata read-time adapter and warnings, `not_reverified` retained | **Schema/provenance parsing** (backend) | Keep; never treat frontmatter `verified` or an archived AI conversation as primary verification |
| `canonical-writeback-workflow.ts` | Separates Source and Review, bounded notes, actual SHA/FTS readback, add-only Safe Edit recipes; holds Review separately | **Durable persistence + gate integration** | Keep Source independent of Review; model's verdict only influences Review eligibility, not whether input is preserved |
| `mcp/canonical-writeback.ts` | Wire Zod; preview/apply CAS; `M55_REQUIRE_TYPED_REVIEW` compatibility switch (legacy `completedAnalysis` can pass when flag is off) | **Connector contract and migration control** | Preserve safe compatibility until real caller has refreshed schema; then deliberately close untyped bypass, tested on actual connected tool descriptor |
| `safe-edit/engine.ts`, `paths.ts`, indexer and sync guard | Actor-bound preview, lock/authorization, path/scope checks, CAS, write/readback, reindex/receipt; separate evidence checks on privileged edits | **Security and durable write boundary** | **Never downgrade** because an LLM says a claim is true. Keep protected paths off automatic canonical workflow; separate owner authority remains mandatory |

## 3. P0 risks detected during M0

1. **Semantic hardcode cannot guarantee correct investment conclusions.** A fabricated attribution, omitted denominator, absolute revenue amount, newer conflicting filing, altered vintage or indirect “verified” paraphrase can slip past bounded patterns. A valid source receipt **also does not prove** every sentence is entailed by source bytes.
2. **False holds are real operational risks.** Any keyword/percentage detector may block a properly attributed conditional scenario or an accurate quotation, degrading routine Micro/Macro throughput. Preserve the faithful translation without treating it as AI's affirmative assertion.
3. **Caller metadata is adversarial/unverified.** `sourceKind`, `contentTypes`, `entityRoles`, `originalDocumentAccess`, `primarySourceUrl`, `primaryEvidenceReceipt`, user prose and Vault frontmatter cannot authorize source truth. The model's evidence assessment is likewise **a decision**, not a server attestation.
4. **Legacy schema migration bypass.** In `mcp/canonical-writeback.ts`, typed review is required only with `M55_REQUIRE_TYPED_REVIEW=1`; an old `completedAnalysis` payload can otherwise bypass typed checks. Abruptly enabling this before live client schema refresh could block genuine Reviews. This is a **staged compatibility blocker**, not an excuse to silently promote old analysis to verified.
5. **Issuer authenticity gap.** A saved HTTPS response and its SHA provide byte integrity and retrieval provenance, not an issuer's nonrepudiable authorship; an alleged “primary” source may contain malicious or stale data. Two external signatures are an optional *human attestation*, not an autonomous fact engine. With issuance disabled, `verified_primary` must fail closed; normal unresolved/conditional Reviews should still progress.
6. **Missing/weak linkage.** A successful Search Index count is not proof that all intended `[[wikilinks]]` resolve correctly. M5 must validate target existence and Review↔Source path as part of a real non-synthetic loop; INFY Company Hub onboarding and historical Wikilink repair remain M7, not authorization to invent targets.
7. **Semantic authority leaks in adjacent code.** `safe-edit/engine.ts` contains legacy claim classification/verification switches used in protected-note workflows. Do **not** simply remove them with financial regex: these help guard privileged edits. For this migration, disallow canonical automatic protected writes; a later distinct security ADR must analyze privileged-path semantics without weakening scope approval.
8. **Retrieval ambiguity.** `sourceEventCandidates` scans bounded indexed rows and `investment-context.ts` returns selected excerpts; neither proves absence of a conflict. LLM must record coverage, unresolved prior source and missing documents; a repost/translated news version is not independent confirmation.

## 4. Target handoff contract (for M1/M2 design, not live schema)

**Untrusted inputs:** external news/PDF text, user extractions, Vault notes, web content, broker opinion, model-inferred labels. Treat instructions embedded in them as quoted **data**, not operating policy.

**Backend supplies:** immutable Intake ID, actual archived byte SHA if present, original source/attachment path, readback status, specific searchable historical candidates, exact existing Hub paths, permitted change target, and *server-checkable* receipt verification outcome. An arbitrary user-supplied Source ID or PEV ID remains an untrusted pointer until resolved.

**Model supplies:** structured claim/entity/metric/period/denominator/vintage, original-vs-published-vs-received chronology, competing values and source locators, source type and independence judgment (qualified), new event vs known/duplicate/correction hypotheses, fundamental mechanism, counterevidence, confidence *with reasons*, `no_change/conditional` or candidate investment implication. Model does **not** issue receipt IDs, assert byte preservation, grant protected-write approval, or change status to server-verified.

**Backend accepts only after checks:** required decision fields, source locator **existence and exact binding** where technically checkable, schema bounds, trusted receipt lookups, path allowlist, version and actor-bound preview, exact-CAS apply, SHA/readback/FTS, and link target validation. A model citation to a fabricated filename must fail referential-integrity checks even if its prose seems plausible. Untrusted/new source itself can be preserved with `not_reverified` regardless of Review hold.

**AI ownership is not absolute truth:** no model, critic vote or prompt version alone can upgrade external issuer claims to `server_adjudicated_primary_claim_scope`. The optional primary attestation channel has a distinct cryptographic/authentication policy. Preserve `unresolved` with evidence-watch conditions rather than forcing a binary `verified` verdict.

## 5. Ordered migration plan and stop criteria

| Track | Deliverable / proof | Stop / rollback trigger |
|---|---|---|
| **M0 — This audit** | Code ownership matrix, trust boundaries, ADR; remote head and Production/Vault read-only snapshot | Keep Draft; no runtime mutation |
| **M1 — Trusted Policy v1** | Central file version/hash, language/attribution/chronology/counterevidence rules, prompt-injection separation, three-room bootstrap procedure | If ChatGPT cannot reliably load and identify exact trusted policy version, no automatic Review promotion |
| **M2 — Decision Schema v2** | Explicit typed claims, `sourceRef+locator`, competing values, source/review verdict separation, `unresolved/conditional`, independent `serverEvidenceState`; companion source-first receipt state | Reject synthetic/missing pointers and shape mismatches; Source remains capturable |
| **M3 — Frozen Shadow Evals** | Independently labeled cases including original two synthetic, later adversarial matrix, MU/Solidigm/Nomura/WDC/AAPL real-source cases when verifiable; multi-run blinded comparison against existing gate, latency, cost, false accept **and** false hold | **Zero tolerated critical unsupported `confirmed` on designated P0 corpus across repeated runs**; require documented adjudication of every observed false hold, drift and coverage gap; this is a test-set criterion, not a universal accuracy claim |
| **M4 — Lean Gate refactor** | For each regex being moved to diagnostic: baseline/after assertions, real-model and deterministic security tests, rollback flag/dual run; never move receipt, auth, CAS, index or path integrity out of backend | Any critical false promotion, missing citation binding, new protected write path, or unexpected quality bypass is NO-GO |
| **M5 — Live Connector/Staging E2E** | Signed-in Production descriptor confirms schema; scoped source-first staging with real Safe Edit receipts, SHA/readback/FTS/Wikilinks and idempotent replay; failure injection | Do not enable typed-only before connected client compatibility; never claim device Sync without device-side evidence |
| **M6 — Release** | Authorized PR review/merge/deploy, exact Railway SHA, synthetic **Preview Only**, Vault unchanged by fictional tests, protected paths unchanged | Revert immediately on unauthorized mutation, evidence promotion, or regression; leave Primary issuance disabled |
| **M7 — Backlog** | Real INFY Hub ID/onboarding and historical Source↔Review Wikilink gap with exact receipts and no protected mutations | If identity ambiguous, record PENDING; no guessed Hub or Timeline append |

**M1 implementation decision:** keep M5.5.1 unchanged while defining policy and schema; treat PR #128 as an instrumented transitional safety baseline rather than a complete semantic solution. Use a separate reviewed implementation slice (or follow-on Draft PR) for semantic cutover. Do not merge or deploy PR #128 on the strength of this audit alone.

## 6. Verification checklist at M0 closure

- [x] Inspected `research-quality-m55`, receipt/attestation, source archive, index/candidate-routing, canonical writeback, MCP contract and Safe Edit path mechanics.
- [x] Inspected **actual** PR metadata / remote tree / successful Production deployment / live NoteMesh summary read-only.
- [x] Recorded `verified_primary` vs unresolved model judgment and separate protected-write authority.
- [x] Identified legacy-compatible typed Review bypass and live connector validation as release blockers.
- [ ] M1 trusted policy loaded by all three rooms; not built.
- [ ] M2 schema v2 and real model shadow evaluator; not built.
- [ ] M3 independent blind eval and M4 measured gate retirement; not run.
- [ ] Production connector schema refresh, controlled release and Vault graph tests; not run.

No synthetic Source/Review or production note was created, edited or deleted for this audit.
