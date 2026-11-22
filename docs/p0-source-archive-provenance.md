# P0 Source archive provenance integration

Task: IOS-ORCH-P0-FRESH-INTAKE-001. PR #153 integrates the PR #150 provenance
lane onto accepted PR #152. This contract grants no deployment, ingestion,
repair, schema cleanup or protected-note write authority.

## Separate identities and verification

Canonical Source is the immutable Safe Edit text/attachment receipt and path/hash.
A raw appearance is a supplied transcription, excerpt, repost or differently
worded account. Archived bytes are a separately stored snapshot. Verified claim
is a claim-level result from the existing independently server-validated M5.5.1
primary-evidence receipt, including scope, signatures, anchor and revocation.
These four identities are not interchangeable.

Archive SHA/length/readback yields `ARCHIVED_BYTES_INTACT`, never
`ORIGINAL_VERIFIED`. A URL match does not prove transcription equivalence,
publisher authenticity, document signature, event version or claim truth.
No archive, additional snapshot or additional Review increases evidence
independence. `independentEvidenceIncrement` remains zero and whole-Review
verification is not promoted. Protected Thesis, Evidence Register, Timeline,
Portfolio and Trade changes remain outside the canonical add-only authority.

## Current HOLD and immutable historical evidence

`prepare_canonical_writeback` and `apply_canonical_writeback` both expose
`archiveProvenanceStatus` and `archiveProvenanceReason`, plus readiness.

- `ABSENT / no_archive` means no recorded snapshot in the bounded lookup;
  `ABSENT / not_archivable` means the locator is ineligible for this archive.
  A missing optional archive does not by itself prohibit an attributed Review.
- `HOLD` means eligible archive lookup cannot be established, history is bounded
  out, metadata/binding is inconsistent or selected bytes are corrupt/missing.
  A fresh Review becomes `hold_archive_provenance`: no Review preview or write.
  Safe Source capture remains independent. Unresolved provenance never yields
  `readyForNextNews=true`, including Source-only capture.
- If a receipted Review already exists, new/removed archive capture, selected
  revision, header-only metadata change or failed revalidation is
  `hold_archive_drift`, not a generic note-content conflict. There is no automatic
  rewrite, deletion, duplicate Source/Review, receipt alteration or repair.

Drift classification requires current file bytes to match the original canonical
create's durable successful write/readback/reindex receipt, including operation
ID, path, payload and hashes. The non-archive part must still match the proposed
Review. Actual edits, changed analysis, missing/incomplete receipts or unknown
rendering cannot be excused as archive drift; content/integrity HOLD remains.
Only the generated provenance section is excluded from the byte comparison;
unchanged quotations in analysis do not create another provenance section.
Missing index or Review-to-Source backlink still requires index repair. Event
and quality blockers remain visible; a quality gate cannot erase archive HOLD.

An exact duplicate with unchanged archive remains `saved_verified`. Existing v1
archive rendering is recognized only through a validated historical receipt and
an internally computed digest of the unchanged old block. Its raw metadata and
old chronology wording are not returned as current model text; historical bytes
are not rewritten. Current output uses the uncertainty contract below.
A snapshot change after preview invalidates pending canonical authorization.
The apply path revalidates after asynchronous Sync pause, immediately before
each write. A later Review HOLD retains any independently completed safe Source.

Historical success records what passed at that time, not perpetual evidence
usability. Repair/revision requires a separate explicit reviewed workflow. See
[historical receipts and revalidation](m54-canonical-writeback.md#historical-receipts-and-current-revalidation).

## One URL identity contract, then eligibility

Source identity, structured event correlation and archive correlation share
`source-url.ts`. The identity rules trim surrounding whitespace, remove the
literal fragment before applying trailing `) , . ;` normalization, parse supported
HTTP/HTTPS, remove tracking parameters (`utm_*`, `fbclid`, `gclid`), normalize the
host and sort query parameters. Encoded `%23` is URL data, not a fragment delimiter.
If stripping would invalidate an otherwise parseable URL, retain its parsed form
instead of manufacturing an invalid URL. Unsupported schemes/credentials retain
their trimmed input identity as before.

Normalization reaches a fixed point: `canonical(canonical(x)) = canonical(x)`.
Tracking removal, query sorting or URL serialization can expose another terminal
literal punctuation sequence; the same rules run again until stable. This also
closes formerly unstable cases such as `doc)?utm_source=x` and a query's encoded
period serialized as a terminal literal `.`. Already-stable plain canonical
outputs are unchanged. `K` and `K#section` share identity even when K ends in
punctuation, including `report_(Q3)` and query values. No clock, network or DB
state participates in URL normalization.
URLSearchParams normalizes query `%20` and `+` to the same space representation;
query `%2B` stays literal plus. Path `%20` and path `+`, path case and query value
case remain distinct. Unsupported/free-text locators retain their trimmed
Source identity; this does not make them archive-eligible.

Eligibility is checked after canonicalization: standard HTTPS, no credentials
and no non-default port. HTTP, unsupported schemes/ports and free text return
`ABSENT / not_archivable`, without attempting archive reads. An eligible lookup
failure is HOLD, not an assertion that there was no archive.

### Historical N1c identity guard

The pre-N1c single-pass normalizer is retained only for comparison, never for
creating new IDs/keys. A matching historical Source whose URL meaning changed
and whose ID differs from the corrected v3 ID fails closed with
`M56_LEGACY_SOURCE_URL_RECONCILIATION_REQUIRED`. This does not rewrite its bytes,
ID, path or receipt, issue a duplicate Source, or bypass reconciliation via
`existingIntakeId`. New receipts already have the corrected ID and replay through
plain/fragment/canonical aliases as `verified_existing`. Unaffected historical
Source reuse retains the existing M5.6 behavior.

Archive inspection also checks the known pre-N1c keys of the supplied input's
plain/fragment forms: at most two distinct exact indexed lookups, excluding the
current key. A retained old key yields `HOLD / legacy_url_binding`, even when a
current key also exists. It is not relabeled absent, selected or rebound. This
is a guard for known prior-key collisions, not a global migration/discovery of
every malformed historical key. Historical reconciliation remains a separate
reviewed workflow; no schema, source, archive or receipt migration is performed.

### Bounded trailing-punctuation compatibility

Historical archive keys/IDs are not migrated. Exact canonical-key history is
checked first. Only when it is absent, compatibility lookup uses the **full
canonical key K, including its query**. Candidates are K followed by one or more
literal characters from `),.;`. Four disjoint binary ranges start at K plus
`)`, `,`, `.` and `;`, ending before K plus the next ASCII character. The existing
`source_key` index locates these ranges; SQL then requires
`rtrim(source_key, '),.;') = K` **before** DISTINCT/LIMIT. Thus `doc?id=N`,
`doc.vN.pdf`, `doc,N`, child paths and root `/?p=N` consume no alias slots.
No `?`/`#` compatibility ranges or path-only prefix lookup remain.

Normal incoming URLs still use the unchanged shared canonicalizer, including
fragment removal, tracking removal and query sorting, before exact lookup.
This compatibility path addresses the legacy trailing-punctuation difference;
it does not reinterpret arbitrary stored query/fragment variants as legacy keys.

At most 100 distinct candidate keys plus one sentinel are returned in total.
Each query uses the remaining budget, and the ranges do not overlap. Only after
all ranges complete within the bound are candidates compared using the unchanged
shared canonicalizer. This adds at most four indexed compatibility queries and
at most 100 canonical comparisons, with no global distinct-key scan. The returned
candidate count is bounded; SQLite suffix-filter work within each indexed range
is data-dependent, not a claimed constant bound on database rows examined.

- `HOLD / history_limit`: more than 100 snapshots for the exact matched source.
- `HOLD / legacy_alias_scan_limit`: more than 100 distinct trailing-punctuation
  candidate keys for this exact K. No partial candidate set is selected, even if it
  already contains a canonical match. Unrelated archive keys do not consume this
  bound. Exact current keys bypass the compatibility lookup.
- `HOLD / legacy_url_binding`: the complete bounded candidate set contains a
  noncanonical key that normalizes to this source; explicit reconciliation is
  required. No rebinding, historical ID rewrite or migration occurs.
- `ABSENT / no_archive`: no exact history and no matching alias within this
  completed compatibility scope. Unrelated archive growth cannot by itself HOLD
  a fresh unarchived URL or make its historical Review drift.

This is compatibility with the defined legacy punctuation forms, not exhaustive
recovery of arbitrary malformed historical values. Leading whitespace,
nonserialized host/path forms or raw stored query/fragment aliases may not be found;
they require a separately reviewed diagnostic/reconciliation workflow. No
automatic schema cleanup or archive repair is introduced.

## Binding, chronology and public metadata

Internal binding covers normalized intake URL, exact archived/retrieved URLs,
snapshot ID, SHA-256, byte length, archive sequence revision, capture timestamp,
content type, capture method and exact ETag/Last-Modified hints. Metadata must
remain identical between selection and byte readback. A metadata digest and
versioned binding digest detect header-only drift without exporting those values.

Public planner output omits raw response headers, archive URLs/retrievedFrom and
arbitrary content-type strings. It exposes validated hex digests, snapshot ID,
length, sequence number, UTC capture timestamp, hint-presence boolean and fixed
enums. Review rendering uses only these validated values and fixed text, so raw
metadata cannot introduce Obsidian tags, wikilinks, headings, HTML, comments,
highlight, math, tasks, block syntax or frontmatter. Index-level tests compare
actual tags/links/frontmatter/headings before and after malicious metadata.

The selected snapshot is `HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION`: archive
sequence does not establish capture order, publisher revision or event version.
Event/publication dates have no timezone, so current chronology reports
`ORDER_UNKNOWN_TIMEZONE` (or `PUBLICATION_UNKNOWN`), never a definite BEFORE/AFTER
comparison with the UTC capture date. ETag and Last-Modified are untrusted hints,
not timestamp/timezone evidence authorizing a stronger chronology claim.

## Integrity scope and bounds

This witness validates **selected snapshot bytes only**, not archive-wide health.
`integrityScope=SELECTED_SNAPSHOT_ONLY` and `olderSnapshotsByteChecked=false` are
explicit. Older non-selected blob corruption does not invalidate an otherwise
unchanged selected snapshot/Review in this witness. Archive-wide or historical
snapshot verification requires its own explicit read-only check. Metadata parse
failures can still HOLD a history lookup; this is not a claim about older bytes.

Read at most 100 snapshot metadata rows plus one truncation sentinel, then hash
one document capped at 8 MiB. The no-canonical-key compatibility scan is limited
to 100 distinct keys in the exact-key trailing-punctuation scope plus one sentinel,
not the global archive. Actual history truncation and alias-scope truncation have
separate HOLD reasons. Oversized/inconsistent metadata and selected corruption
fail closed. Never silently fall back to an
older intact snapshot. The URL+bytes retry retains the original snapshot/capture
metadata; changed bytes create a distinct archive revision only through the
existing separately authorized capture mechanism.

Regression fixtures use isolated temporary Vaults and real Safe Edit receipts,
readback, FTS and backlinks, including fresh HOLD, historical drift, unchanged
legacy receipts, malicious metadata, URL aliases, timezone boundaries,
selected-vs-older integrity scope, primary-receipt rejection and protected-state
invariance. They do not claim live staging, remote Git or remote-device acceptance.
