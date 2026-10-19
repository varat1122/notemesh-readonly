# Historical Vault Link Review — development-only

## Objective

Improve retrieval and reading of previously archived investment analysis without
rewriting its facts, attribution, dates, source bytes, user-approved theses or
portfolio records. This is the **review queue** stage, not a bulk migration.

The existing `auditVaultKnowledgeIndex()` read-only tool now includes
`linkHealth.historicalReview`. It examines the completed indexed knowledge
metadata and proposes a small set of cross-note Obsidian wikilinks.

## Evidence boundary and strict matching

- Candidate **source**: an existing non-protected review or historical-analysis
  Markdown note with an explicit `entity` in YAML.
- Candidate **destination**: a note with the **same exact declared entity**
  (case/NFC normalized), ranked Current Thesis > Company Hub > Timeline >
  Evidence Register. This rank is navigation convenience, not evidence weight.
- Entity identification comes **only from frontmatter**. The planner does not
  guess a ticker from the title or prose, infer relationships from co-mentions,
  scrape raw archives or equate company aliases. No confidence score can
  promote a suggestion into a verified factual relationship.
- If multiple destinations share the highest priority role, **hold for manual
  adjudication**; no arbitrary winner. If the source already links to the exact
  indexed destination, suppress the duplicate.
- If the index has not completed rebuilding or the indexed metadata scan is
  truncated, return `incomplete_index_hold` with **no suggestions**.
- Source archives in `07_Sources`, `06_Portfolio`, thesis files under
  `05_Thesis`, and templates are never edit-source candidates. A thesis can
  appear as a destination **link only**, not a proposed mutation.
- Output is deterministic and bounded to eight sample proposals; the count of
  candidates is retained for review. A candidate does **not** imply a missing
  or wrong investment thesis, an independent source, or a verified issuer claim.

## Safe user-approved historical editing workflow

1. Run the read-only audit after a completed index rebuild. Select one
   `historicalReview.samples` proposal and read **both entire notes**.
2. Verify the proposed linkage represents the intended company and analytical
   context (not merely a coincidental entity label). Check duplication,
   original attribution, contradictory evidence and date provenance.
3. If the link is useful, use the **existing separate Safe Edit** OAuth
   `preview_edit` on the source Markdown note. Choose an exact unique body
   `replace` to insert the suggested wikilink in a human-selected paragraph,
   or `append_section` under a matching heading when a dated review is
   appropriate. Do not create an unsolicited bulk edit or alter YAML implicitly.
4. Inspect all changed lines, before/after hashes, added/removed link warnings,
   and source provenance. Thesis or user-endorsed changes require separate
   explicit admin hash approval; `07_Sources` and `06_Portfolio` remain
   protected from generic editing.
5. Apply only the exact approved preview token/expected hash, check its
   durable receipt and reindex readback, then independently inspect backlinks.
   Sync to remote/mobile must be checked separately; no receipt asserts that a
   second device has received the change.

This PR **does not** enable Safe Edit, change feature flags, write a Vault note,
run automatic edits, or alter DR freeze eligibility. No credentials, production
backup activation or deployment. A source-level unit test and scratch Vault +
SQLite integration tests cover incomplete index, exact issuer matching,
ambiguous destinations, protected paths and unchanged original note bytes.

## Targeted read-only handoff to Safe Edit (development-only)

The read-only MCP endpoint now exposes `prepare_historical_link_edit` with
`sourcePath`, `targetPath`, and `anchorLine`. Use it only **after reading
and understanding both notes**. The operator selects one exact, unique prose
line in the existing source note; the service refuses to guess a placement or
reuse a line from frontmatter, code fences, tables or ambiguous text.

The handoff independently confirms that the complete index still matches
an eligible exact-entity historical link proposal, that the source has no
indexed link to the destination, and that actual on-disk metadata still agrees
with the index. Both files are read through descriptor-anchored non-symlink
opens; before/target SHA-256 hashes are returned. Size, UTF-8 validity and
Safe Edit's 100 KB Markdown write cap are checked before proposing a patch.

The response contains a **not-yet-submitted** Safe Edit-compatible
`{path,reason,change:{kind:"replace",oldText,newText}}` template. The new
text inserts a neutral **navigation-only** wikilink after the selected prose
line; it never implies source verification or thesis endorsement. A separately
chosen fresh `operationId` is needed when explicitly invoking Safe Edit's
`preview_edit`. Its own version, conflict, admin approval, exact-token
apply, readback and Sync checks are **not bypassed**.

There is no automatic note editing, Safe Edit OAuth grant or automatic
operation ID reuse. If the index is incomplete, the source changed, a link
already resolves, the role/entity is inconsistent or the anchor is unsafe,
the handoff fails closed. The returned SHA is evidence of what was read, **not**
proof that the source remains unchanged when approval/apply occurs.

## Cross-domain Evidence Navigation — proposed links only (development-only)

The existing **read-only** `get_vault_info().knowledgeAudit.linkHealth`
now also returns `crossDomainReview`. This is designed for the **entire indexed
Investment_OS Vault**, not any hard-coded ticker, issuer, country or sector.
It can connect company, industry/supply chain and macro/research notes only
where a note's YAML metadata explicitly declares a navigational reference.

Supported metadata fields on an otherwise eligible review/industry/company note:

- `related_paths:` — a YAML array of **exact, vault-relative indexed Markdown
  paths**, such as `01_Companies/AMD.md`. No filename guesses, aliases,
  fuzzy issuer matches, remote URLs or `../` traversals are accepted.
- `related_claim_ids:` — a YAML array of **exact Claim IDs** corresponding
  to `claims[].claim_id` in an indexed structured claim register. The ID
  must be **unique across all indexed claim-register notes** before proposing
  one destination. A duplicate ID is ambiguous, not extra independent evidence.

A matching reference is **not** proof that macro changes caused a company's
earnings move, that a supply-chain relationship is commercial, or that a claim
is verified or independently sourced. It is a metadata-declared **navigation
candidate requiring a human to read both notes, check attribution, chronology,
counter-evidence and intended link direction** before any edit.

The planner scans up to 10,000 indexed notes and returns only eight bounded
samples, alongside counts for unresolvable, malformed, ambiguous and already
linked references. It fails closed if the index is incomplete or truncated.
Protected sources under `05_Thesis`, `06_Portfolio`, `07_Sources`, and
`09_Templates` are **never** proposed for editing. Existing resolved links
are not duplicated. A new metadata field alone never triggers a write.

**Important:** This PR only adds cross-domain proposals to the audit.
PR #65's `prepare_historical_link_edit` handoff is specifically validated
for same-entity historical navigation and must **not** be assumed to authorize
or prepare cross-domain relationships. Cross-domain Safe Edit needs a distinct
verified, owner-approved handoff and independent direct-source review before
any one-note preview/apply. No existing note has been changed.

## Vault-wide Metadata Readiness — all indexed roles, no bulk edits

The **read-only** `get_vault_info().knowledgeAudit.metadataReadiness` is a
whole-index inventory (up to 10,000 indexed notes) to guide which legacy
research areas deserve human attention first. It is NOT a migration, note
verification, or instruction to rewrite all files.

It counts indexed notes by **role** and their top-level **Vault folder**,
with separate indicators for declared `entity`, `related_paths`,
`related_claim_ids`, `event_date`, `published_at` and `imported_at`.
Legacy `date` without `event_date` is reported as a field-presence gap;
the system does not silently turn import/publication dates into event dates.

For *eligible* historical-analysis, review, industry and company Notes outside
protected folders it also distinguishes:
- Notes with at least one declared navigation-reference array vs no declared
  reference. **No declared relation is not an error or proof a link is missing**.
- Historical derivative notes whose issuer/domain is **not explicitly
  declared**. Never derive entity identity from a filename, headline or
  co-mentions.
- Malformed relation-reference fields (not bounded arrays of nonempty
  strings), which require manual cleanup before link proposals.

The output gives deterministic **eight-note example lists** for each review
category, full aggregate counts, and a truncation indicator. It never
rewrites frontmatter, creates YAML metadata, edits sources or produces
automatic Thesis changes. Protected Thesis, Portfolio, Sources and Templates
are counted for context but excluded as edit-source candidates. Partial or
still-rebuilding indexes return an explicit **hold** instead of presenting
coverage as a complete Vault census.

### Uniqueness correction to cross-domain Claim ID review

`crossDomainReview` now treats **two identical Claim IDs inside one claim
register as ambiguous**, even when those IDs belong to the same file path.
If *any* indexed register declares more than the 100 scanned claim rows
allowed by the source schema adapter, the planner holds **all Claim-ID-based
links** because global uniqueness cannot be established from a truncated
scan. Explicit literal-path navigation remains independently reviewable.
The response exposes `claimIndexTruncated` and `heldClaimReferences`.

These safeguards avoid creating false confidence that a referenced financial
figure has one owner or is independent evidence. The next step is human
normalization of selected metadata and source/claim verification; no
Production Vault mutation or global automated rewrite is authorized.

## Legacy Metadata Compatibility — evidence-informed read-only development

### Read-only Production observation (2026-10-19, not a migration)

The authenticated `Investment OS — NoteMesh Read Only` tool's
`get_vault_info` and `read_properties` were queried on 2026-10-19.
Its deployed version remained at Production commit `b563c55` and **does not
yet contain the Draft PR features** in this section.

At that snapshot there were **3,375 indexed of 3,375 Notes**, including
**1,195 historical-analysis**, **1,322 ChatGPT archives**, **203 company**,
**49 industry** and **244 review** entries. The indexed link table had **4
orphans** and **54 unresolved link targets**; several unresolved samples are
historical ChatGPT archive JSON locators, *not* permission to fabricate or
change an archive. These are indexed metadata counts, not a full semantic
truth/primary-source verification.

The Vault's existing metadata-property survey reported `company` in
**1,417 notes**, `theme` in **2,617**, `related_notes` in **33**, but
`entity` in only **245** (property counts; a field may be an array or scalar).
A sampled 2026-07-16 historical ASML note explicitly declared
`company: ["ASML"]`, `theme: [...]`, `source_records: [...]` and
`verification: not_reverified`, while `01_Companies/AMD.md` was an
existing company hub without a canonical `entity` field. Existing industry
and macro hubs already had outgoing Obsidian wikilinks in their note bodies.
This makes "missing entity / related_paths" a poor proxy for "not linked".

### Review-only compatibility in this Draft PR

`knowledgeAudit.linkHealth.legacyCompanyReview` counts selected **legacy
frontmatter field presence** for `company`, `companies`, `ticker`,
`theme`, `related_notes`, `source_records`, `related_paths`, and
`related_claim_ids`. It also counts **existing indexed outgoing links** for
eligible historical-analysis/review notes before suggesting anything.

It may suggest a **navigation-only** missing wikilink when **all** hold:

1. Source role is review/historical-analysis outside Sources/Thesis/Portfolio/
   Templates, with no already-canonical `entity` field.
2. Legacy `company`, `companies`, or `ticker` is a **single explicit
   safe uppercase code** (e.g. `ASML`), not a multi-company list; if multiple
   declared fields coexist they must **agree exactly**.
3. Exactly one existing indexed Company Hub has the **literal canonical
   filename** `01_Companies/<CODE>.md`. Company names/aliases, fuzzy title
   matches and guessed tickers are **not** substituted for the literal code.
4. The existing indexed link table confirms that the source does **not**
   already link to that exact destination. No additional link is needed when
   already connected.

It never treats `theme` as proof of supplier exposure or revenue
contribution. `source_records` and `related_notes` are **legacy
reference declarations**, not newly minted independent sources. It does not
write metadata or link content, modify protected Thesis, authorize Safe Edit
or claim that an outgoing backlink makes the historical reasoning correct.
Samples are bounded to eight with full review counts; incomplete index
returns `incomplete_index_hold`.

This fills an *actual compatibility gap* visible in the Production metadata
without asserting that the Draft functionality has run against the entire
live Vault. Review full notes and source provenance before choosing a
separate approved Safe Edit preview.

## Human Review Priority Queue — provenance before navigation

This development-only PR introduces
`get_vault_info().knowledgeAudit.legacyReviewPriorities`, a bounded,
deterministic **read-only review queue** derived from the complete indexed
notes and existing **resolved** Obsidian wikilinks. It is a planning order for
a human reviewer, **not** investment materiality, earnings impact, "Price In",
verified facts, edit authorization or a migration.

The queue is computed for **all** eligible historical/review Markdown notes
outside protected Thesis, Portfolio, raw Sources and Templates (up to the
10,000-row index cap), without presuming that missing `entity` or
`related_paths` means there is a missing relationship. It checks:

| Priority | Exact metadata signal | Required manual decision |
| --- | --- | --- |
| P1 provenance | A declared safe `source_records[].md` path is **not in the current index** | Verify archive/export location and whether original data exists; no invented source |
| P1 chronology | An explicit `event_date` is not a valid date or zoned datetime (e.g. `Unknown`) | Determine event/publication/import dates independently; do not guess |
| P2 traceability | A declared indexed `source_records` target has **no indexed resolved outgoing wikilink** from source note | Read the original note and link conventions before considering a navigation fix |
| P2 metadata | Malformed `source_records` array, or conflicting single-code `company` vs `ticker` | Verify declaration/issuer scope before any proposed update |
| P3 navigation | One explicitly declared legacy uppercase company code matches an **existing literal** `01_Companies/<CODE>.md` path but has no resolved link | Decide if linking improves research navigation without duplicating context |

The classifications are **review signals, not error verdicts**. Notes that
intentionally contain multiple companies are not mislabeled defective or
force-mapped to an issuer; old `date` / `imported_on` values are never
silently promoted to `event_date`. References in a JSON/ZIP archive may be
absent from the Markdown index by design; separate source-archive integrity
and device Sync checks remain necessary.

The full queue is counted by kind and P1/P2/P3, but only **four examples per
kind** (maximum 24) are returned, in a deterministic order, with source and
exact declared target path where available. If the index is incomplete or
over 10,000 notes, it returns `incomplete_index_hold` and no proposed edits.

This PR adds **no** new MCP tool, grant/scope, write endpoint or background
job. It never calls Safe Edit, changes a note, infers causal supplier
relationships, assigns current financial figures or promotes an archived AI
summary into primary evidence. If a human approves a correction, the *separate
one-note* Safe Edit workflow still requires a fresh preview, diff, version,
approval, apply, readback and independent Sync verification.

### Evidence boundaries

The read-only Production survey of 2026-10-19 observed 3,375 fully indexed
Markdown notes with legacy metadata and substantial pre-existing links. **The
new review queue has only been tested on isolated Development fixtures**:
actual P1/P2/P3 counts for this new function cannot be claimed until the
corresponding reviewed branch is deployed and the authenticated live
read-only audit is invoked. This PR is not authorization to deploy.

## P1/P2/P3 Dossier for a Human-Selected Note — no writes

The new **read-only** `get_legacy_review_dossier(sourcePath)` MCP tool
takes **one exact indexed historical/review Markdown path** from the
Vault-wide P1/P2/P3 priority queue. It is not limited to NVDA or any other
company and can drill down beyond the first four samples of any global
issue category. It does **not** accept raw source/archive/protected
Thesis/Portfolio/Template files as mutation candidates.

The dossier returns:

- The source's **actual current SHA-256 and byte length**, read from one
  descriptor-anchored non-symlink file open; current frontmatter, size and
  rounded mtime must still match the indexed copy or the dossier **holds**.
- Bounded literal note-declared metadata, including historical
  `source_records`, legacy `company`/`ticker`, `verification` and
  `event_date`. A legacy `date` is never silently elevated to an event date.
- Source-specific P1/P2/P3 findings evaluated against the **whole completed
  index**, with the exact original reference/canonical hub path where found.
- Counts and up to eight existing indexed outgoing links. Current hashes of
  review destinations are reported only if they are safely readable. A
  destination absent from the Markdown index is marked
  `not_in_markdown_index`, **not "deleted"**.

For P1 source provenance, the correct next action is to read the original
source and check date/source lineage. `sourceSha256` is a checksum of
the current Note, **not** issuer-file authenticity or original-byte archive
preservation. Even hashing a target ChatGPT archive proves only those
server-local bytes were read, **not** that they are independently verified.

This is **not a Safe Edit preview**, a proposed body replacement or
approval. It cannot execute any edit, update Current Thesis, verify market
prices, trigger backups, or assert mobile Obsidian Sync. Full human review
and a separately authorized one-note preview/diff/approval/apply/readback
remain mandatory for any later approved correction.

The entire pipeline is Development-only in stacked Draft PRs; the new
dossier's accuracy and outcomes have been checked on temporary fixture
Vaults and CI only. **No report of real Production P1/P2/P3 review counts
or mutation is implied**.

## Single-tool dossier hardening

The existing `get_legacy_review_dossier(sourcePath)` remains the **sole**
read-only per-note P1/P2/P3 drilldown. A second overlapping endpoint is not
introduced. Each finding now carries a short, type-specific **human evidence
decision** and explicit flags that no external claim was fact-checked or
automatic write is authorized.

For indexed referenced target files, `targetChecks.status` distinguishes:

- `indexed_current_bytes_read`: actual local bytes observed, SHA-256 returned;
  does **not** verify original issuer/source claims.
- `indexed_target_stale_hold`: target disk metadata/size/mtime differs from
  index; rebuild/reconcile before interpreting the link as current.
- `manual_read_required_or_index_changed`: target unavailable, unsafe,
  oversized or otherwise unreadable; **not** proof of deletion.
- `not_in_markdown_index`: declared target absent from the indexed Markdown
  table; do not invent archive bytes or conflate with device Sync failure.

The source note itself already fails closed on stale index, hardlink/symlink,
invalid UTF-8 or oversized bytes. All target statuses are observations,
not independent evidence. No Safe Edit preview/apply/authorization is created.

## Future extensions (not implemented)

- Human-reviewed synonym/alias matching for cross-company and sector context.
- Source-and-counter-evidence graph with **independently verified** event-date
  lineage and typed economic relationships (beyond navigation pointers).
- Explicit staged Safe Edit previews for a manually selected set of approved
  changes, one note at a time, never a silent vault-wide migration.
