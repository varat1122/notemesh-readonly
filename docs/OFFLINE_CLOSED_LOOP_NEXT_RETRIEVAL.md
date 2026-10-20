# PR #101 — Closed-Loop Proof: Saved Analysis → Next Investment Retrieval

**Owner North Star:** [Investment OS Product North Star](./INVESTMENT_OS_PRODUCT_NORTH_STAR.md)

## The user-facing behavior this advances

The most important missing link after canonical auto-linking + writeback rehearsal is **that the next investment-intelligence event retrieves prior stored analysis and knows it is previous AI interpretation, not primary independent evidence**. A saved note that search never finds, or an archived AI opinion that becomes a "verified issuer fact" by repetition, breaks the intended Obsidian Investment Knowledge Graph.

PR #101 **connects** PR #99's actual (temporary synthetic) two-note write, SQLite/FTS index, exact-link and readback validation to a follow-on **real FTS SELECT against the updated temporary SQLite copy**. It isn't another disconnected, caller-asserted validation JSON.

## Concrete end-to-end synthetic flow

1. A fictional `SYNTH` earnings source already exists in the isolated snapshot: `type: research_note`, `source_type: primary`, `verification: not_reverified`. A declared "primary" source type does not authenticate a publisher or its claims.
2. PRs #97–98 check user-supplied evidence, physically indexed claims, canonical company/timeline/industry/thesis note paths and bounded link relevance proposal.
3. PR #99 creates an **unverified synthetic analysis** note in a private temporary Vault copy, adds a Company Evolution reference, reindexes and resolves full-path Wikilinks/backlinks, then independently reconciles Markdown/SQLite/FTS.
4. **New in PR #101:** Analysis Markdown frontmatter explicitly records `type: investment_review`, `source_type: archived_ai`, `analysis_origin: synthetic_ai_draft`, `verification: not_reverified`. Note body remains hardcoded and clearly fictional; **NO LLM was called**.
5. In the same disposable worktree, a **second synthetic query** for the same company and revenue topic runs directly against `notes_fts`, retrieving *both* historical analysis and original source. It verifies current physical bytes/expected checksum, frontmatter identities, FTS provenance and canonical links. The returned outcome **distinguishes both roles**; no source text, note path, private Thesis, candidate investment conclusion or AI free-form prose is surfaced.
6. The original snapshot stays unchanged and the entire temporary worktree is removed whether the rehearsal succeeds or fails.

The prepared Safe Edit `create_note` preview in PR #100 is also aligned: the Analysis **note body** is identified as archived synthetic AI draft while the **underlying original input evidence** remains `sourceType: user_supplied`, `verification: unverified`. Do not conflate those two provenance axes.

## What this proves (and does not)

**Proves in a synthetic copy**: after creating/indexing/linking a new historical analysis note, the next issuer/topic FTS query finds that note together with the original source, their preserved different provenance and resolved exact paths. Also proves unit tests protect the redacted result, unchanged original snapshot and no model/Thesis mutation.

**Does NOT prove**: actual new AI reasoning; semantic relevance judgment; original issuer primary-source authentication; owner-authorized real Vault write; deployment; complete historic recall; truthful write receipt from actual Safe Edit; cross-device Obsidian Sync. The FTS result is not proof the AI read or understood either document; the final production workflow must retrieve approved excerpts with explicit source metadata and citations.

## Next action that ACTUALLY matters

Stop adding standalone validators. With this technical loop demonstrated in an isolated copy, the remaining blockers are:

- A **real authenticated Safe Edit adapter** and appropriate *owner-approved scoped auto-save policy*, including permission to create nonprotected Analysis and append a canonical Company Evolution item. Existing `apply_edit` requires host/user authorization for each reviewed preview; this restriction must NOT be bypassed.
- Genuine connector readback/FTS/Backlink verification after authorized two-note writes, durable exception/partial repair receipts.
- AI reasoning with a strong Master Prompt, actual authorized historical context and original sources, with model API testing only after the owner explicitly restarts it.
- Demonstrate one complete user-authorized real note event and next-retrieval integration before claiming production readiness.

**DRAFT / SYNTHETIC / OFFLINE ONLY. NO MERGE, DEPLOY, REAL VAULT WRITE, CURRENT THESIS EDIT OR MODEL API CALL.**
