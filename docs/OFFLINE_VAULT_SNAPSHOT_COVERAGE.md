# Offline Vault Snapshot Coverage Acceptance — Development PR #74

This checklist deliberately applies **only to an independently prepared, segregated Vault + SQLite snapshot**. It does NOT create a snapshot, freeze live writers, certify Recovery/DR, grant owner approval, prove Obsidian Sync, or verify investment claims.

## Operator prerequisites (not performed by this PR)

1. Use an approved point-in-time **consistent** pair of Vault files and SQLite, copied outside live `DATA_DIR` to a machine/process with **no Railway Production environment variables**. Live WAL-file copy without a checkpoint or SQLite backup API is not a valid consistent SQLite capture. Never point this tool at Production.
2. Preserve relative paths and modification timestamps under `snapshot-root/vault/`; place a consistent SQLite backup at `snapshot-root/app.sqlite`. Ensure this is not a symlink. Confirm the snapshot is quiescent or stored on a separately enforced read-only mount. The verifier does **not** confirm mount immutability or copying correctness.
3. Confirm independent original-source archives/exports and any off-server backups separately. Those bytes may be outside the Obsidian Markdown Index and are not part of this check.

## CLI — explicit segregated path

```sh
pnpm snapshot:coverage:offline /absolute/path/to/segregated-snapshot
```

Run from a local development checkout on Node >=24 with repository dependencies installed. The CLI uses Node type-stripping and a local module resolver without adding package dependencies. No network calls by the verifier, Vault write, production deployment, or MCP registration. Prints bounded issue samples and hash of observed Markdown file bytes, without note content. Exits 0 for internal Markdown/FTS/links and attachment-index metadata reconciliation; exits 1/2 on issues/errors. A zero exit is **not** external evidence, file original authenticity, or immutable-snapshot/DR acceptance.

## Gates

- **FAIL CLOSED:** indexed Markdown rows missing from physical snapshot; physical Markdown not in SQLite; unsafe paths or symlinks; oversized/invalid notes; size/mtime/frontmatter mismatch; FTS body mismatch (including same-size same-mtime replacement); indexed link-target mismatch; missing/orphan FTS/link rows; mismatched physical attachment metadata or attachment count; SQLite quick-check failure, size/count/depth limits.
- **SCOPED PASS:** `snapshot_markdown_index_reconciled_not_originals_verified` establishes only internal consistency for this offline copy. Attachment contents are *not hashed*; imported original-source archive JSON/ZIP outside the index remains *unverified*. A source reference missing from the Markdown index is not automatically a missing original source. Source/claim independence, issuer verification, chronology, latest live index, human approval, protected Thesis, mobile Sync and disaster recovery remain **not established**.
- **NO-GO REMAINS:** before any Production work, independently validate snapshot capture time and atomicity, Vault-to-DB coordination and immutable storage, source-original bytes and publisher identity, off-server backup and successful independent restore, and human review/approval of any one-note edit.

## CI fixture coverage

The automated tests build a disposable scratch Vault and SQLite via the real indexer, create a consistent **isolated copy via SQLite backup API**, and exercise pass, same-size/same-mtime body tamper, physical vs indexed mismatches, link tamper, attachments, symlink denial, unsafe live path and Railway invocation denial. These tests do not assert that the user's 3,375-Note Production Vault was physically snapshotted or verified.

## Relation to Review Queue

PR #73's `indexFingerprint` is limited to an indexed metadata/links view within a live request. PR #74 separately checks a segregated **offline copy's** physical Markdown bytes against indexed FTS and links. Neither can be used as an authenticated source claim or a license to modify Current Thesis / Evidence Registers / Portfolio.


## Source archive evidence and provenance crosswalk (Draft PR #75)

The source check operates only on the **same independently isolated, consistent copy** after the Markdown+SQLite coverage checker reports clean:

```sh
pnpm snapshot:sources:offline /absolute/path/to/segregated-snapshot
```

The source archive must be copied into `snapshot-root/source-archive/blobs/<first-two-sha256-hex>/<sha256>.bin` (the normal application format). Its receipt rows are in the **same** `snapshot-root/app.sqlite` table `source_snapshots`. The CLI never fetches a source, backs up a live volume, authenticates an issuer, or writes to the Vault. It opens SQLite read-only and reads file descriptors using `O_NOFOLLOW` with size/hash checks. Unsafe symlinks, missing files, byte tampering, malformed registry fields and orphan blobs trigger an integrity hold.

**Result separation:** `offline_archived_bytes_intact_not_publisher_verified` is an internally consistent stored-blob result only; `offline_archive_bytes_intact_provenance_review_pending` indicates that a note-declared original-source locator/full-document hash remains unregistered or does not match the stored version; `offline_no_original_source_snapshots_unverified` is **not** success; and `offline_archive_bytes_integrity_hold` indicates a storage integrity failure. The CLI exits nonzero for every state other than internally consistent stored bytes with no explicit note-reference gap.

The crosswalk checks only explicit `original_source` / `source_url` and `original_source_sha256` metadata in the indexed notes. Source `source_records` pointers into Markdown or JSON/ZIP archives are not the same as the registered external source blob; they require a separate physical source export/lineage audit. `source_excerpt_sha256` never substitutes for the full original hash. Archived ChatGPT notes, operator-supplied capture labels, exact file bytes and repeated URL families do **not** constitute independent issuer verification. Historical user-supplied notes are never automatically corrected; the result is an unsaved review queue only.

**Still NO-GO:** the original publisher's authenticity, claim-to-file/period/unit citations, unregistered originals, captured-event chronology, immutable snapshot proof, off-server restoration and device Sync must be independently evidenced before Production acceptance. No Thesis/Evidence Register/Portfolio writeback is authorized.


## Evidence-Gated Offline Human Review Worksheet (Draft PR #76)

Before reviewing a specific historical/research note, independently prepare an isolated, coordinated Vault + app.sqlite + source-archive snapshot. The code **does not create, freeze, sign or prove** such a snapshot. Avoid Production and run from a standalone development checkout.

```sh
# First pass: discover exact note's SHA-256, but do not move forward
pnpm snapshot:review:offline /absolute/segregated-snapshot \
  "10_Knowledge/Company Research/SYNTH - Review.md" inspect_original_claim

# Reconfirm the selected exact SHA-256 on a subsequent call
pnpm snapshot:review:offline /absolute/segregated-snapshot \
  "10_Knowledge/Company Research/SYNTH - Review.md" inspect_original_claim \
  "<64-char-note-sha256-from-first-call>"
```

The four available **caller-selected, unverified** worksheet actions are `inspect_original_claim`, `metadata_correction_candidate`, `navigation_link_candidate` and `duplicate_or_contradiction_review`. The CLI has a nonzero exit on all HOLD / missing-hash states. It never executes a Safe Edit operation, returns an edit patch, creates a note, records a human approval, updates Thesis or calls outside websites.

**Gate hierarchy:**

1. Verify physical Markdown/SQLite/FTS and separately archived blob integrity from PR #74–75 against this same isolated copy. Source-integrity corruption produces a HOLD, not an upgrade. All results reflect a non-immutable snapshot unless proven separately.
2. Match the selected note against its exact indexed path, current bytes/mtime/frontmatter/FTS, record the note SHA-256, and reject a mismatched caller expected SHA on subsequent review.
3. Crosswalk the selected note's explicit `original_source` / `source_url` and **full** `original_source_sha256` to a unique registered original blob version. Neither an excerpt hash nor an absent full hash can satisfy this match. The note must not be in protected `05_Thesis`, `06_Portfolio`, `07_Sources`, `09_Templates` paths or protected role.
4. Legacy ChatGPT/archived AI remains **nonindependent**, even when a source URL/hash matches. A source stored-byte match is never publisher authentication, claim-precision review, a real-human identity, or authorization. Every result explicitly returns the unresolved independent-review checklist and `canAutoWrite:false`, `ownerApprovalGranted:false`, `claimVerified:false`, `safeEditTemplate:null`, `proposedPatch:null`.
5. **Only after** external publisher/claim/period/unit and counter-evidence review, authenticated reviewer and explicit owner approval should a separate one-note Safe Edit preview be considered, with live hash reconciliation and readback. This PR does not implement those actions.

Do not treat the status `stored_bytes_located_for_manual_verification_only` as `verified_against_primary`; it only means a registered blob hash and selected note hash both matched the *supplied offline copy*. Other note-source inconsistencies and cross-device Sync/independent DR acceptance may still be unresolved. No live Production data has been inspected by this feature.
