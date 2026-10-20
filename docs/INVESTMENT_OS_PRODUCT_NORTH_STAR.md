# Investment OS — Product North Star (Non-Negotiable)
**Recorded:** 2026-10-20 (Asia/Bangkok)
**Status:** Owner-stated product priority / development decision
**Source:** User's explicit directive in ChatGPT Investment Operating System conversation, 20 Oct 2026.
**Scope:** NoteMesh / Obsidian investment intelligence system. This is NOT an investment claim and NOT a Current Thesis update.

## One-sentence objective

**Build a continuous Investment Knowledge Graph in Obsidian: every new investment intelligence item should be analyzed against relevant history, correctly linked into existing canonical Markdown notes, safely saved with provenance, and independently checked for real readback and link integrity so the knowledge improves the NEXT analysis.**

The most important outcome is **AI Analysis → Automatic Markdown Linking → Safe Vault Writeback**, with historical retrieval upstream and verified persistence downstream. Do NOT drift from this focus.

## Agreed operational flow (in this order)

1. **New Intelligence** — News, Earnings, Research, Macro, industry or other new research material.
2. **AI Analysis + Historical Retrieval** — Retrieve relevant Current Thesis, Evidence Register, Company Evolution, original Source/Evidence, industry/supply-chain history and contrary prior evidence. Distinguish original event date, publication, capture and verification. AI compares the new item with the previous thesis and uses institutional causal analysis (Demand → Revenue Conversion → Gross Profit → Operating Profit → Earnings → Cash Flow → ROIC → Valuation) as supported by evidence.
3. **Obsidian Automatic Markdown Linking** — Identify ONLY substantiated or explicitly marked hypothetical relationships, then resolve canonical *existing note paths* and generate exact `[[Wikilinks]]` to:
   - Source / Evidence
   - Company Evolution Timeline and relevant Company Hub
   - Industry / Supply Chain notes
   - Existing Current Thesis / Evidence Register (**references only**, not automatic edits)
4. **Safe Writeback + Link Verification** — Preserve the original source and analysis with dates and verification states, place a new (or properly classified amended) analysis into the canonical namespace, link the **existing Company Evolution timeline**, and verify physical persistence, Wikilink resolution, reciprocal backlinks, index/readback, idempotency and truthful operation status. No orphan notes or duplicate evidence/event records.

### Strict AI versus deterministic code responsibilities

| AI + Master Prompt (semantic judgment) | Code / NoteMesh (deterministic guarantees) |
| --- | --- |
| Judge which historical notes matter and WHY | Find actual canonical paths, exact issuer/event/scope |
| Analyze fundamental causal mechanisms, bottleneck and thesis relevance | Generate and resolve full-path Wikilinks |
| Identify supply-chain/company/industry relationships and second-order effects | Check targets exist, distinguish alias collisions, detect broken links |
| Separate verified fact, management/user statement, hypothesis, alternatives, counter-evidence | Preserve source identity, dates, citation/provenance and prevent duplicates/overwrites |
| Propose New/Confirmation/Incremental/Contradiction/Thesis-Changing | Safely write only allowed material; read back, reindex and verify status |

Never mistake source reference existence or valid link structure for *semantic truth*. AI must provide why the relationship is relevant; do **not** link every ticker or industry mentioned. Archive AI claims and unverified hypotheses never become independent verified facts by repetition.

## Three non-negotiable writeback outcomes

1. Persist Source and Analysis with original event/publication/received/verification dates where available, explicit **Fact vs Hypothesis** and source classification.
2. Connect new analysis to the existing **Company Evolution** timeline and relevant Industry / Thesis notes; avoid parallel duplicate timelines. All claimed relationships must be sourced or marked as hypotheses.
3. Independently verify Wikilinks, canonical targets, no duplicate notes, no orphan analysis, persisted bytes and readback, reciprocal backlinks, and SQLite/FTS where applicable. A queued/previewed write is NOT a saved note; a server readback is NOT proof of desktop or mobile sync.

**Owner intent:** Auto-analyze AND auto-save permitted **Analysis and Company Evolution updates** when authorized safe-write permissions/policy allow it. Do NOT require routine manual approval of every permitted analysis note once a legitimate auto-write policy is established. However, do NOT bypass current host/user authorization to simulate automation. Protected Current Thesis, protected Evidence Register and Portfolio changes always follow their distinct approval policy.

## Development priority / anti-scope-drift rule

**P0: Make the *whole* closed loop work with genuine permission and evidence: retrieval → AI reasoning with good prompt/context → canonical autolinks → safe persistence → actual verification → reusable next-retrieval.**

P1: Handle concurrency, rollback/partial writes, idempotency, conflicting content, authorizations and connector integration as necessary to deliver P0 safely.

**Defer** additional exhaustive accounting rules, a large synthetic reasoning-evaluation dataset, schema-only validators, or more disconnected Draft PRs *unless a clearly demonstrated defect blocks this operational goal*. Avoid confusing “CI passes synthetic validators” with “Investment OS can analyze and save an actual note”.

## Practical acceptance test

Given ONE new, appropriately permissioned, sourced investment-intelligence item (e.g. a documented NVIDIA Networking news item):

- AI retrieves the right historical issuer, Industry and Thesis context and explains its relevance, uncertainties, counter-evidence and Thesis implication without claiming price-in absent pricing.
- System finds exact existing canonical Obsidian note paths and chooses only relevant links.
- System stores a correctly dated, provenance-tagged Analysis Note and appends a reference to the *existing* Company Evolution timeline.
- New note links resolve to Source, Company, Industry and relevant Thesis references; timeline backlink resolves to the exact new note.
- A repeat of the same item does not generate another source fact, duplicate event or new parallel note; added detail/correction is separately classified.
- Readback verifies actual persisted bytes and index/link/backlink state. Partial failure produces a durable, repairable exception receipt. No false “Synced to phone” claim.
- Current Thesis/Evidence Register protected content and Portfolio are not changed absent their own approval.
- On the **next** new intelligence item, the previous safely stored analysis is retrieved and recognized as historical analysis, not independent issuer evidence.

## Status as of 20 Oct 2026

- PRs #98–100 are unmerged, offline/synthetic Draft engineering foundations, NOT completed live auto-save.
- Safe Edit currently provides preview/create/append, separate host-authorized apply and status receipt. Production auto-write permission/connector must be designed explicitly; no bypass.
- Paid OpenAI API/model testing remains **PAUSED** pending the owner's explicit restart.
- This document records product intent, **not** confirmation that live Closed-loop or cross-device synchronization exists.

**Change-control rule:** For every proposed next PR/task, answer: “Does this bring us materially closer to the full Analysis → Markdown Links → Safe Vault Writeback → Readback → Next Retrieval loop?” If not, defer unless required to remove a concrete safety/correctness blocker.
