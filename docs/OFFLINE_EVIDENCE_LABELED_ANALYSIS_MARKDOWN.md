# PR #102 — Evidence-Labeled Analysis Markdown in the Closed Loop

## Product North Star alignment

**New intelligence → historical retrieval and externally proposed AI reasoning → canonical Obsidian Wikilinks → safe writeback → exact readback/index/backlinks → next retrieval as historical analysis, NOT original issuer evidence.**

PR #101 proved second-event FTS can find a *placeholder* analysis and an original source. PR #102 replaces that placeholder with **actual externally supplied, evidence-indexed reasoning draft content** already described by the PR #97 reasoning contract. This is material progress: human readers and subsequent retrieval can now see hypotheses, bottleneck, contrary explanations and Thesis-change proposals rather than merely a generic banner.

## Markdown composition

`composeOfflineSyntheticInvestmentReviewMarkdown` renders **synthetic** draft data into:

- Canonical fully qualified `[[Source]]`, `[[Company Hub]]`, `[[Company Evolution]]`, `[[Industry]]`, `[[Current Thesis]]`, `[[Evidence Register]]` links, with role and link justification.
- Claim case indices, metric and period, without independently asserting source authenticity.
- The proposed *causal pathway* from Demand/Revenue Conversion toward Cash Flow, with explicit cited case indices and unverified bridge status.
- Candidate bottleneck and risk rationales.
- Alternative hypotheses, counter-evidence scope, and evidence gaps.
- Proposed Thesis impact with direction, confidence and **not quantified** magnitude.
- Honest market price-in status: **not determined**.

Required frontmatter: `type: investment_review`, `source_type: archived_ai`, `analysis_origin: synthetic_ai_draft`, `independent_evidence: false`, `verification: not_reverified`, `status: draft`. Note: the test calls the draft "AI-style" but **no model was called**. Incoming original source retains its own distinct provenance.

Freeform explanatory draft text is *rendered as separately labeled literal blockquoted text*, with Markdown link and HTML delimiters encoded so arbitrary text cannot create an extra Wikilink, YAML frontmatter, HTML comment or headline. The renderer checks parsed outgoing links equal only the exact canonical selected targets. This prevents accidental **structural** link injection but does **not** certify the truth of any AI analysis or eliminate semantic prompt-injection risk in retrieved prose.

## Integration

- PR #99 disposable writeback now writes the rich rendered note, reindexes SQLite/FTS, verifies exact chosen destinations and Company Evolution backlink, and invokes PR #101 second-event retrieval against the newly written analysis.
- PR #100 Safe Edit preview now prepares the **same renderer** content as the tested writeback rather than diverging placeholder text; it remains preview-only, with separate authorization needed for each apply.
- Synthetic tests prove content provenance, causal step/counterevidence/Thesis fields, exact link count, malicious wiki/heading/HTML text treated literally, physical index/readback, next-event retrieved analysis vs unverified source distinction and source snapshot immutability.

## Explicit limits

**No real AI/model call; paid API tests stay PAUSED. No live Vault writes. No scope/permission bypass. No production Safe Edit apply, automated Thesis/Portfolio modifications, or proof of phone Sync.** The functions are still offline synthetic only; PR #97/#98 validators check structural cited case consistency, **not semantic truth**. A production writer must enforce actual authorization, permissions, idempotency, verified original-source provenance and real readback.

## Product acceptance target still outstanding

A real authorized item in Obsidian must be analyzed using actual historical note content, linked to the **existing** Company/Industry/Timeline notes, safely saved without requiring per-note approval under an expressly approved policy, verified and found on the next analysis. PR #102 is a directly related *component proof*, not that final outcome. More accounting validators or giant dataset are not the priority.
