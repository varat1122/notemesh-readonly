# PR #98 — Canonical Markdown Auto-Link / Safe Writeback Staging

## Why this milestone

The operating goal is **new investment intelligence → historical Vault retrieval → AI investment reasoning → exact canonical Obsidian note linking → authorized safe writeback → real readback and index/link verification**. PR #97 established only an offline, evidence-bound reasoning contract. This PR validates canonical destinations and records proposed write operations **before** an authorized writer can touch the Vault. It is not yet the fully automated workflow.

## Executable contract

`planOfflineCanonicalInvestmentAutolinks` takes the physically checked **synthetic** 2–6 claim packet plus untrusted candidate rationale/routing. It independently reruns PR #97/95 and checks the offline Markdown + SQLite + FTS snapshot, instead of trusting `alreadyVerified` flags.

Required existing canonical note anchors:
- exactly one source/event note, matching issuer and `event_key` frontmatter;
- one `01_Companies/{issuer}.md` Company Hub;
- one `08_Daily_Weekly/Research Indexes/Company Evolution - {issuer}.md` Company Evolution Timeline.

Optional anchors:
- up to 3 existing `02_Industries_Themes/` notes (hypothesis or exposure, never presumed proven supply-chain relationships);
- one existing `05_Thesis/{issuer} - Current Thesis.md` **reference only**;
- one existing `05_Thesis/{issuer} - Evidence Register.md` **reference only**.

Every selected note must have an indexed **exact path**, safely readable physical regular file, matching SHA-256 of current Markdown bytes, and a role-appropriate canonical location. Issuer-anchored notes must match the declared issuer identity; the source must match the **same event**. All candidate paths reject traversal, escape syntax and disallowed characters.

Creates an in-memory preview of **full-path Wikilinks**, round-trips it through the existing Obsidian Markdown structure extractor, and checks operation/event markers in the living Company Evolution note. An already-present operation or event is held for correction/added-detail review, not silently duplicated. A proposed Analysis Note path already in the snapshot or on disk is rejected even if not indexed.

The output is an **unprivileged, redacted staging receipt**: checksum-identified role anchors, preview operation *types*, reason/uncertainty flags, and zero write/readback/sync claims. Never returns raw note paths, source URLs, financial values, protected Current Thesis text, or external model hypotheses.

## Proposed eventual authorized writeback contract

1. Preserve incoming original facts and actual source/fiscal dates. A source note that is already present is **not** a new independent source or a new event.
2. Emit dated Analysis Note under a canonical namespace with stable operation/event marker; include source/Company/Industry/Thesis references only when relevant, with fact-versus-hypothesis status.
3. Append exactly one linked item to the **existing Company Evolution** note, not a competing "latest" note. Keep prior events and versions.
4. Separate any Industry timeline append from mere Outgoing Wikilinks: cross-company or industry causal edges require evidence or explicitly marked hypotheses.
5. Never auto-edit protected Current Thesis/Evidence Register or Portfolio.
6. The writer must hold verified account consent/permissions, revalidate expected file SHA immediately before writing, provide atomicity or a safe conflict response for grouped edits, reindex affected files, verify exact resolved link destinations and reciprocal backlinks, read back the final bytes, and issue truthful `written_and_readback_verified` or `pending_writeback` receipt. Do not equate import/queued with completed, or server readback with desktop/mobile Sync.
7. Failed / duplicate / conflicting source-identity or ambiguous destination must **block writes and raise a review queue**, never fabricate a success.

**PR #98 does not implement step 6's live writer.** This will need a separate controlled milestone, with legitimate authenticated access and dedicated failure/retry tests, before any auto-save claim.

## Synthetic regression tests

- 3-claim PR #97/95 physically reconciled synthetic packet.
- Existing exact path Company Hub, Timeline, Industry, source, draft Thesis and Evidence Register anchors.
- All roles hashed and full-path Markdown links parsed; no protected prose or input prompt-injection leaks.
- Wrong issuer, wrong folder/role, missing canonical anchors, forged SHA, duplicate/occupied analysis path, replay marker, unsafe path traversal and cross-event citation failures.
- Write, device-sync and current Thesis privileges explicitly remain false.

## Non-goals and caveats

The production NoteMesh indexer's shortest-basename fallback can choose the wrong existing file when a basename is ambiguous. This feature **never relies on basename fallback** and uses exact path-qualified links; it does not globally change production Obsidian link resolution.

Physical Markdown/SQLite/FTS agreement establishes only a consistent copy of indexed content, not primary issuer publisher authentication, genuine owner read consent, business causality, correct Industry exposure, all historical semantic dedup, or absence of undiscovered notes.

**API testing PAUSED. NO model calls. NO Vault production access, write or notification. NO merge. NO deployment.**
