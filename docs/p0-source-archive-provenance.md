# P0 Source archive provenance integration

Task: IOS-ORCH-P0-FRESH-INTAKE-001. This integrates the PR #150 provenance lane
onto the accepted PR #152 baseline. It grants no deployment, ingestion, repair,
schema cleanup or protected-note write authority.

## Four separate identities

- **Canonical Source** is the immutable Safe Edit text/attachment receipt and
  its path/hash. It remains `user_supplied` / `not_reverified`.
- **Raw appearance** is a supplied transcription, excerpt, repost or differently
  worded account of an event. Another appearance is not automatically a new
  independent origin or a new canonical event.
- **Archived bytes** are a server-recorded snapshot outside the Vault. Successful
  SHA-256/length/readback yields `ARCHIVED_BYTES_INTACT`, never `ORIGINAL_VERIFIED`.
  A URL match does not prove the supplied transcription was derived from those
  bytes, publisher authenticity, document signature or claim truth.
- **Verified claim** still requires the existing independently server-validated
  M5.5.1 primary-evidence receipt for its exact entity/metric/period/unit/value,
  signatures, archived-byte anchor and revocation state. Archive availability
  alone cannot set `verified_primary`, verify a whole Review or change Thesis.

## Snapshot binding and chronology

The read-only planner queries existing archive metadata by the archive's shared
URL normalization, then validates one snapshot's exact bytes. The output binds
the intake URL, archived URL, retrieved-from URL, snapshot ID, SHA-256, byte
length, archive sequence revision, capture timestamp, content type, ETag and
Last-Modified hints to the caller-declared event/publication dates. It verifies
the snapshot ID's URL/digest derivation and stable metadata across readback.
The Source path/text hash remains a separate binding in the canonical recipe.

Selection is `HIGHEST_ARCHIVE_REVISION_NOT_EVENT_VERSION`: the greatest archive
sequence within a complete bounded metadata history, not necessarily the latest
capture time and never an assertion of the original event version. ETag and
Last-Modified are unverified publisher revision hints, not authenticated revision
identifiers. A later capture may contain a publisher amendment; capture after
publication does not establish what the document said when the event occurred.
Same-day date comparisons cannot establish ordering. Unknown hints remain null;
`originalEventVersionVerified` is always false in this provenance path.

The existing archive's URL+bytes retry returns its original snapshot and capture
metadata, rather than relabelling old bytes with a new capture time. Changed bytes
at the same URL create a distinct existing-archive revision; neither a new
snapshot nor multiple Reviews add evidence independence. The provenance field
`independentEvidenceIncrement` is always zero; RI-011 candidate counts remain
retrieval counts, not counts of independent evidence.

## Historical preservation and failure handling

No archive yields `ABSENT`; no placeholder is inserted into a Review, preserving
the pre-integration recipe when archive provenance is absent. A missing/corrupt
selected snapshot, inconsistent binding, unknown archive failure or truncated
history yields provenance `HOLD`. There is no silent fallback to an older intact
snapshot and no automatic fetch, repair, reindex, deletion or overwrite.

An intact snapshot can be rendered as attributed provenance in a new Review
through the existing preview/CAS/apply authority. New or unavailable provenance
can change a future proposed Review's hash: if the Review already exists, the
existing canonical conflict gate HOLDs rather than rewriting it. Prior Source
bytes, Review bytes and durable write receipts remain intact. A snapshot change
between preview and apply invalidates the old authorization before canonical
writes. Resolving a current HOLD requires a separate reviewed workflow; historical
write success is not permission to bypass current checks. See the
[historical receipt contract](m54-canonical-writeback.md#historical-receipts-and-current-revalidation).

The adapter reads at most 100 metadata rows (plus one truncation sentinel) and
hashes one document, capped at 8 MiB. It validates metadata bounds and escapes
untrusted hints in rendered Markdown. No schema/table or archive-capture behavior
changes are introduced. Auth/OAuth, price processing, Safe Edit locks, claim
validation, Source identity and RI-011 classification retain their baseline code.

## Regression evidence

`source-archive-provenance-p0.test.ts` covers persisted Source → intact archive →
first typed Review → idempotent repeat; absent/corrupt/missing archive; same bytes
retry; changed bytes and later publisher revision; out-of-order capture;
forged-primary-receipt HOLD; multiple Reviews/one origin; same-event HOLD;
Markdown injection; history/byte limits; stale preview rejection; URL/digest and
metadata reread binding. Every fixture checks unchanged Current Thesis, Evidence
Register, Timeline, Portfolio and Trade bytes. Real local Safe Edit receipts,
Source/Review bytes, FTS and resolved Review-to-Source links are checked; these
synthetic fixtures do not claim a live ingestion or remote-device acceptance.
