# Investment OS: research, prices and portfolio data

## Goal and ownership

One set of structured data should serve ChatGPT research, an eventual portfolio website and a mobile app. Obsidian owns source notes, claims, research, thesis versions and decision rationales. Relational databases own numerical series, typed event links and the transaction ledger. MCP and future authenticated HTTP APIs call the same domain functions; clients never open a SQLite file over the network.

| Domain | Canonical data | Implementation in this change |
| --- | --- | --- |
| Knowledge | Existing Obsidian vault, source documents, claims and thesis history | Existing Read Only / Save Linked Notes / Safe Edit retained |
| Market data | Daily price bars, listing identity, currency/timezone, corporate actions, quality issues, refresh receipts | SQLite collector, query service and read-only MCP tools |
| Event research | Event identity, original publication time, affected listings, related source/claim/thesis versions and analysis runs | Read-only event-window calculation; persistent event registry is a next phase |
| Portfolio | Accounts, exact executions, fees, transfers, FX conversions, cash events, lot allocations and decisions | Contract below; ledger/import/UI are not implemented or populated in this change |

Do not turn every price bar into a Markdown note. A saved research note contains a compact result, data coverage, method version and links/IDs. Do not infer an executed trade from a research opinion, watchlist, price chart or portfolio snapshot.

## Stable keys and relationships

Use separate `entity_id` (company), `security_id` (share class), `listing_id` (market listing), `event_id`, `note_id`, `claim_id`, `thesis_version_id`, `decision_id`, `account_id` and `execution_id`. Multiple listings, ADRs and Thai DRs can refer to the same economic company while retaining independent prices, volumes, currencies and calendars.

The pilot currently exposes a listing reference such as `US:NVDA` / `TH:NVDA80`. Before importing a broad universe, introduce immutable listing IDs and a provider-symbol alias table with valid-from/valid-to dates. Preserve external references through aliases; ticker renames must not create a second holding or merge unrelated securities. IPOs, delistings and listing changes require explicit metadata; a present-day watchlist is not a survivorship-free historical universe.

Suggested event relationships:

- `events(event_id, event_type, entity_id, event_date, published_at, received_at, first_seen_at, verification, original_source_id, dedup_key)`.
- `event_listings(event_id, listing_id, relevance, affected_session, timing_source, timing_precision)`.
- `note_links(note_id, vault_path, content_hash, indexed_at)`; note IDs survive renames.
- `event_evidence(event_id, note_id, claim_id, thesis_version_id, relation)`; multiple sources can describe one event.
- `analysis_runs(run_id, event_id, method_version, parameters_json, dataset_hash, computed_at, result_json, source_note_hashes)`.

Deduplication uses entity + event/metric + reporting period + original source, following the existing Investment OS evidence rules. Reposts and earlier ChatGPT interpretations are not independent confirmations. Store uncertain dates as null; never substitute `received_at` for `published_at`. Linking/indexing notes does not authorize changing them.

## Event-window contract

Questions supported by this direction include: “How did the stock move after this earnings release over 1/3/5/10/20/60 sessions?”, “How much was relative to its benchmark?”, “Was volume unusual?”, and “What thesis and decision did I have at the time?”

The implemented calculator takes an explicitly established first affected exchange session and timing (`before_open`, `during_session`, `after_prior_close`, `unknown`). The caller must read the original source and check the market calendar; after-close news belongs to the following session. Unknown timing refuses calculation. The current calendar is provisional: observed same-market ETF benchmark dates, not a verified official exchange calendar. A missing benchmark day that is not a known quarantine cannot be detected automatically.

For horizon N, compare the preceding benchmark session close to the close of the Nth observed benchmark session including the event session. Match stock and benchmark by date, refuse gaps/quarantines, and leave unobserved horizons pending. Missing days are never compressed or filled. Defaults use explicit ETF proxies: US SPY, TH TDEX, HK 2800, JP 1306. These are not official index levels, sector controls or proof of causality.

The output reports cumulative stock return, benchmark return, their difference in percentage points, closing-price range relative to baseline, event volume versus the prior 20 observed sessions, and a sample hash. Split-contaminated volume comparisons are unavailable. `close` and separate provider `adjustedClose` are explicit alternatives. The calculator does not claim a beta-adjusted abnormal return, CAR, p-value or causal effect.

Before a formal event study, add verified exchange sessions/half-days, original announcement timestamps, market/sector benchmarks, estimation windows, regression assumptions and overlapping-event flags. Daily bars cannot isolate a midday announcement or prove a fill price. Keep price return, dividend-adjusted return and FX effects separate. Current-provider historical adjustments and today's ingested news cannot recreate what an investor knew years ago. Point-in-time tests require immutable dated snapshots and historical thesis versions from then onward.

## Portfolio contract for the next phase

Preserve broker-confirmed executions and cash events as an append-only ledger. A correction is a reversal/superseding entry with a reason, not a deletion. Each import has a stable source hash and external execution ID for deduplication, preview and user review. Partial buys/sells are independent fills. Do not create transactions by differencing snapshots without explicit review.

Store trade time, exchange-local trade date, settlement date, listing, quantity, execution price, currency, commissions/taxes, account, broker reference and linked decision/thesis version. Use exact decimal strings/scaled integers in SQLite and NUMERIC on PostgreSQL for quantities/money; never calculate the ledger with floating-point OHLC. Capture actual FX conversions separately from end-of-day valuation FX. Snapshots reconcile ledger positions; discrepancies remain unresolved rather than silently changing history.

Views are derived from that ledger: holdings, cost basis with a named/versioned lot policy, realized/unrealized P&L, dividends, fees, cash, daily equity, cash flows, drawdown, time-weighted performance and money-weighted performance. Do not mix these measures or count an internal transfer as investment profit. Broker buying power/line available is not automatically cash or a deposit. Preserve the user's established portfolio accounting rule as a separately named reconciliation view.

Trade review overlays executions and decision notes on price history. Compare after-entry/after-exit outcomes over fixed windows including costs and FX, alongside the contemporaneous thesis and risk plan. A later price rise by itself does not establish that a sale was a bad decision.

## Storage and application boundary

Start with the existing single-server architecture and a separate `market-prices/prices.sqlite` outside the vault. Keep source and quality metadata with every series. The database has a 4 MiB default cap (optionally 8/16 MiB) and preserves at least 50 MB plus rollback-journal room before writes; expansion needs a measured disk budget, not an automatic volume upgrade. The pilot is four stocks plus four comparator ETFs, not the whole four-market universe.

Separate the private portfolio ledger from public-derived market data and the auth/index database. Add authenticated service endpoints over domain functions when building the website/app. Keep portfolio writes behind explicit authorization; the read-only research credential cannot submit transactions. Obsidian Sync replicates notes, not SQLite databases. Mobile clients access the service through APIs; an offline app gets a deliberately scoped cache.

SQLite is appropriate for this personal, single-writer pilot; a website does not itself require PostgreSQL. Move structured data to PostgreSQL when multiple server replicas/concurrent writers, operational backups or scale justify it. Use versioned migrations and domain IDs so APIs and notes do not depend on the storage engine. No new paid database or new hosting service is provisioned by this change.

## Delivery sequence and acceptance

1. Market-data foundation: test four markets and proxies, quality handling, query-only MCP, disk limits, source errors and refresh behavior.
2. Event registry and Obsidian bridge: stable IDs/source timestamps, read-only indexing and preserved note/thesis hashes; explicitly authorized writes use existing save/edit paths.
3. Event research: verified calendar/timing, pre/post windows, benchmarks and reproducible saved analysis runs; report incomplete/confounded results.
4. Portfolio ledger: synthetic imports first, exact arithmetic and reconciliation, then user-reviewed real transaction imports.
5. Website/mobile UI: reuse authenticated domain APIs for charts, event markers, transactions and research links. Do not build a second parallel dataset.

Phase 1 and a provisional event calculator are code-tested here. Production activation, ordinary-chat tool discovery, persisted event registry, portfolio import and app UI are separate acceptance steps and must not be represented as already complete.

Optional personal Drive archive backend is implemented separately in GOOGLE_DRIVE_PRICES.md: immutable signed per-listing snapshots and catalogue for a 200-listing universe, incremental daily updates, verified downloads of only requested listings into bounded RAM, no live SQL file on Drive. Portfolio transactions still require a transactional database in a later phase.
