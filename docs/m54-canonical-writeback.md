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

Generic Safe Edit is not a primary-verification authority. Its `evidence`,
primary URL, `verified_at`, diff approval and caller-written receipt IDs cannot
grant `verified_against_primary` (including nested claim metadata). The generic
route has no contract to validate exact PEV Source/claim scope and revocation,
so it rejects that promotion at preview, preview renewal and apply, including
old previews and rollback. A historical declaration may remain unchanged on a
body-only edit; changing its metadata requires removing the declaration first.
It is never freshly certified by that edit. Already-written receipts remain
readable/idempotent, without changing historical bytes or receipt contents.
Context Pack, Decision Packet and Evidence Ledger expose such legacy metadata
as declared/unverified candidates, not server-verified primary facts.

The existing canonical claim-assessment gate remains the primary authority:
it validates the independently signed, exact-scope server PEV receipt, current
revocation state and archived source bytes. Even a valid PEV cannot authorize
arbitrary generic note promotion. Canonical Source/Claim/Review persistence
and the Safe Edit write receipt remain separate from primary verification.

Structured claim values must occur literally as complete numeric tokens in
the received excerpt, both when planned and on cold readback. `13.5` cannot
match `113.5`, `-13.5`, a longer decimal, grouped number or exponent. Sentence
punctuation and currency/percent annotations around a complete value are
allowed. No rounding, numeric-format conversion, unit conversion or investment
semantics are inferred. This observation matcher deliberately differs from the
stricter primary-attestation matcher; primary receipt semantics are unchanged.
An invalid historical anchor produces a current claim-binding HOLD without
rewriting its Source, claim or successful historical write receipt. Unit/quote
semantic fidelity remains a separate reviewer gate.

Numeric boundary validation uses the preserved **full Source**, not just the
caller-selected excerpt. Every occurrence of that excerpt must preserve numeric
boundaries; ambiguous safe/clipped occurrences HOLD rather than trusting the
free-text locator to select one. Numeric qualifications use the same boundary
rule (`up 10` does not match `up 106%`). Unicode minus/dash variants and literal
accounting parentheses are retained as part of the token, never converted to an
unsigned value or a different sign. Attached ambiguous unit/suffix forms stay
HOLD. These are lexical integrity checks, not semantic equivalence judgments.

Retrieval keeps legacy source candidates discoverable, but neither a `Primary
Evidence` filename nor `source_type`/`source_tier: primary` grants authority or a
primary ranking bonus. Company/macro primary-verification gaps remain open in
Context/Decision Packet. The packet separates declared candidates from its empty
`serverVerifiedPrimaryPaths` with `status: not_performed`; exact-scope PEV checks
remain the separate canonical assessment gate, unchanged.

Before staging acceptance, WORK must run the **read-only anchor compatibility**
scan on an authorized stable snapshot/read window using Node 24:
`node scripts/check-claim-anchor-compatibility.ts --vault /authorized/snapshot`.
There is no default live path or app/DB bootstrap. It returns JSON with scanned
and held counts, relative claim paths, reasons and a separate reviewed-resolution
proposal. It checks RI001-1 claim anchors and preserved Source-text hashes, not
full receipt/index/primary validity. Exit 2 means HOLD or scan unavailable/partial;
an overflow (1,000 claims / 5,000 directory entries) is `SCAN_INCOMPLETE`, not a
whole-Vault PASS. No repair, rebind, receipt mutation or historical rewrite occurs.
Live historical impact counts remain pending until WORK supplies that report.

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

## RI-001 general persistence convergence (CI candidate)

This extends existing canonical prepare/apply and Safe Edit, not a new writer,
database or automatic research promotion. Master 2.0.0 and frozen evaluation
fixtures are unchanged. Source identity v3, Judge-5 and Draft-2 remain in force.

### Received appearances

`appearance` is an optional, explicit intake input with `key`, `channel`,
`locator`, and `receivedAt` (offset-aware timestamp or null). Reuse the same
occurrence key on retry; use a new key for a separately received message/file.
Keys are scoped to the server's OAuth actor label, not a verified human/session.
Caller locators, publisher attribution and reported receipt time are unverified.
No key/time is inferred from document publication or from an LLM.

Canonical prepare records `RI001-APPEARANCE-1` as an append-only event in the
existing `safe_edit_events` journal, owned by the exact canonical Source operation.
The event retains original received text/hash, format, attachment reference/hash,
channel/message/file locator, source attribution, proposed Source pointer and
runtime `recordedAt`. Its HMAC binds the payload and runtime timestamp using the
existing server key; it is NOT publisher authentication or a Primary Receipt.
Existing key-retention/backup requirements apply; unavailable/changed signing
key causes a readback HOLD, never automatic resealing of historical records.

Current disposition is `pending_source` until the ordinary Source write receipt,
readback, index and hash validate; then `source_bound`. Damage/interrupted writes
produce `binding_hold`. A prepared event alone never proves Vault persistence.
Repeated identical calls reuse one appearance. A conflicting retry key is refused;
separate occurrences can link the same immutable Source without another Source
write. Event recording requires normal Safe Edit settings and refuses maintenance.

Read-only `inspect_intake_appearances(intakeId, appearanceId?, offset?)` returns
25 records plus a pagination sentinel; specifying an appearance ID recovers the
exact received text. It does not initialize or migrate a historical ledger.
Source/receipt bytes are never patched. Original Source authenticity and economic
independence remain unverified; independence increment is always zero.

Accounting covers **admitted canonical submissions with explicit appearance
metadata**. Legacy calls without metadata have no inferred appearance history.
Schema/provenance-invalid submissions are explicitly refused before accounting;
callers must retain rejected input. In particular, an unverified format/kind
change against an existing Source remains `M56_SOURCE_PROVENANCE_CONFLICT`, not
an invented same-source relationship. Different received bytes are not normalized
away; the existing new-Source/event-reconciliation rules still apply. This is
not a general channel-ingestion archive, archival retention service, or automatic
grouping of differing formats. No legacy importer is used.

### Structured estimate and accounting dimensions

Optional `estimate` contains `{role, provider, forecastVintage}`. Role is
`broker_estimate`, `consensus` or `unspecified`; provider/vintage are explicit
nullable strings. `forecastVintage` reuses the nullable attributed-vintage concept
of Research Decision V2; no date/provider is inferred from that shadow assessment.
An estimate role requires `evidenceClass=analyst_estimate`; management guidance
and reported actual remain distinct classes. Provider/vintage/role omissions
remain unresolved for duplicate/corroboration comparison, including legacy
unscoped analyst estimates. They may persist only as unverified observations.

Optional `accountingBasis` contains nullable `standard`, `shareBasis`, `scope`,
and `definition` labels. These distinguish explicitly supplied GAAP/non-GAAP,
basic/diluted, segment/consolidated, or differing FCF definitions. The backend
does not derive these labels from financial wording or verify that they are true.
Metric strings that already differ continue to distinguish legacy identities.

Company claims without either new object remain **RI001-1 byte/ID compatible**.
Explicit dimensions use **RI001-2**: domain + original Source intake + normalized
entity/metric/period/unit/evidence class + all explicit dimension values determine
identity. New domain-scoped claims also use RI001-2, in the existing Company
Research, Industry and Concepts, or Macro and Markets folders; Asset research
stays in Research, never Portfolio/Trade. Missing folders still refuse writes.
No migration/backfill/automatic upgrade of RI001-1 notes or receipts occurs.
Reading new RI001-2 identities requires these upgraded readers. Backward readback
of RI001-1 is covered; this does not certify an older application rollback after
new RI001-2 writes. Refresh connector descriptors before using the new inputs or
appearance inspector. No runtime rollout is authorized by this CI candidate.

Different providers/vintages/bases coexist; changing a value within the same
identity is a conflict requiring reviewed correction, not overwrite. Rounding
is not adjudicated automatically. Readback recomputes versioned identity and
checks the original Source, receipt, index and links. `review_investment_claim`
returns the dimensions and compares only identical, sufficiently specified
estimate identities. Values across providers/vintages are not contradictory
merely because they differ. The read-only anchor compatibility script recognizes
both versions but remains scoped to the existing Company Research directory;
it does not certify dimensions, Primary Receipt authority or all-domain coverage.

Judge input digests already cover the complete input, including new dimensions
and appearance metadata. Changes require a fresh packet/assessment; no old PASS
is reused for a changed claim bundle. Same-intake writes retain existing receipt
prerequisites and All-or-Hold controls. Primary corroboration is a separate
reference/receipt: it never rewrites received user/broker/social origin, and
revocation does not delete historical Source/Claim/Review bytes. Drafts remain
historical-only, non-comparator, and zero independent-evidence increment.

Task-local PC-1…PC-6/GREG-01…GREG-20 text was not available during implementation;
named engineering probes are not claimed as those Gold evaluations. Synthetic
Judge results test binding/admission only, not semantic research quality.

### PR #167 corrective admission and recovery contract

A valid HOLD/FAIL for the **currently admitted exact Judge envelope** withdraws
its non-Source grant before appearance validation, request-token validation or
re-planning. The SDK ingress hook applies only to the two canonical tools, after
OAuth scope and maintenance admission; normal typed descriptors and full
validation remain. Withdrawal binds actor, Intake, Source operation, body digest,
exact envelope fingerprint (including issue time/seal), result binding and the
existing target manifest. It never adds targets or grants PASS. An older envelope
cannot revoke a later admission even when their stable packet bodies are equal.
A non-PASS envelope cannot be reactivated by replaying or editing its PASS result.
Reassessment, even of unchanged input, requires a fresh server-sealed envelope
with `issuedAt` strictly later than both the prior envelope and withdrawal, and a new analyst result explicitly bound to
that exact envelope. Changed input, including appearance, also requires fresh
packet/assessment. Pending gates
without the new envelope fingerprint/issue time cannot authorize non-Source
writes; Source preservation and existing receipts remain independently checkable.

Withdrawal can restrict a previously admitted grant after key loss/rotation
using its server-recorded envelope fingerprint. This is **not** a way to validate
a new packet or re-seal any appearance under a replacement key. Post-write
appearance/re-plan failures return the collected receipts and explicit
verification HOLD; they do not turn a completed write into a reported no-write.
Unconfirmed write attempts are reported as unknown, never as proof of no mutation.

Appearance inspection isolates each malformed/HMAC-invalid/binding-invalid row
as HOLD. Diagnostics expose only a stable journal-row reference and bounded
reason, with no raw text, locator, actor or key material. Owning Source-operation
scope keeps malformed appearance JSON in its pagination position. Missing Source
operation ownership raises an unscoped journal HOLD rather than guessing scope.
Valid neighbors remain readable. Known conflicting retries are rejected before
new Preview rows; a restrictive Judge withdrawal may still be journaled first.
No repair, deletion, skipped corrupt scoped row or automatic re-sealing occurs.

New plans treat all-unknown `estimate`/`accountingBasis` objects like omission;
partial supplied dimensions remain explicit. RI001-1 IDs and bytes do not change.
Historical RI001-2 empty-object identities are still decoded using the original
identity formula. If one already exists, an equivalent normalized plan explicitly
HOLDs for reconciliation instead of creating a second Claim or rewriting a receipt.

**F-4 release STOP before the first RI001-2 staging write:** WORK/ORCH must verify
the exact independently accepted corrective PR #167 image and all claim readers,
refresh connected client descriptors, confirm a current-generation coordinated
backup/recovery set, and establish encryption-key continuity. This CI task performs
none of those live operations. RI001-2 decoding first appeared at
`b8008c0e2acebd5d18f5ab45878a06b6c271f8b3`; that candidate has the rejected F-1
admission defect and is **not** an approved write/rollback target. Operational
minimum is the accepted corrected successor, pinned by exact commit/tree/image.
The `6cd9c3cd558dac3d67e9202d8652b406cfdc332a` reader lacks RI001-2 receipt-bound
classification and must not be pointed at RI001-2 data for research acceptance.

The required recovery set covers matching Vault/attachments/archive bytes, the
application DB with a consistent WAL state, Safe Edit operation/event journals,
receipts, exact code version and the corresponding securely retained
`ENCRYPTION_KEY`. Keep key material out of repository/logs/reports. It authenticates
appearance records and existing application data; retaining DB/Notes without the
matching key is insufficient. Rotation/multi-key verification is not implemented.
Lost/changed keys mean HOLD and a separately authorized recovery procedure, never
editing seals or historical receipts to obtain PASS.

After RI001-2 writes, an application-only rollback to #166 or another old reader
is prohibited. Prefer forward recovery with a compatible corrected reader and
unchanged data/key. Any return to a pre-RI001-2 generation requires a separately
authorized coordinated restore/reconciliation plan that accounts for all later
appearances, Notes and receipts; this is not permission to discard later writes.
Do not run migrations, downgrade Claim IDs, rewrite receipts or auto-convert
RI001-2 to RI001-1. If these conditions are unproven, remain stopped before writes.


### P-1 same-envelope replay and reassessment

`assertJudgeAdmissionOrder` treats HOLD/FAIL as terminal for an exact envelope.
A valid PASS retry before any HOLD remains idempotent; a held/revoked envelope
cannot become PASS, even with an edited rationale. Pre-issued packets from before
the withdrawal cannot recover authority; legacy HOLD time is read from the
original server journal without rewriting it. An obsolete envelope cannot
withdraw a newer admission. The journal re-reads the current admission and checks
ordering inside one SQLite `BEGIN IMMEDIATE` transaction before appending, so a
concurrent stale PASS check cannot overwrite a committed withdrawal.

The packet tool returns `packetEnvelopeDigest` separately from the stable body
digest. After HOLD/FAIL, the connected analyst must request a later packet,
reassess its evidence and echo this digest as `researchJudge.result.packetEnvelopeDigest`.
Copying the prior result onto a fresh same-input envelope fails binding. A supplied
wrong envelope digest always HOLDs; missing envelope binding cannot recover a
non-PASS admission. For compatibility, an otherwise valid legacy initial PASS
and its retries before any HOLD remain supported. No historical receipt is
rewritten. Descriptor refresh is needed for clients performing reassessment.

Issuance uses real server time; no backdating or artificial future timestamps.
Identical same-millisecond input may produce the same envelope, which remains
revoked; a distinct envelope with a tied/older issue time is refused. Request a
packet once the server clock is later. Clock rollback fails closed. Source-only
preservation remains separate under existing rights and maintenance controls.

The echoed digest proves exact-envelope attestation, **not** that a fresh human
or LLM reasoning pass occurred, nor the truth of an investment claim. The current
actor/session and independent-critic limitations remain unchanged. Tests use
simulated results solely to prove deterministic admission/replay behavior.

MCP SDK is pinned to the existing resolved `1.32.1` (no upgrade). Real MCP tests
exercise validation-before-handler behavior; a missing validation hook refuses
endpoint construction. Any future SDK change requires this compatibility check.

### P1-LEGACY: cross-version terminal admission

A HOLD/FAIL written by `6cd9c3cd558dac3d67e9202d8652b406cfdc332a` is
restrictive even though that format has no `packetEnvelopeDigest` or
`packetIssuedAt`. Missing envelope identity is not missing withdrawal authority.
The shared admission guard applies terminal-state/fresh-assessment requirements
before any version-specific ordering allowance. A new PASS must carry a valid
fresh sealed packet issued strictly after the server-recorded withdrawal and a
result bound to that exact envelope. Existing new-format ordering checks remain.

For the old format, the reader derives withdrawal time only from the original
server event. It must be canonical UTC ISO with milliseconds. If a preceding
admission exists, the withdrawal must be strictly later; missing, ambiguous,
corrupt, tied or reversed chronology HOLDs. Unknown withdrawal time cannot be
washed away by submitting another HOLD; a pre-issued packet cannot replace the
restriction with an earlier recovery clock. These cases need separately reviewed
reconciliation, not an inferred time, edited journal or automatic re-sealing.
The reader does not add envelope fields to old records or rewrite any event.

Source-only preservation remains separately eligible under existing controls.
Historical Source/RI001-1/Review bytes and real receipts remain readable. Refusal
and Source-preview audit events may be appended; they are not new Claim/Review
writes or replacement Judge grants.

The permanent cross-version test archives the exact old Git commit and executes
its actual Judge/canonical/Safe Edit code to produce seven disposable DB/Vault/key
states (PASS/HOLD/FAIL with pending/saved Source, plus fully saved RI001-1 history).
The current reader opens copies of those real states. No legacy gate is simulated
by deleting new-format fields, and no receipt is manufactured. Timestamp damage
is injected only into disposable old gate events for negative tests. CI fetches
that single exact base object; absence/mismatch fails rather than substituting
current code. Simulated analyst results still do not establish semantic quality.


### L2: authenticated withdrawal of a legacy PASS at new Apply

An authentic HOLD/FAIL for an enrolled legacy PASS must be recorded before
appearance checks, planner/token rejection or MCP SDK argument validation. The
new-format path still authenticates the exact enrolled envelope fingerprint.
Legacy gates have no fingerprint, so body-digest equality alone is insufficient:
the shared envelope verifier validates the original HMAC using the authorized
server key, actor label, packet body digest/ID, policy/version and validity times.
The result must bind that packet and Review; required-bundle verdicts retain the
existing All-or-Hold rules. Targets come only from the original enrolled gate,
never the malformed request. The original actor-owned Source operation must
match intake, path, after-bytes SHA and received-text SHA.

Withdrawal appends a restrictive event with the authenticated envelope identity
and the actual withdrawal time. It does not modify the legacy event or convert
its PASS into new write authority. The original gate snapshot is checked again
under the existing SQLite IMMEDIATE transaction before append; a superseding
admission cannot be overwritten by an earlier authenticated withdrawal. Repeated
same-clock withdrawals remain restrictive and FAIL is not downgraded to HOLD.
Fresh reassessment after withdrawal still requires a later sealed envelope and
matching result-envelope binding. Source-only eligibility remains independent.

Unlike an already fingerprinted gate, a legacy PASS cannot authenticate a
withdrawal if the original packet has expired, its seal is invalid, or the
original ENCRYPTION_KEY is unavailable/rotated. Such requests are refused without
inventing a seal or modifying an unrelated gate. Pending legacy non-Source writes
remain blocked by the existing missing-envelope admission guard. Retain key
continuity; do not mistake request rejection or an unchanged historical PASS
label for current non-Source write authorization. No automatic key recovery or
historical repair is provided.

Cross-version tests create PASS-only fixtures with actual `6cd9c3cd` modules,
then exercise both direct canonical and real MCP Apply (including SDK-invalid
appearance/token arguments), replay denial, fresh recovery, Source preservation,
forged/expired/wrong-actor packets, concurrent retries and transactional recheck.
All original event/receipt bytes and protected files remain unchanged in fixtures.
These simulated results prove enforcement, not fresh LLM reasoning or fact truth.

### N3: receipted standalone Sources in bounded Judge history

Issuer-scoped context can discover an original Source before any Review exists.
It uses an FTS body query under the exact canonical Source path family, stable
path order, at most sixteen candidates per resolved issuer and one sentinel.
Only current, readback-checked Hub titles and unambiguous indexed aliases supply
query labels. The label must occur as a full identifier in preserved original
text, not only in publisher/frontmatter/URL. This is **lexical relevance**, not
proof of a primary subject, issuer/instrument equivalence, claim truth or event
identity. Multi-issuer mentions remain mentions; semantic attribution is for the
analyst/Judge. No-URL Sources are eligible without inventing an origin URL.

Admission checks the existing exact create receipt/audit, canonical path/intake,
physical/index metadata, complete FTS body and original-text digest. It never
issues a replacement receipt. Receipt-bound chronology and publisher/source URL
remain attributed declarations. `sourceBinding` describes this provenance and
keeps `independentEvidenceIncrement=0`, `primaryVerification=not_performed` and
`economicEventEquivalence=not_established`. Repost appearances do not create extra
history entries for the same Source path. Already paired Source/Review paths are
not added again. The original received text supplies the bounded excerpt with
full-note line/span locations; metadata cannot displace it as the quote anchor.

Attempted read/search/receipt/index failures are operational HOLDs in the existing
coverage observer. Candidate-window and selection-quota omissions remain explicit
bounded coverage, not an exhaustive-search assertion or blanket HOLD. Invalid
in-scope records are never silently trusted. Files outside the canonical family
and unmentioned issuers cannot contribute this binding. Unrelated changes and
intentional omissions do not invalidate an unchanged effective selection.

The existing sealed selection manifest, source hashes, issuer witness and shared
Safe Edit apply-time revalidation protect this history too. Exact own-intake
writes are excluded using the existing server-owned target/actor/receipt rules
before discovery bounds. New selected evidence or invalidated bindings require a
fresh packet/assessment. No new writer, permission, migration or Judge exception
is introduced. The existing mandatory critic HOLD for material added detail or
contradiction is unchanged. Mechanical binding tests do not prove semantic
entailment: orders 100 and pilot shipment 20 are separate input evidence and are
not automatically summed or declared independent confirmations.

### N2: no-URL received-text claims (RI001-3)

An explicitly requested structured observation may cite a received LINE,
Telegram or user-supplied text without inventing an original publisher URL.
The existing canonical intake/Safe Edit flow writes Source, Claims and optional
Thai Draft. Feed Only without `claims` still writes only the Source. No connector,
writer, database migration, issuer permission or verification tier is added.

No-URL claims use a separate `RI001-3` identity namespace with the existing
intake/entity/metric/period/unit/evidence-class/provider/vintage/basis dimensions.
URL-backed RI001-1/RI001-2 identities and serialized bytes are unchanged. The new
reader accepts all three versions and never rewrites old receipts. Older readers
cannot validate RI001-3: retain a reader with this extension after the first
RI001-3 write; do not claim an app-only downgrade preserves claim readback.

`origin=received_user_source`, `original_source=null` and
`original_publisher_url=null` describe the received appearance, not the ultimate
publisher. The binding records canonical Source path/intake, full Source-note SHA,
exact preserved-text SHA and a deterministic Source operation reference. That
reference is explicitly a **durable receipt requirement**, not an issued receipt.
Preview may use the same actor's exact prepared Source; Apply, under the existing
Safe Edit lock, requires actual Source bytes, complete indexed body and authentic
existing create receipt/audit. Cold read repeats these checks. Both generic and
canonical Claim routes use the same guard; no caller can supply a substitute
receipt. New-format Claim bytes are immutable; reconciliation is separate.

The server records an exact UTF-16 quote span in the preserved received text
(first literal occurrence, with no semantic disambiguation claim). The original
free-text locator is retained as `declaredLocator`, never authenticated as a PDF
page, original publisher location or message-channel identity. Numeric boundaries
continue to be checked against the full Source. MCP retrieval fences untrusted
quote/locator text. Use the exact canonical Source path as `originalSource` in
`review_investment_claim` for same-received-source matching; the returned original
publisher URL remains null. A later company/primary URL cannot replace this origin.

Claims remain caller-attributed/unverified, with zero independent evidence
increment and comparator eligibility false in the existing trust projection.
Several Claims or appearances of one Source do not constitute independent
confirmation. Draft remains historical-analysis-only. Opt-in Judge All-or-Hold,
actor/CAS/token checks, critic requirements and Protected Record boundaries are
unchanged; removing Judge input after a HOLD/FAIL cannot authorize a Draft fallback.
Persistence/receipt tests prove mechanical integrity, not semantic fidelity.

The existing offline anchor-compatibility script remains explicitly scoped to
RI001-1/RI001-2 and reports RI001-3 as unsupported/HOLD; it is not a replacement
for RI001-3 receipt/index/link validation by this reader. No historical scan or
live data migration is performed by this change.
# C1 Source-only to existing Review reconciliation (candidate, not runtime acceptance)

`C1-REVIEW-REUSE-1` separates appearance/Source identity from an economic-event
decision. A new Intake ID, missing origin URL/date, or an empty bounded duplicate
search is not proof of a new economic event. When the existing bounded company
history contains another Review candidate and URL/event/publication identity is
incomplete, planning reports an explicit unresolved-event warning and bounded
Review candidates. This does not establish novelty, duplication or equivalence.
Only an explicit `existingReview` selection invokes the restrictive revision
contract; an `existingIntakeId` alone identifies received bytes, not an event.
Legacy/unselected Draft admission is preserved under existing gates. Clients must
carry the Source identity and proposed Review relation; relatedness cannot be
inferred just from company identity. Mandatory event-selection admission remains
a contract gap, not something this patch silently imposes on every legacy writer.
Source-only remains independently eligible. An existing exact same-intake Review
can still be read/retried; ordinary dated new-source admission retains its existing
quality, Judge, reviewer, and CAS gates. This does not certify any event as new.

The optional typed `existingReview` input (path, expected SHA-256, original
canonical receipt ID, proposed relationship, comparison rationale) is shared by
the read-only planner, canonical prepare/apply and Judge-packet input. It checks
the current resolved issuer, exact Review/Source receipt chain, index, readback,
chronology and links. Selection is bounded to canonical Company Reviews; missing,
legacy-unbound, stale or wrong-scope records HOLD. A caller relationship is an
analyst proposal, never an authenticated same-event or independent-source verdict.

`reviewReuse` reports the existing and additional Source receipts separately.
The additional receipt is null until the Source is actually persisted. A valid
selection returns `revision_proposal_only`, no append/write token, no second
Review, and no claim that the existing Review now incorporates the new Source.
Missing/invalid selection returns explicit reasons while retaining Source capture.
Every proposed relation keeps independent evidence increment zero.

The existing C1 checkpoint is **add-only**. Authorizing an existing Review
revision needs a separately accepted revision admission contract: fresh semantic
assessment of the exact multi-Source content and selected history, authenticated
reviewer-session decision over the full diff, current before-hash CAS, write lock,
and receipt/readback/index/link verification. This candidate does not authorize
that extension or use generic append to circumvent it. M5.6's owner-gated revision
proposal remains a proposal. Material corrections and contradictions retain their
existing HOLD/critic requirements. No economic-event ID is invented from dates,
publisher names, titles or financial keywords.

Context `researchFallback` exposes up to twelve already-discovered Review/Source
records outside the selected note/excerpt budget, with exact receipt/hash status,
dates and conservative trust labels. It adds no scan or selection/ranking change.
`truncated` and existing scan/coverage reasons remain explicit. These hints are
**not** part of the Judge's selected evidence; read the exact path/intake and build
a fresh packet before reassessment. Unknown publication dates remain unknown;
no import/mtime substitution or claim of exhaustive/recent-event recall is made.

Local MCP `tools/list` parity is not installed ChatGPT descriptor availability.
Client refresh, exact endpoint/OAuth actor/audience binding, independent delta
review and isolated runtime acceptance remain separate gates. No deployment,
connector refresh, historical rewrite or protected-record write is authorized.
