# IOS-ORCH-PRICES-ENG-001 — historical writer v0

Base: PR #182, `051317006251f66fdb183f012176eddda5e2e0bc`.
Owner work order: PR #179, comment `6942133568`.

## Scope

The existing `PriceStore.importHistory(bytes, options)` consumes the existing
#182 CSV parser and writes through the existing PriceStore connection, native
process writer admission, collector lease and one SQLite IMMEDIATE transaction.
It does not call a provider or create another service, database architecture,
collector, scheduler, API tool, runtime flag or production importer CLI.
W05 `csv-preview.ts`, #182 import-preview/cache-audit and their CLI are unchanged.

Default is `NO_APPLY`. An ordinary PriceStore handle always returns `D1_HOLD`
for apply. The only admitted handle is allocated by
`PriceStore.createDisposableHistoryFixture()` in `NODE_ENV=test`: this factory
creates a fresh private temp root and holds the native disk writer ticket.
There is no caller-supplied destination or option to admit an existing DB.
The factory's return value includes `root`; its caller closes the store and
removes that disposable root. Synthetic rights/mapping evidence cannot confer
storage rights for real owner files. Changing a label does not authorize real data.

## Persisted contract

- One listing `US:AAPL`, one source `owner_csv`, explicit `dataOrigin=synthetic_fixture`.
- One RAW/SPLIT_ADJUSTED/DIVIDEND_ADJUSTED/TOTAL_RETURN basis per series. No
  synthesized adjustment, O/H/L, volume, currency conversion or date filling.
- Full bars reuse `bars`; missing O/H/L or volume reuse `partial_bars`. Conflicting
  duplicate keys across both tables fail closed on import, Yahoo save and read.
- File SHA-256 binds exact imported bytes. Original decimal strings and a
  canonical input value hash survive in per-row provenance; existing SQLite REAL
  values remain the numerical reader representation. Decimal differences are
  not hidden by IEEE-754 rounding in overlap decisions.
- Each row retains source line, observed/retrieved/import times, receipt ID and
  revision. Missing retrieved time remains null; `fetchedAt` is the import time,
  not a claimed provider request. Receipt/source records are immutable, separately
  versioned metadata in the same SQLite transaction, not a parallel database.
- Same bytes replay without writes and retain the original receipt/time. A new
  file with identical overlaps may add new dates and gets a new receipt/version;
  existing per-row provenance is retained. Value/source/basis conflicts return
  `HOLD_CONFLICT` with old/new provenance and never replace last-good values.
- `read_price_bars` uses the existing disk cache reader and returns owner_csv
  provenance/basis rather than a Yahoo URL/hash label. Close-only O/H/L/volume
  stay null. Reader connections remain query-only. The most recent 20 import
  receipts are exposed; all receipts remain in SQLite within the existing DB cap.
- The legacy event-analysis contract holds owner_csv until source/basis review;
  it cannot silently treat the new history as Yahoo. Status labels mixed stores
  per-series. The existing eight REVIEWED_PILOT instruments (including AAPL) are
  a conflict control: the importer preserves all eight and holds existing Yahoo
  AAPL rather than overwriting it, even when dates do not overlap.

## Reproduce the isolated proof

```sh
pnpm install --frozen-lockfile
pnpm exec vitest run src/server/market-prices/history-import.sqlite.test.ts
```

Tests reuse the six frozen W05 `W05_GOOD_SYNTHETIC.csv` rows, adapting the CSV
header to the existing #182 format. Close-only/error variants derive from those
same rows. SHA-256 refers to the exact adapted input, not the original W05 file.
Tests cover real SQLite -> cold reopened cache -> existing MCP `read_price_bars`,
duplicate/conflict/replay, source separation, eight unchanged Yahoo fixtures,
query-only DB hash, native freeze/lease and mid-batch failure rollback (including
schema/provenance/receipts). No real owner file, quote provider or Vault is used.

## Remaining HOLD and rollback

Real owner import remains `D1_HOLD`: complete native runtime writer coverage,
physical exclusivity, off-volume backup and isolated restore/readback are not
proved by this process-local fence. Owner file bytes, storage-use rights,
listing/mapping and source-basis review, capacity and independent P1 review are
still required. No production/source entitlement is inferred from test success.

No production migration runs in this change. Discard the disposable test root
after closing connections. A transaction failure rolls back all batch changes;
conflicts preserve last-good without automatic repair. Roll back the code by
discarding/reverting this child branch only; preserve #179/#180/#182. Do not
point an old Yahoo-only reader at a synthetic imported DB and claim its source.

Exact change allowlist: `src/server/market-prices/store.ts`,
`src/server/market-prices/history-import.ts`,
`src/server/market-prices/history-import.sqlite.test.ts`,
`src/server/market-prices/event-analysis.ts`, and this document.
