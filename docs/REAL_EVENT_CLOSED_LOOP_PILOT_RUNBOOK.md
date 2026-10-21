# Investment OS — Real-event Closed-loop Pilot Runbook

**Reviewed:** 2026-10-21 (Asia/Bangkok)  
**Status:** PREPARED / **NOT EXECUTED** — Draft PR stack, no deployment or live Vault mutation approved.  
**North Star:** New Investment Intelligence → original-source identity → historical Current Thesis / Evidence Register / industry + contrary evidence → AI causal reasoning → relevant canonical Markdown Wikilinks → authorized Safe Edit Analysis + living Company Evolution → physical/FTS/link/backlink readback → historical ANALYSIS recalled at NEXT event.

Paid-evaluation preparation now has a [single cumulative USD10 campaign with USD8.50 automatic cutoff](./OPENAI_EVALUATION_BUDGET.md), persistent pre-dispatch reservations and offline actual-MCP-loop coverage. This does **not** authorize paid calls: current official pricing/model availability/Project controls and durable ledger setup remain unverified. No provider hard cap is claimed.

## 1. Stack release review: hard constraints

- Current end-of-stack: [PR #108](https://github.com/varat1122/notemesh-readonly/pull/108), stacked on #107 → #106 → #105 → #104 → #103 → ... → #93 → #92 and earlier non-main branches. At the 21 Oct review, all #93–108 were **Draft/unmerged**. Do not mistake individually green PR CI for a merged deployable release.
- Comparison at the 21 Oct review: PR #108 branch was **572 commits ahead, 8 behind `main`** (`diverged`), with 247 changed files. A deploy or blind squash of the large chain is **NO-GO**. Reconcile base drift, review the **full first non-main ancestor to PR #108** and branch protections, then test the resulting exact release SHA on a protected non-production environment.
- PR #106's production audit job passes with pre-existing review/ignore entries; "Audit passed" does **NOT** mean zero remaining advisories. Security exceptions need owner review; no policy relaxation.
- Railway production is an **existing older deployment**. This runbook does not alter Railway configuration, OAuth, Cloud Intake or Sync.

## 2. Why Source capture is the pilot's first true integration test

Existing `submit_investment_notes` saves an **imported combined analysis** under `00_Inbox/ChatGPT` with `source_type=chatgpt_analysis`, not an independent canonical `source_type=user_supplied|attributed|primary` event Source. `prepare_investment_graph_review` needs a physically indexed **separate Source Note** with `entity` and `event_key`. The old intake package cannot be fed directly into the new graph path as if it were a verified source.

**Do not add a second writer or override the 07_Sources protection.** For a limited pilot, use the existing Safe Edit **`create_note` preview → `apply_edit`** to create the original user-supplied Source Note in an **already existing** `10_Knowledge/Company Research/` folder. Safe Edit's general writer intentionally blocks `07_Sources/`; `archive_original_source` is a separate byte archive **outside the Vault**, and `store_user_attachment` writes binary attachments only. Neither substitutes for a canonical indexed Source Markdown record.

### Source format (fill only from an actual supplied item)

Use a real non-sensitive, dated item with original publisher URL or captured text, explicitly preserve original words/attribution; **do not invent an event date or numeric fact**:

```markdown
---
type: research_note
entity: NVDA
event_key: NVDA-EXACT-ISSUER-EVENT-KEY
period: FY27Q3
source_type: user_supplied
verification: unverified
event_date: null
published_at: null
received_at: null
original_source: null
---
# Original user-supplied investment intelligence — not independently authenticated

## Original provided material
[Insert exact user-supplied text and properly attributed source URL; do not paste model conclusions.]

## Unresolved provenance
Issuer/publisher authenticity and statement-level verification remain pending.
```

Examples above are **SCHEMA ILLUSTRATIONS, NOT actual claims**. Substitute the *confirmed actual* issuer, event, fiscal period and dates; null where unknown. If metadata `primary` or `verified_against_primary` is used, review the actual original against source before making any such assertion. Source content and original binary capture are distinct.

## 3. Pilot execution sequence (staging only, after distinct authorization)

| Stage | Existing action | Objective check | Hold on |
| --- | --- | --- | --- |
| 0. Freeze | Review chain #92–108 and full first divergent ancestor; fresh CI/security on exact release SHA; stage Cloud Obsidian Sync with one writer | Production remains unchanged and rollback snapshot/backup exists; test OAuth `vault:read vault:edit`, per-invocation host approval, actual verified idle bidirectional sync | Unreviewed base drift, stale branch, absent admin approval, unsafe Sync |
| 1. Capture original | `create_note` preview in `10_Knowledge/Company Research/` → separately authorized `apply_edit` → `get_edit_status` | Source text is source-only, not AI analysis; `written` + hash readback + reindex verified; original author/event/publish/capture dates distinguished | Duplicate source event, wrong publisher, unsupported path, physical mismatch |
| 2. Recall historical | `prepare_investment_graph_review` with **exact** `sourcePath`, `issuer`, `eventKey`, `period`, issuer question | Requires Source physical/index agreement; returns physical source SHA, real Current Thesis/Evidence Register/Evolution/industry/context pointers, missing sources and old `archived_ai` separately | `existing_event_or_analysis_requires_duplicate_review_no_write`; stale Source index; missing canonical Company/Timeline or wrong issuer |
| 3. Analyze | ChatGPT **reasoning from the returned material**, with explicit source citations, counter-evidence and unknowns (NO paid API test) | Demand → Revenue Conversion → Margins → Earnings → Cash Flow → ROIC; previous versus new Thesis; prioritize only relevant links, never auto endorse protected Thesis | Missing essential facts, unrelated links, false source verification, guessed price-in |
| 4. Link and save | Compose `investment_review` Draft with exact full-path Source, Company Hub, Company Evolution and only justified extra links; explicit host-authorized `write_investment_graph_bundle` | **Pass `expectedSourceSha256` from stage 2**; gate enabled only in approved stage; record two operation IDs and `authorized_two_note_graph_written_and_readback_verified` | Source was modified since prep, edited target collision, duplicate event, any partial write |
| 5. Verify independently | `verify_investment_graph_writeback` with same actor + operation IDs + exact paths | Actual bytes/afterHash + SQLite/FTS, resolved full-path Wikilinks and living Company Evolution reverse backlink all agree | Anything except authenticated physical readback verified; never claim mobile Sync from server receipt |
| 6. New event | Prepare a **different** captured Source/Event for same company, with a question **not sharing old analysis body keywords** | Previously saved review returns as `role=analysis`, `source_type=archived_ai`, `independent_evidence=false`; new analysis explicitly acknowledges history | Old AI omitted without warning or promoted into independently verified evidence |
| 7. Repeat | Replay the **same** first event/action | No second Source, Analysis or Timeline item; preflight returns duplicate hold and writer readback-only replay | Any new note, overwrite, silent auto-retry or protected-note edit |

The model is responsible for **semantic investment reasoning**; Code only proves version/path/permission/receipt/link integrity. CI exercises this with a **synthetic** ANALYSIS Markdown draft, not paid or live model calls. For an authentic pilot, the analyst must actually reason over and cite the real source.

## 4. Minimal approval and blast radius

- **Explicit separate owner approval required:** review PR stack, reconcile main drift, approve a specific staging deployment or limited real-Vault pilot, configure bounded admin flags and OAuth consent. This runbook alone is **not approval**.
- Only **one issuer + one source/event + one Analysis Note + one append to an existing Company Evolution**. Use a non-protected test issuer/company where possible; do not update `05_Thesis`, Evidence Register, Portfolio, external accounts, or save an unattested fact as verified.
- `SAFE_EDIT_ENABLED=1`, `SAFE_EDIT_SINGLE_WRITER=1`, `INVESTMENT_GRAPH_BUNDLE_ENABLED=1` are **write-enabling** flags and must never be changed in production merely to run the pilot. Backup/journal, no concurrent writers, guarded paused Obsidian Sync, and independent readback are mandatory.
- If Analysis has a verified receipt but Timeline operation **never started**, PR #107 allows a **new separately host-authorized** `recoverTimelineOnly=true` call after revalidation. Any existing Timeline operation, inconsistent source/afterHash or uncertain partial mutation => manual reconciliation, no auto retry/rollback.
- In the source-integrity integration candidate, `expectedSourceSha256` is **required by the bundle schema**. Copy the preparation result's `canonical.requiredAnalysisSourceMetadata` into Analysis frontmatter (`source_path`, `source_sha256`). A deliberately stale physical Source must be refused before either graph mutation. Independent verification must also reject Source drift and stale Source FTS after writing; replay/recovery must not accept a replacement hash for a previously saved Analysis. Legacy unbound receipts require manual reconciliation, never automatic hash backfill. These candidate changes are not a statement about the currently deployed or published tool schema.
- After a legitimately saved second event, reverify/replay the first: historical receipts and current graph must both verify, with `subsequentAuthenticatedAppendCount > 0` and `exactOperationAfterHashesVerified=false`. Only a complete same-OAuth-client append receipt/snapshot chain is accepted. A changed Timeline without that proof, a replace/rollback, or stale current FTS holds; a prior successful receipt is never rewritten. Cross-client or pruned/ambiguous history requires explicit reconciliation.

## 5. Evidence capture and Go / No-Go criteria

Record, without leaking OAuth tokens or full private note bodies:
- Reviewed release SHA, PR/branch dependency mapping and CI jobs, evaluated security exceptions and approved staging rollback point.
- Original Source URI/path, actual source digest, claimed source_type/verification and dates (unknown dates explicit).
- Three exact canonical paths, extra industry/thesis links and the analyst's relevance rationale; Current Thesis and Evidence Register treated as references.
- Source capture receipt; both graph Safe Edit operation IDs; `get_edit_status`, independent graph verification, no duplicated timeline marker, actual cross-device Sync status separately if tested.
- Next-event Context Pack item proving retrieved Archived AI remains **non-independent** evidence and any omissions/warnings.

**GO** only if every stage succeeds on a reviewed nonproduction exact SHA with the owner-approved authentication and write policy, no protected changes, no unreviewed security exceptions and factual AI reasoning cited to actual sources. **NO-GO** for stale/partial source, absent original, undocumented duplicate classification, unresolved PR stack divergence, any skipped proof, any false "Synced to phone" conclusion or required permission not explicitly granted.

## 6. Real live Vault READ-ONLY preflight (21 Oct 2026; no mutation)

A limited read-only lookup against connected `Investment_OS` was performed. The server reported 3,375 indexed Markdown notes, zero unindexed notes, disk status `ok`. **This is metadata visibility, not a full-Vault review or proof all notes contain reliable evidence.**

Existing NVDA anchors (observed, not modified):
- `01_Companies/NVDA.md`
- `08_Daily_Weekly/Research Indexes/Company Evolution - NVDA.md` (note created/last-modified 19 Oct 2026; declares `company: NVDA`, not `entity: NVDA`; headings include `NVDA — Living Company Evolution Timeline` and dated historical sections)
- `05_Thesis/NVDA - Current Thesis.md` (declared `draft_from_archived_evidence`, `not_reverified`; last `updated: 2026-10-12`)
- `05_Thesis/NVDA - Evidence Register.md` (`not_reverified`; last `updated: 2026-10-12`)
- `08_Daily_Weekly/Research Indexes/Primary Evidence - NVDA FY27Q2 2026-08-26.md` (declared `primary` and `verified_against_primary` for certain figures; **also** `status: source_verified_dedup_pending`, `source_sha256: null`, `company: NVDA` without `event_key`).

**Concrete blocker found and fixed in the Draft:** the read/write graph handlers previously required a living Timeline's frontmatter to have `entity`; production's actual NVDA Timeline has `company`. PR #108 now tolerates this *legacy Timeline identity field only* if declared `entity` and `company` (when present) are both consistent with requested issuer. It still refuses conflicting values. The integration test uses that legacy metadata shape.

**Do not choose existing NVDA FY27Q2 evidence as a fresh event automatically:** it is a pre-existing primary IR review with dedup unresolved, no immutable source-byte hash and no exact event-key metadata. For an approved live pilot, either pick a genuinely **new, independently reviewed event** or deliberately create a separately classified source record with exact original event key; preserve the existing evidence as historical reference, never count a rewrite as a new independent issuer report.

**Owner decisions still required before execution:** authorize exact staging deployment/scope, select a genuine event, confirm the actual original source and duplicate classification, and approve the single limited Source + Analysis/Timeline write sequence. No Paid API/model test has been started.

### Current result (21 Oct 2026)

- Synthetic integration test on PR #108 has been expanded to create original source via **real in-memory MCP Safe Edit preview/apply** in a temporary Vault, then prepare/retrieve/write/read back/next-event retrieve.
- The test also modifies actual source bytes **after preparation** and expects a fail-closed stale-hash refusal before restoring the fixture and writing.
- **No actual issuer-source pilot, staging deployment, production Vault write, protected Thesis mutation, mobile Sync verification or paid OpenAI API model call has been performed.**
