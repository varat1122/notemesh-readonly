# M5.4 canonical writeback — existing Production NoteMesh / Investment_OS

## Why this change exists

The October 25 Fresh Micro AWS/Jassy incident finished analysis but never wrote
the canonical notes. The deployed M5.3 planner accepts `sourceChat`,
`completedAnalysis` and `captureOnly`, yet one ChatGPT connector tool snapshot
exposed a stale schema without those fields. A read-only call with the complete
fields returned both M5.3 recipes, showing the backend planner itself works.
This is a **client metadata / orchestration incident**, not evidence that old
notes or the Production volume were lost.

## M5.4 scoped flow

On the *existing* Safe Edit OAuth endpoint (`vault:read vault:edit`):

1. `prepare_canonical_writeback` takes the exact original text, source/chat
   metadata, typed Thai `researchReview` (or `captureOnly:true`) and
   classification. It recomputes the M5.3 deterministic plan, validates
   add-only paths, and returns the **eligible Safe Edit diff previews and
   client-bound tokens** in one call. This performs no Vault note write.
2. After reviewing the diffs, `apply_canonical_writeback` takes the *same*
   input, `planId`, and exact pending preview authorizations. The existing
   Safe Edit engine pauses verified idle Sync, protects each path with CAS,
   journals a receipt/backup, writes Source before requested Claims and Review,
   and independently checks SHA/readback/index. The response re-plans from the actual Vault.
3. Only `outcome:saved_verified` / `readyForNextNews:true` confirms a finished
   Source + requested Claims + Canonical Review cycle.
   `source_saved_analysis_pending` is valid only for Feed Only. Inspect `interrupted` and individual `steps` when pending.

This is **recoverable add-only writeback (Source, optional Claims, Review), not
a single atomic file transaction or background queue**. Successfully stored
Source/Claim notes are retained when a later step or the Review fails. Interrupted
Safe Edit journal operations require operator reconciliation; the system never silently overwrites another writer's note.

### Thai persistence quality gate (RI-001 follow-up)

Both `plan_investment_writeback` and canonical prepare/apply use the same workflow
gate. `completedAnalysis` remains accepted for legacy diagnostics and safe Source
capture, but cannot authorize a fresh Review: missing `researchReview` produces
`typed_research_review_required`, Review `hold_quality_gate`, no Review recipe or
preview, and `readyForNextNews=false`. The former `M55_REQUIRE_TYPED_REVIEW` flag
cannot bypass this gate. Event, archive, conflict and index HOLD precedence remains.

The read-only planner and Safe Edit expose the same strict `researchReview` wire
schema plus `sourceChannel`, `attributedOrigin` and `originalDocumentAccess`.
Callers supply Thai headline, what-changed, mechanism, implication, counter-evidence
and required-evidence sections. Foreign news requires `translationTh` covering
the actually read `extractedText`, in order, retaining figures, attribution and
caveats. `excerpt_only` never means unread pages were translated. Thai news does
not need a duplicate translation. The exact original text is preserved in Source.

The mechanical language screen uses the Node 24 runtime's Thai word segmentation
(`Intl.Segmenter`), not Latin-versus-Thai character length. Each unquoted prose
paragraph needs at least two Thai word units, six Thai letters and a Thai word
share of at least 35%. Combining marks remain part of words; standalone marks,
digits, URLs and quoted/code text cannot supply Thai narration credit. A mixed
script token is not credited as Thai. No financial-term or company allowlist is
used, so ordinary Revenue/EBITDA/Margin/Guidance/FCF/ROIC prose can pass alongside
Thai explanation without long English names dominating a character ratio.

Quoted English, blockquotes, code and formulas are **counted as supporting foreign
words**, not silently removed from the language decision. Their aggregate count
cannot exceed the field's unquoted Thai word count, and the whole field must
retain at least 35% Thai word units. Any supporting foreign text also
requires at least eight Thai words outside those spans, including short quoted
phrases; a Thai label cannot authorize even a one-word untranslated payload. This prevents a short
Thai label plus an otherwise English quote/code payload from replacing the
translation or analysis. Splitting it into tiny quotes or putting prose in a
fence info string does not evade the aggregate check. Standard backtick/tilde
fences preserve their boundary; an unclosed block fence is rejected. Genuine
quotations, formulas, code, figures and company/financial terms remain allowed
when supported by sufficient Thai narration. These are bounded mechanical
composition checks, not a Markdown parser or a semantic language proof.

A PASS does **not** prove substantive meaning, fluent Thai, faithful/complete
translation, numerical fidelity, fact truth or a Thesis decision. An unrelated
but mechanically Thai translation can still pass; regression explicitly records
that limitation. LLM/reviewer acceptance must compare all actually read Source
text against the translation, including scope, attribution, figures and caveats.
Long quoted originals belong in the preserved Source, with the Review's Thai
translation/explanation written separately. No LLM call, schema or infrastructure
is introduced by this calibration. A historical bypass can now HOLD on current
revalidation, but its accepted note bytes/receipt remain intact; the gate does
not translate, overwrite, replay or repair it automatically.

New generated Review headings are Thai; filenames, Source identity, receipt hash
algorithm and claim-evidence gates are unchanged. An identical historical retry
may match the prior renderer only through the existing independently verified
create receipt/hash/readback path. Old bytes and receipt IDs are retained; changed
analysis, broken links or current evidence problems still HOLD. No backfill,
automatic translation/rewrite or migration of accepted notes occurs.

### RI-001 optional multi-claim persistence (CI-only follow-up)

Existing capability audit: `review_investment_claim` already reads the
`investment_structured_claim_register` / `claims[]` Markdown contract, and Safe
Edit already provides add-only writes, receipts, readback and indexing. The old
singular `claim` input only produced a `claim_registry_candidate` with `path=null`;
it did not persist a claim. Primary-evidence attestation receipts and guarded
Source/Review event relations are different contracts, not claim/event registries.
This follow-up uses those existing Note/index/journal mechanisms; no new database,
schema, migration, writer, verification issuer or event registry is introduced.

The optional strict `claims[]` contract accepts 1–8 **company-scoped, unverified
observations**. Every row names entity, metric, value, unit, period, evidence class,
statement, source locator and exact source excerpt; an optional qualification
preserves ranges/YoY caveats. The entity must match an explicitly supplied intake
entity. `sourceExcerpt` must occur literally in `extractedText`, and its value and
qualification must occur literally in that excerpt. This is a mechanical anchor,
not confirmation of publisher authenticity, period/entity interpretation, fact
truth, relationship or an independently verified claim. A full primary URL and a
CORE-LEAD fixture do not issue primary-evidence receipts.

Use `reported_actual` separately from `management_guidance`; guidance is neither
realized revenue nor consensus. `analyst_estimate` and `unverified_claim` are also
explicit classes. Unclassified historical records remain discoverable but cannot
produce an Actual/Guidance duplicate verdict by inferred class. Callers cannot submit a verification upgrade, relationship
edge, arbitrary destination, model-version assertion or analysis timestamp.
The legacy singular `claim` and new `claims[]` cannot be mixed. Claims require a
canonical capture/Review mode; the read-only planner does not silently promise
persistence from an incomplete triage-only request.

Each Source-scoped identity hashes intake ID, normalized entity/metric/period/unit
and evidence class, excluding value. One immutable Note is created at
`10_Knowledge/Company Research/Investment Claim - ICL-<digest>.md`, using the existing
structured-register type with one `claims[]` entry. A changed value or qualifier
at that identity is a conflict requiring a separate reviewed correction; it does
not overwrite the Note or receipt. A changed Source can have a different intake
identity; that is a separate unverified observation, not automatic correction or
independent confirmation. This is not a universal cross-Source economic-event ID.

Canonical prepare/apply now processes **Source → requested Claims → optional
Thai Review**. All pending operations require their exact OAuth-bound tokens;
each operation is re-planned by both kind and path immediately before writing.
A failing later operation retains prior successful receipts and bytes. Retry
prepares only pending operations, never replays successful ones. Unanchored or
conflicting Claims block Review admission. Source capture can remain eligible;
valid observations can be saved without a Review. `captureOnly` with claims
returns `source_saved_analysis_pending`, never a completed research cycle.
The existing Thai, event, archive, primary-receipt and protected-state gates remain.

Reviews include all requested claim IDs/paths and indexed wikilinks. Claims link
to their immutable Source. Cold `review_investment_claim` retrieval rechecks
current disk/index metadata, source text hash/excerpt, create receipts, FTS and
Claim→Source links before returning generated claims. Review references are
resolved from both explicit Review metadata and backlinks and require the same
intake, Review receipt/readback/FTS and Review→Claim/Source links. Missing current
binding yields `claimBindingHolds`, or `reviewScanComplete=false` for incomplete
Review lineage; it cannot become a verified fact or confidently absent history.
Review-reference scanning is capped at eight plus a sentinel. The existing
25,000-note claim metadata scan still reports truncation. Adding claims to an
already saved Review does not rewrite it: Review revision needs a separate
reviewed workflow. No historical receipt is backfilled, replaced or synthesized.

All observations from one Source share its `origin_family` and have
`origin_independence_increment=0`; Review links do not add independent sources.
Untrusted descriptive claim data is JSON-quoted in frontmatter and dynamically
code-fenced in the body; it cannot create additional indexed tags, headings or
wikilinks. MCP claim text is returned within the existing untrusted-data boundary.

Optional `researchLineage.knowledgeCutoffAsOf` is an offset-aware, caller-declared
historical information cutoff (null if unknown). `analysis_created_at` is the
runtime time of **canonical Review proposal creation**, not economic event time,
publication/import time or an inferred LLM generation time. Identical prepared
retries retain that timestamp only from the same input digest and Safe Edit
journal content/hash/runtime preview event; it cannot be supplied/backdated by
clients. Runtime-lineage Review creation must use `prepare_canonical_writeback`;
`preview_edit`/`create_note` reject those raw recipes with
`canonical_review_requires_prepare`, before creating a journal operation or note.
Prepare generates fresh chronology and admits the preview immediately. An
already admitted valid preview keeps its original creation time while the owner
reviews it; the one-minute generation-to-preview check is **not** an owner
approval deadline. The existing 30-minute token expiry remains: prepare again to
rotate an expired token without changing proposal bytes, time or operation ID.
Apply also refuses an older invalid-chronology preview before writing.

Re-planning first verifies the exact on-disk Review's written create receipt,
then its original runtime preview event. Abandoned previews cannot invalidate a
valid written version. If no matching written version exists, lookup filters by
exact Review path **and input fingerprint** before returning at most sixteen
matching proposals plus a sentinel; unrelated input proposals do not consume this
bound. The existing journal quota still applies. Ambiguous times, matching-scope
overflow, an invalid receipt or unverifiable chronology return
`hold_review_lineage` with `lineageIssues` (including
`review_runtime_chronology_ambiguous`, `review_lineage_scan_limit`, or
`review_runtime_chronology_unverified`), never a planner exception that hides the
valid Source/Claims. There is no arbitrary first/last proposal selection.

A historical delayed generic write can have a valid persistence receipt but
invalid current chronology. Preserve that receipt and every note byte; current
Review usability HOLDs, cold Claim retrieval excludes that Review and reports
`reviewScanComplete=false`, while independently verified Source/Claim persistence
remains readable. Actual competing proposals or invalid historical chronology
require separate reviewed reconciliation; neither retries nor this patch edit,
delete, backdate or repair the journal automatically. New input with a cutoff
later than creation is rejected; the same defect in historical lineage is an
explicit HOLD. This MCP runtime
does not expose the originating LLM model version: persist `model_version=null`,
`model_version_status=not_exposed`. Existing inputs without claims/lineage retain
their prior rendering and receipt identity.

The isolated oracle `FX-RI001-NVDA-Q2FY27-EN-PRIMARY-01` is supplied in CORE-LEAD
chat: the exact two-line UTF-8/LF excerpt (trailing LF) is 110 bytes, SHA-256
`fcb27d2199b77c5f9461a27db3daa8319f441fdb0d9a3ebc1213a80c794a5de9`.
It reports Q2 FY2027 revenue USD96.2bn (+106% YoY) and Q3 FY2027 management
guidance USD108.0bn ±2%, from one NVIDIA IR release. Declared publication/event:
2026-08-26; reporting-period end: 2026-07-26; supplied SEC acceptance: 16:36 ET;
cutoff: `2026-08-26T20:36:00Z`. SEC corroboration supplied by the user is
`https://www.sec.gov/Archives/edgar/data/1045810/000104581026000075/0001045810-26-000075-index.htm`;
it is not fetched or counted as independently verified evidence by these tests.
Fixture persistence is only in temporary test Vaults. CI acceptance is not live
Vault persistence, remote Git/Sync delivery or Runtime/LLM Research Acceptance.

### Same-event appearances and claim interpretation

Source identity still binds exact received bytes, canonical URL and explicit
chronology. Exact retry reuses the immutable Source/Claims/Review. A formatting
change (including extra newline) is a new Source appearance, not an exact retry;
it does not automatically become a new economic event or independent evidence.
Existing same-URL/event candidates or an incomplete candidate scan HOLD **new
Claims as well as Review**, including Feed Only claim requests. Safe raw Source
capture remains possible. Already-persisted Claims are not deleted or relabelled.
Validated Claims belonging to the same intake/Source do not block incremental
C1 then C2 capture. Different explicit event dates are not silently collapsed.

Materiality, added detail, correction and contradiction need LLM/reviewer
adjudication. Backend value comparison can flag a possible correction; it cannot
confirm one or turn a new appearance into independent corroboration. This patch
adds no semantic deduplication or investment-reasoning regex.

`sourceExcerpt` must literally occur in the received Source, with the submitted
value/qualification. That proves an anchor in supplied text, **not** that the
analyst's `statement` follows from it or that the supplied evidence-class label
is correct. Planner/prepare/apply and cold Claim retrieval expose
`claimInterpretationBoundary` / `interpretationBoundary`: statement and class are
caller-attributed/unverified, semantic fidelity is `not_assessed`, fact usability
is `not_verified_fact`, and excerpt binding is `literal_received_source_only`.
These read-time qualifications do not rewrite historical Claim bytes/receipts.
A Thai Review HOLD can retain a literal-anchored unverified observation; it never
promotes English AI opinion, Actual/Guidance labels or a Safe Edit receipt into
verified issuer facts. Claim-level primary verification still requires its
separate server-validated evidence receipt. All same-origin Claims/Reviews add
zero independence. Semantic fidelity, translation completeness and investment
reasoning remain explicit LLM/reviewer acceptance, not CI claims.

### Historical receipts and current revalidation

A durable successful Safe Edit write receipt records that the named operation's
write, readback and index verification passed **at that time**, for its recorded
path/hash. It is historical execution evidence, not a promise that the current
Vault, link index or research evidence will remain valid indefinitely.

Every future prepare/re-plan checks current state again. A missing Review-to-Source
link, changed index/content or invalid primary-evidence receipt can therefore
produce a current HOLD even when the historical write succeeded. For an
already-written Review, that HOLD preserves its bytes and historical receipt;
it does not delete, overwrite or authorize replay of the Review. Keep the original
receipt and record the new HOLD separately; never rewrite history as a failed
write or treat an old success as permission to bypass current checks.

A primary-evidence receipt is claim-scoped evidence, distinct from the Safe Edit
write receipt. Revoking it leaves prior Source/Review bytes and historical write
receipts intact, but **current evidence usability must HOLD**: it cannot support
a fresh `verified_primary` conclusion. Read-time validation also rechecks scope,
signatures and archived bytes; a formerly approved receipt is not a cached PASS.

Repair is a separate explicit, reviewed workflow with its own authority and
evidence. A re-plan/HOLD is not an automatic repair, reindex, deletion or note
overwrite. Preserve existing bytes/receipts, diagnose the current failure, and
revalidate after an authorized repair before claiming readiness again. See the
[Safe Edit recovery runbook](SAFE_EDIT_RUNBOOK.md#interrupted-operation-recovery-administrator-only)
and [primary-evidence receipt design](investment-os/m551-primary-evidence-receipt-design-2026-10-26.md).

### Protective boundaries

- Uses the same Railway Production Service, `/data` volume, Vault and OAuth.
  No migration, additional Service, Admin or environment is required.
- No automatic mutation of `05_Thesis/` (Current Thesis, Evidence Register),
  `06_Portfolio/`, Company Evolution Timeline or historical source notes.
- Raw attachments require the separate binary archive receipt; text extracted
  from a PDF is not the original PDF.
- Remote Obsidian Sync and any mobile/desktop delivery are *unverified* by a
  server-side SHA/FTS receipt.
- Existing M5.3 planner + per-file Safe Edit remain available for eligible notes;
  runtime-lineage Review creation requires canonical prepare/apply.
  Do not use legacy `submit_investment_notes` for canonical research.

## Connection metadata and acceptance

After the Production deployment is `SUCCESS`, **refresh/reconnect the existing
Safe Edit Chat connection in ChatGPT if its tool catalogue remains stale**.
Check that `prepare_canonical_writeback` and `apply_canonical_writeback` are
both discoverable, and that planner/prepare schemas expose `sourceChat`,
`researchReview` and its classification metadata. Backend deployment does not force a ChatGPT connector
snapshot to refresh.

In a new Micro chat, send one genuine source and analysis under the standing
Project instructions, without a separate Save command. Require (1) source,
(2) canonical review, (3) exact Safe Edit receipts, (4) SHA/readback/search
index, (5) no protected-file mutation, and (6) honest mobile Sync status.
Then repeat for Macro, PDF with real attachment bytes, Feed Only and multi-item
ordering. A regression test with synthetic content is not proof of automatic
behavior in a fresh ChatGPT conversation.
