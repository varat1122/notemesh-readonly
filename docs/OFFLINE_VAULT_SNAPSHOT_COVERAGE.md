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

Run from a development checkout with its existing dev dependencies installed (the CLI uses the already installed Vite Node TypeScript resolver). No network calls by the verifier, Vault write, production deployment, or MCP registration. Prints bounded issue samples and hash of observed Markdown file bytes, without note content. Exits 0 for internal Markdown/FTS/links and attachment-index metadata reconciliation; exits 1/2 on issues/errors. A zero exit is **not** external evidence, file original authenticity, or immutable-snapshot/DR acceptance.

## Gates

- **FAIL CLOSED:** indexed Markdown rows missing from physical snapshot; physical Markdown not in SQLite; unsafe paths or symlinks; oversized/invalid notes; size/mtime/frontmatter mismatch; FTS body mismatch (including same-size same-mtime replacement); indexed link-target mismatch; missing/orphan FTS/link rows; mismatched physical attachment metadata or attachment count; SQLite quick-check failure, size/count/depth limits.
- **SCOPED PASS:** `snapshot_markdown_index_reconciled_not_originals_verified` establishes only internal consistency for this offline copy. Attachment contents are *not hashed*; imported original-source archive JSON/ZIP outside the index remains *unverified*. A source reference missing from the Markdown index is not automatically a missing original source. Source/claim independence, issuer verification, chronology, latest live index, human approval, protected Thesis, mobile Sync and disaster recovery remain **not established**.
- **NO-GO REMAINS:** before any Production work, independently validate snapshot capture time and atomicity, Vault-to-DB coordination and immutable storage, source-original bytes and publisher identity, off-server backup and successful independent restore, and human review/approval of any one-note edit.

## CI fixture coverage

The automated tests build a disposable scratch Vault and SQLite via the real indexer, create a consistent **isolated copy via SQLite backup API**, and exercise pass, same-size/same-mtime body tamper, physical vs indexed mismatches, link tamper, attachments, symlink denial, unsafe live path and Railway invocation denial. These tests do not assert that the user's 3,375-Note Production Vault was physically snapshotted or verified.

## Relation to Review Queue

PR #73's `indexFingerprint` is limited to an indexed metadata/links view within a live request. PR #74 separately checks a segregated **offline copy's** physical Markdown bytes against indexed FTS and links. Neither can be used as an authenticated source claim or a license to modify Current Thesis / Evidence Registers / Portfolio.
