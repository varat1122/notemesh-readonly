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
   journals a receipt/backup, writes source before review, and independently
   checks SHA/readback/index. The response re-plans from the actual Vault.
3. Only `outcome:saved_verified` / `readyForNextNews:true` confirms a finished
   Source + Canonical Review cycle. `source_saved_analysis_pending` is valid
   only for Feed Only. Inspect `interrupted` and individual `steps` when pending.

This is **recoverable add-only two-step writeback, not a single atomic file
transaction or background queue**. A successfully stored Source is retained
when a Review fails. Interrupted Safe Edit journal operations require operator
reconciliation; the system never silently overwrites another writer's note.

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
- Existing M5.3 planner + per-file Safe Edit remain available as fallback.
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
