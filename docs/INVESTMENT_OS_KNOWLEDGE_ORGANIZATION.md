# Investment OS — Knowledge Organization & Read/Write/Edit Acceptance

**Workstream:** Canonical Knowledge / Historical Linkage / Source-first Writeback  
**Stack:** Draft PR #37 (organization planner) depends on Safe Edit PR #33. Draft PR #36 (backup/DR) is separate.  
**Source of truth:** Obsidian `Investment_OS` for investment knowledge; structured database for numerical series.  
**Live:** this document and PR #37 do NOT authorize a Production merge, migrations, Vault writes, new credentials or changes to protected Thesis/Portfolio.

## A. Existing Vault — organize and link without losing history

1. Inspect `get_vault_info.knowledgeAudit` only after `indexReady=true`, then `plan_vault_organization`. Use page-limited `list_notes`, `search_vault`, `read_note`, `get_links` for exact source paths.
2. Preserve the **immutable raw** / archived chat records. Distinguish Note content from proven issuer fact; `chatgpt_history` and `chatgpt_export` are not independent sources.
3. Map **existing** Company Hubs (`01_Companies/*`), dated Company Evolution timelines, Industry/Theme (`02_Industries_Themes/*`), Concepts (`03_Concepts/*`), Macro, event/source lineage and protected Thesis/Evidence Register. Prefer the existing canonical note to creating a competing new "latest" note.
4. Generate **navigation candidate edges** from exact declared company/theme metadata and actual existing target paths only. Check whether an Obsidian outgoing link OR automatically available backlink already connects the pair. Never infer `supplier_of`, revenue exposure or demand confirmation merely from co-mentions.
5. Keep historical chronology, date of event / publication / import / verification, source versions, analyst vintage, Original → Historical Interpretation → Later Review, contradictions and invalidated hypotheses. Never automatically promote a legacy date to economic `event_date`.
6. In particular, unresolved `07_Sources/ChatGPT/Archive/*.json|*.zip|*.txt` links require actual bytes discovery and hashing from authorized archives/devices. Do not manufacture missing originals or "repair" a raw source pointer by linking an AI summary.
7. For each actual content, metadata or cross-link change: read full source and target, classify proof and risk, prepare exact Safe Edit preview, obtain required actor/owner approval, apply a single minimal mutation, check SHA/readback/reindex/backlinks/operation receipt. Do not bulk rewrite or delete old notes. Protected Thesis/Evidence Register/Portfolio require distinct approval and evidence.

## B. New information — one closed loop, linked back to old history

1. **Receive** News, Earnings, IR/SEC, Broker/Industry Research, Transcript, Chat, Image or PDF. Archive original input verbatim/actual bytes separately from analysis, with source owner and explicit uncertain-attribution status.
2. **Retrieve before interpret**: issuer/ticker + original source and report vintage + topic/metric/reporting period, relevant Company Hub/Evolution, Industry/Concept, Evidence Register, Current Thesis and counter-evidence, using authenticated NoteMesh. Name the notes read.
3. **Verify & compare**: differentiate issuer/source Fact, Management, Guidance, Analyst Forecast, User Input, old AI Narrative, new AI Interpretation; inspect original evidence when available. Classify per **underlying** event + source family + metric + period: new_event / duplicate / added_detail / correction / contradiction / unresolved. Reposts and two quotes of the same company release are not two independent events.
4. **Analyze** Economic transmission (Demand → Backlog → Revenue Conversion → Margins → Earnings → FCF → ROIC) and Thesis Delta against the actual historical thesis, not invented current views. Where current price, consensus, holdings or independent evidence are missing mark `not_assessed`.
5. **Write source first**: use `plan_investment_writeback` and Safe Edit to preview/preserve a raw source note, then authorized apply and readback/reindex. Screenshots/PDFs require verified original-byte attachment path; extracted text is NOT the source file. If source receipt missing, dependent analysis preview must fail closed.
6. **Write separate review**: preserve provenance, source vs AI, dated event and fiscal period, source classification, counter-evidence and uncertain claims. Link original source and relevant existing history. Use actor-scoped receipts and stale-version refusal.
7. **Update existing canonical layers** after duplicate resolution: add one versioned event/metric to Company Evolution and Industry/Concept where material; cross-link Company Hub, event lineage, source and evidence. Do not rewrite a prior broker price target or call a new detail an independent new event.
8. **Protected decision**: propose Evidence / Thesis / Portfolio Change Log with evidence and owner approval separately. No automatic thesis edits or trading changes.
9. **Verify** submitted `queued` vs `imported_server_only` vs `written_and_readback_verified`; verify target bytes/hash, indexed search and actual wikilink/backlink resolution, then device Obsidian Sync separately. A server upload receipt is not proof a mobile device has the new note.
10. **Report truthfully** which exact paths were read/created/modified, accepted classification, event date, operation receipt, what failed and what remains `pending_writeback`.

## Release acceptance — not yet completed

- **Code gates:** read-only Organization Planner unit and MCP catalog tests; source-first Safe Edit tests from PR #33; no unapproved Protected Write.
- **Data gates:** representative old Company/Theme/Source archival note routes through source-verified link review without lost prior content, duplicate edges or false causal statements.
- **New-data gates:** one synthetic financial-event pilot: raw source → historical dedup → review → canonical Company Timeline/Theme link → Safe Edit readback + reindex → receipt; test conflict/duplicate retry.
- **Sync gate:** inspect arrival on actual user's remote/mobile Vault independently if requested and authorized.
- **Deployment:** PR #37 is stacked on PR #33 and cannot be merged to Production without explicit owner approval; Production deployment, staging and credential/scope changes are out of scope.

## Observed baseline (live read-only NoteMesh audit, 2026-10-18)

- 3,365 indexed Markdown notes; 0 unindexed.
- 54 unresolved link references, including historical archive originals, plus 3 indexed orphans.
- 2,617 legacy aliases interpreted non-destructively. These are **not** automatically incorrect or 2,617 independent verified facts.
- 4 structured claim register notes, 14 declared claim rows; never infer complete economic coverage from these counts.
- This is an **indexed metadata audit**, not independent re-verification of note bodies, originals or mobile Sync.

References already in Investment_OS Vault: `10_Knowledge/Research Methods/Investment OS - Canonical Knowledge Data Model v1.md`, `10_Knowledge/Research Methods/Investment OS - Evidence and Update Rules.md` and `08_Daily_Weekly/Research Indexes/00_Chat_to_Obsidian_Closed_Loop_Operating_Protocol.md`.
