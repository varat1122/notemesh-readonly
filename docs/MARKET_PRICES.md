# Daily market prices pilot

Personal-use Yahoo chart data for US / Thailand / Hong Kong / Japan, implemented inside the existing server without a Python runtime, a new dependency or a new hosting service. This is the same underlying Yahoo data channel commonly accessed with yfinance; it is an unofficial adapter, not Yahoo's supported commercial API. Do not bypass a provider block or promise permanent free availability.

## Use locally

Node 24 can run the collector directly:

```sh
DATA_DIR=./data pnpm prices:refresh
DATA_DIR=./data pnpm prices:status
```

For a deliberate diagnostic refresh: `pnpm prices:refresh --force`. Force does not bypass a one-hour provider cooldown after HTTP 401/403/429. The file is `DATA_DIR/market-prices/prices.sqlite`; `MARKET_PRICES_DIR` can move this directory outside the Obsidian vault. Never put a live SQLite database in Obsidian Sync or Git. Local shells behind a configured proxy may need Node's `NODE_USE_ENV_PROXY=1`.

The default pilot has NVDA, PTT, 9988 and 7203 plus the explicit comparator ETFs SPY, TDEX, 2800 and 1306. These are source-connectivity examples, not user holdings or an investment recommendation. Optional `MARKET_PRICES_WATCHLIST` is a JSON array, maximum 100 unique listings:

```json
[{"market":"US","symbol":"NVDA"},{"market":"TH","symbol":"PTT"},{"market":"HK","symbol":"9988"},{"market":"JP","symbol":"7203"}]
```

Use local codes without suffixes. Hong Kong codes have 4–5 digits (preserve leading zeros); Japanese codes may be alphanumeric, e.g. 285A. A custom watchlist must explicitly include any desired benchmarks. Unknown or unsupported provider symbols fail individually. Five-year history is a target, not a guarantee for a newly listed/security-with-missing-data instrument.

## Controlled server activation

Default: disabled. After review/deployment, set `MARKET_PRICES_ENABLED=1` on the existing service to start the background collector and expose the additional cached read tools on `/api/mcp`. It adds no new OAuth write scope and leaves Safe Edit flags untouched. Refresh the existing Read Only tool catalogue in ChatGPT when necessary; deployment does not prove that the conversation can already see new tools.

The collector runs at boot and checks every minute whether the daily refresh is due at/after 06:00 UTC (13:00 Bangkok). A pre-06:00 boot does not consume that day's later refresh. Persisted per-instrument receipts and a one-hour durable lease prevent duplicate/overlapping collection. Requests are sequential with three-second spacing. A failed instrument retries no more than hourly; provider auth/throttling errors stop the whole cycle and enforce a provider-wide hour cooldown. An outage keeps the prior usable cache visible with the error status.

Every pull refreshes the five-year window. Daily timestamps are converted using the provider-validated exchange timezone; the current exchange calendar day is excluded even after close. This is conservative next-day data. It is intentionally not real-time and will sometimes lag an already-closed session until the next local date/refresh.

## Integrity and read-only surface

- Check source symbol, currency, timezone and instrument type; refuse unexpected listings.
- Validate OHLC/volume, numeric finiteness, array lengths, duplicate dates and response size (2 MiB), timeout (25 seconds), fixed host and no redirects.
- Null bars are omitted with counts. Invalid bars are quarantined with original values, reason and timestamps, never repaired/forward-filled. More than ten invalid bars or more invalid than usable bars refuses the pull.
- SQLite transactions, FULL durability and a cross-process lease; retry cannot duplicate date-keyed bars or event-keyed dividends/splits.
- Raw provider quote OHLC may already reflect splits. Separate adjustedClose is not automatically substituted into OHLC. Each result describes its basis. Missing sessions and quarantine are visible.
- Retain older bars when a later response omits them, with their older fetchedAt, unless explicitly quarantined. Source corrections have bounded before/after audit history. Ignore tiny adjustedClose-only floating-point jitter for correction receipts while still storing returned values.
- 4 MiB default database page cap (optionally 8/16 MiB), DELETE rollback journal, and disk reserve check. Stop rather than expand paid storage. Audit retention: latest 10,000 refreshes / 5,000 detailed corrections; this is not an immutable institutional historical archive.
- No note changes, vault exports, deletions, general write tool or arbitrary provider URL in the price tools.

Tools (require the existing read access and the feature flag):

| Tool | Behavior |
| --- | --- |
| `list_price_instruments` | Coverage, listing, currency/timezone and latest refresh error |
| `read_price_bars` | Latest N bars in an inclusive date range, oldest first; bounded 1–1,500 rows, quality issues and corporate actions |
| `get_price_data_status` | Refresh receipts, quality issues, source policy and storage budget |
| `analyze_price_event` | Read-only stock/comparator window calculation, explicit event session/timing, missing-data statuses and dataset hash |

No tool initiates an external download or creates the database. No-read credentials get no tools. All existing Read Only and Save Linked Notes behavior stays in place when the feature is off. Safe Edit OAuth/canary remains a separate pending workflow.

## Example research flow

Read the relevant source and thesis using Read Only. Establish the actual publication time and the first affected exchange session. Then request the price event comparison for that session with an explicit return basis and comparator. Preserve assumptions, sample hash, missing/quarantined data and any overlapping news in the analysis. Save a compact linked analysis note only when requested, using the existing Save Linked Notes tool. The calculator does not register the event or edit a thesis itself.

See [Investment data architecture](INVESTMENT_DATA_ARCHITECTURE.md) for the persistent event registry, portfolio ledger and future web/mobile direction.

Storage diagnostics report available bytes, the unchanged application-index reserve and the bounded price/journal budget, without paths or secrets. `MARKET_PRICES_MAX_DB_MB` accepts only 4 (default), 8 or 16. A small pilot does not reserve the full optional expanded dataset budget. If the vault/index reserve itself exceeds available space, collection still refuses; no automatic paid resize or lower reserve.
