# PR #99 — Ephemeral Synthetic Safe Writeback Rehearsal

## Investment OS target

Material investment input → bounded Vault historical context + source/claim comparison → AI reasoning candidate with alternatives and uncertainty → canonical Markdown links → **authorized non-protected writeback** → exact persisted readback, SQLite/FTS reindex, link and backlink resolution → transparent receipt. Protected Current Thesis, protected Evidence Register and Portfolio remain approval-gated.

PR #98 checked canonical destinations but never performed a write. PR #99 tests the *physical mechanics* of a two-note update in a **disposable synthetic snapshot COPY**, not real Obsidian or Railway.

## Implemented

`rehearseOfflineSyntheticInvestmentWriteback`:
- Strict `SYNTH` issuer and OS-temp snapshot boundary; refuses Railway environment and unknown failure options.
- Calls PR #98 and thereby reruns PR #97/#95 evidence, historical comparison, exact-line Thesis citation and Markdown/SQLite/FTS checks. Existing Company/Source/Industry/Thesis paths must match SHA and issuer/event.
- Allocates a new private temporary directory and copies the supplied synthetic read-only Markdown Vault + SQLite snapshot into it. **Original snapshot is never written.**
- Stages a new **synthetic, unverified** Analysis Note with canonical full-path `[[wikilinks]]`, stable operation/event markers and explicit epistemic boundary. Deliberately does NOT persist untrusted/free-form AI hypotheses in the preview.
- Appends one event link to the **existing Company Evolution note** in the sandbox; previous content retained byte-for-byte.
- Reindexes the two changed Markdown notes against a **copied SQLite / FTS** index inside one SQLite transaction, using the existing markdown extractor. Checks outgoing links resolve to the exact selected note paths, and the Timeline link resolves back to the new Analysis Note.
- Independently verifies temporary copy Markdown/SQLite/FTS consistency via PR #83 snapshot coverage; checks exact physical write/readback, one operation/event marker, and the immutable source snapshot checksum.
- Deletes the entire temporary worktree even when a simulated write or index failure occurs. Failpoints: after new Analysis Note, after Timeline append, after SQLite reindex.
- Only returns a **redacted synthetic rehearsal receipt** (counts/flags and hash identifiers). No selected note prose, raw note paths, ticker, URLs, source facts, or arbitrary model content.

## Why this is not production auto-writeback

A sandbox that is deleted in `finally` has no persistent completion state. No account access/owner consent was established and no live MCP writer, Git sync, Railway, source archive or Current Thesis mutation was invoked. This PR demonstrates two-note copy-based readback and failure cleanup, **not** an atomic two-file transaction on a real shared Vault.

A real safe writer still requires:
1. User-authorized identity and scope binding, protected-note policies and a strict allowlist for non-protected source/analysis/Company Evolution changes.
2. Conflict-safe expected-SHA compare-and-swap for every edited note, durable idempotency ledger/operation receipt, a restart-safe repair/rollback/reconciliation mechanism, and writer-fence admission.
3. Verified original source/analyst provenance where required, non-duplicated event classification, and clear separation of AI hypothesis from issuer verified fact.
4. Independent post-write source readback, reindex, resolved link/backlink checks, and actual Save Receipt with precise status. A server file write is not proof of cross-device Obsidian sync.
5. Intentional release approval, and separate real-model evaluation once paused API testing is explicitly resumed.

The indexer's generic shortened-basename fallback is not trusted; the rehearsal asserts **full path-qualified** link targets. Links to Thesis or Evidence Register are references, **not edits**.

## Tested

Synthetic 3-claim issuer event, six existing canonical source/company/timeline/industry/protected-reference anchors, two-note written/readback and SQLite resolution, physical snapshot unchanged, prompt-injection/protected-note redaction, all three injected failures and worktree cleanup, wrong issuer rejection, stale anchor SHA and mutated snapshot holds.

**DRAFT ONLY. NO MERGE. NO DEPLOY. NO API CALLS. NO REAL VAULT WRITE.**
