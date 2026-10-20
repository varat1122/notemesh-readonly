# PR #103 — Authenticated Knowledge Graph Writeback Readback

## Why this matters to the Investment OS Product North Star

The goal is **AI Analysis → Canonical Markdown Linking → Safe Vault Writeback → Physical Readback / Link Verification → Reusable Next Retrieval**.

PRs #99–102 established a successful *synthetic offline* first-write / next-retrieval loop. PR #100's preview and status fixture used an invented simplified state shape. The existing **real NoteMesh Safe Edit engine** actually exposes `status: "preview" | "writing" | "written"` with a nested durable `receipt.write`, `receipt.readback` and `receipt.reindex` field. The new verifier checks the **real shape, inside the existing OAuth-bound Safe Edit connector**. A synthetic receipt may not stand in for a real save.

## What PR #103 implements

New **read-only** MCP tool under the existing `Investment OS — Safe Edit` connector:

`verify_investment_graph_writeback(analysisOperationId, timelineOperationId, analysisPath, timelinePath, sourcePath)`

1. Uses existing `canSafeEdit(access)` guard requiring `vault:read vault:edit`. The OAuth actor is `access.label` provided by the authenticated server, **never** a user-provided actor parameter.
2. Reads both operation records with the original `status(operationId, actor)`, so a different OAuth client's receipts are rejected. Both must report **written**, each must have **write = written, readback = verified, reindex = verified**, with consistent path and before/after hash.
3. Independently reads **the CURRENT actual Markdown bytes** from the server Vault using existing symlink-safe `readVaultFile(resolveNotePath(...))`. Compares each SHA-256 to its own durable after-hash and checks frontmatter / body against SQLite + FTS.
4. Ensures the Analysis Note is in the designated `Investment Review - ...` path, its Company Evolution target is exactly the existing `Company Evolution - {issuer}.md`, and the Analysis is explicitly `source_type: archived_ai`, `independent_evidence: false`, `verification: unverified | not_reverified`. Original Source must retain a distinct `source_type: primary | attributed | user_supplied` and cannot be Archived AI.
5. Checks a unique operation/event marker in the Analysis and Timeline, every outgoing exact full-path Wikilink from Analysis has a real indexed and readable destination and matching exact indexed resolution, plus exactly one Company Evolution backlink to that Analysis path. Basename-fallback false positives are refused.
6. Returns only a small receipt summary: **two** notes verified, number of links, check flags. No Markdown content, raw note paths, OAuth tokens, model prose or protected Thesis text.

This is a **verification** operation. It never PREVIEWs or APPLYs, does not change the Current Thesis or Portfolio, and does not prove original publisher authenticity or desktop/mobile Sync.

## Tests

The unit tests use mock read-only storage shaped like the real `status()` receipts and exact SQLite/FTS link/index rows. They cover:
- Positive two-note source / AI analysis / Timeline graph with full-path targets.
- Incomplete/preview receipts; changed physical bytes; provenance promotion; wrong-resolved Wikilinks; missing reverse links; duplicated operation marker; path traversal; protected target and FTS mismatch.

The pure contract says `graph_integrity_proven_against_supplied_readback_source`. **Only** the authenticated production-bound wrapper can report `authorized_safe_edit_server_graph_readback_verified`. Mocks do NOT verify that real user authorization or server persistence occurred.

## Remaining product gap — no false completion

The existing `apply_edit` still requires a host/user authorization on each proposed concrete diff, and the engine applies **one note at a time**. Therefore PR #103 is **NOT** automatic two-note writeback. Before enabling non-protected auto-save, the owner must explicitly authorize an exact, scoped policy enforced server-side without bypassing host requirements; these semantics may require a distinct authorized API surface. Partial writes still require durable repair. No production model call or paid API test is made.

A production acceptance run must perform actually authorized two-note Safe Edit writes on non-protected Notes, call this new read-only verifier, independently check actual source semantics and retrieval of the newly indexed analysis on the next event, and separately check any requested device Sync. **Do not merge or deploy until dependency Security Audit and release reviews pass.**

## Deployment boundaries

**DRAFT ONLY: no merge, no deployment, no actual Vault write, no call to model/API, no Current Thesis or Portfolio mutation.**
