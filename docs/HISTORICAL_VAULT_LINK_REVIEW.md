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

## Future extensions (not implemented)

- Human-reviewed synonym/alias matching for cross-company and sector context.
- Source-and-counter-evidence graph with **independently verified** event-date
  lineage and typed economic relationships (beyond navigation pointers).
- Explicit staged Safe Edit previews for a manually selected set of approved
  changes, one note at a time, never a silent vault-wide migration.
