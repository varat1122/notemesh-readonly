# Daily Prices series contract v2 — isolated candidate

สถานะ: CODED / synthetic fixtures only. Live mappings, real history, provider entitlement,
Drive ownership and independent team access are NOT VERIFIED. This document activates nothing.

## Canonical pipeline and identity

Reuse PR #130: Yahoo chart → validator → per-listing SQLite in RAM → closed signed gzip
`.iop` snapshot → signed V2 `.ioc` catalogue → bounded cold reader → existing four price MCP tools.
No price files in Obsidian; no mutable SQLite mounted over Drive; no separate worker/database engine.

Opt-in profile: `MARKET_PRICES_PROFILE=reviewed-pilot-v1`. Default historical watchlist is preserved.
The inactive example `integrations/market-prices/reviewed-pilot.example.json` is a proposed pilot,
not the Owner's holdings or proof of data entitlement. Extend `universe.ts` with an explicit
asset class, venue, provider type and venue code plus tests before extending the reviewed profile.
Unknown mappings are rejected at provider parsing and rights gates. Live provider metadata
must independently confirm the configured mapping; fixture agreement proves parser behavior only.

| ID | Provider symbol | Asset / configured venue | Currency / timezone |
|---|---|---|---|
| US:AAPL; US:MSFT | AAPL; MSFT | equity / XNAS | USD / America/New_York |
| US:SPY | SPY | equity ETF / ARCX | USD / America/New_York |
| US:QQQ | QQQ | equity ETF / XNAS | USD / America/New_York |
| US:^GSPC | ^GSPC | S&P 500 index level / S&P_DJI_INDEX | USD / America/New_York |
| US:GLD | GLD | gold ETF / ARCX | USD / America/New_York |
| TH:PTT | PTT.BK | equity / XBKK | THB / Asia/Bangkok |
| JP:7203 | 7203.T | equity / XTKS | JPY / Asia/Tokyo |

`XAUUSD=X` (spot) and `GC=F` (continuous future) are identified UNSUPPORTED categories:
no spot venue certification, futures contract/roll policy, or data rights. GLD is never a
replacement for either. SET index, HK pilot and official calendars are outside this candidate.
Even the eight supported parser mappings are configured candidates, not live-certified identities.

## Read contract

`list_price_instruments` returns normalized identity and coverage. `read_price_bars`
accepts existing market/symbol/start/end/limit parameters. Limit 1–1500, latest bars in
inclusive range returned oldest first. For earlier pages narrow the end date to the day
before the earliest returned bar. No forward fill, cross-listing substitution or current quotes.

`seriesSchemaVersion=2` has these fields:

| Field | Meaning |
|---|---|
| instrument.id / market / symbol / yahooSymbol | Stable normalized identifier and source symbol |
| instrument.assetClass / venue / currency / timeZone | Configured economic identity; `identityStatus` explicitly unverified live |
| bars[].date | Exchange-local market session date YYYY-MM-DD, not UTC download date |
| open/high/low | Positive finite numbers together, or all null for close-only data |
| close | Required positive finite number; no fabricated close |
| volume | Nonnegative safe integer or null; zero remains zero |
| adjustedClose | Separate positive provider field or null; never used to synthesize adjusted OHLC/volume |
| completeness | ohlcv, ohlc_without_volume, close_only |
| fetchedAt | Per-row UTC download observation time; omitted older rows retain older timestamps |
| valueHash | Deterministic SHA-256 of identity/source/basis/date/values; excludes observation time |
| series.source / sourceUrl / priceBasis | yahoo-chart, fixed source endpoint and provider adjustment caveat |
| series.rights | RIGHTS_HOLD or OPERATOR_ATTESTED plus non-secret review evidence reference/terms URL |
| latestRefresh / qualityIssues / total / truncated | Attempt result, quarantine, coverage and pagination limits |
| actions | Source dividends/splits, separate from OHLC; source event-key upsert |
| revisionAudit | Bounded detailed corrections (5000/partition), not permanent full vintage history |

Hash input is the JSON array `[instrumentId,"yahoo-chart","provider_quote_v1",date,open,
high,low,close,volume,adjustedClose]`, UTF-8, JSON numbers/null and that exact order.
Do not interpret it as proof of a source license or independently correct market price.

Storage uniqueness is `(instrument_id,date)` within the fixed yahoo-chart/provider_quote_v1
partition; the instrument map fixes venue/currency/timezone. A new provider/basis/venue MUST
use a new explicitly versioned namespace; replacing source in place is forbidden.
Legacy non-null `bars` table stays intact; additive `partial_bars` holds rows needing nulls.
All writes switch tables transactionally, giving one row/date; old readonly archives with
neither extension remain readable and report missing legacy rights metadata as RIGHTS_HOLD.
Detailed refresh audit is bounded at 10000; history bars/old immutable Drive files are not cleaned up.

O/H/L violations and invalid volumes are quarantined; missing close or partially supplied O/H/L
is skipped and counted, never imputed. Gaps remain gaps. A later valid correction resolves
quarantine, records old/new values and replaces the value hash. adjustedClose-only jitter
<=1e-6 relative is stored but excluded from detailed correction counts, matching existing policy.
Weekly/full overlap checks cannot guarantee all provider corrections or point-in-time history.

## Rights and source access

Default live collection is RIGHTS_HOLD, including legacy entrypoints. Without any approved
listing, return one per-symbol receipt before opening disk/Drive or contacting the provider.
For mixed rights, only approved mapped listings may call the provider or publish partitions.
`MARKET_PRICES_RIGHTS_REVIEW` is strict JSON: provider `yahoo-chart`, scope
`private_team_archive`, HTTPS termsUrl, evidenceRef (12–500 chars), UTC reviewedAt/expiresAt,
unique instrumentIds. Missing, expired, future or wrong-scope review fails closed.
OPERATOR_ATTESTED means an operator asserts that evidence exists; software does not grant
a license. Do not populate this config with an unreviewed personal-use assumption.
Injected fetchers are internal fixture seams only; HTTP/MCP does not accept them.

## Sessions and receipts

Proposed 03:23 UTC = 10:23 Bangkok: prior US session, prior TH/JP/HK completed session.
Normal venue readiness in local time is US17:00, TH17:40, HK17:10, JP16:30, including an
assumed ~60 minute publication lag. IANA timezone conversion handles US DST. Weekends are
excluded. No official holiday/early-close calendar is configured: holidays can conservatively
produce STALE_SOURCE; adjudicate against an approved calendar, never invent a missing bar.
`expectedClosedSession` supports explicit known closures but the live config does not yet
wire an authoritative calendar. Date-based weekday expectation is an engineering heuristic.

Each configured listing receives UPDATED, ALREADY_CURRENT, STALE_SOURCE, FAILED,
UNSUPPORTED or RIGHTS_HOLD, with latest session, total cached row count when known,
correction count and sanitized reason. Null date/count means not observed, not zero coverage.
Run COMPLETE requires no pending or failed listing; a published partial archive is not a
successful whole-universe update. Same-day unchanged provider response is ALREADY_CURRENT.
Source 429/401/403 stops the batch and preserves cooldown. Actual provider calls, including
incremental rebase calls, share a 24-request/run budget and existing request/run deadlines.
That engineering cap is not a verified free provider quota or an account-wide daily cap.

## Drive / independent analyst boundary

Catalogue V2 maps listing to immutable archive ID, databaseBytes, barCount, first/last dates,
last attempt/success/error and full-refresh timestamp. Existing HMAC domains are retained.
Archive is signed gzip SQLite with SHA/HMAC checks; signing is integrity, not encryption.
Privacy relies on dedicated Drive ACL/OAuth. Reader verifies signature/hash/length, SQLite
quick_check and identity/count before returning data. Publication order is immutable archive,
byte-for-byte download/readback, then signed catalogue and readback. Failure before catalogue
leaves an orphan snapshot; keep it for reconciliation, no deletion here. A failed catalogue
publish can leave remotely ambiguous state; inspect actual generations before any retry.
Removed watchlist entries remain discoverable; readers load max2 requested partitions/query,
cache max8/16MiB, one partition max4MiB. Catalogue stays bounded at204 entries; future expansion
must budget retained entries as well as active ones. No atomic multi-host compare-and-swap exists.

Existing MCP consumers need authorized NoteMesh access. A standalone team member cannot open
the signed private bundle with just a Drive URL: they need authorized Drive access and an
approved reader/integrity-key service. Do not distribute server encryption keys to analysts.

CSV/Parquet export is DESIGN ONLY, no new endpoint/sidecar or real export in this task.
Approved export worker would read an authenticated verified catalogue generation, unpack
approved partitions, page the reader, and emit `prices-v2.csv` plus `manifest-v2.json`:

* CSV columns: schema_version,instrument_id,provider_symbol,asset_class,venue,currency,
  timezone,session_date,open,high,low,close,volume,adjusted_close,price_basis,source,
  source_url,fetched_at,completeness,value_hash,rights_status,rights_evidence_ref.
* UTF-8 RFC4180, header, CRLF, decimal point, UTC ISO timestamps, empty cell=null (never0),
  stable instrument/date order. Reject spreadsheet formula-leading text on export.
* Manifest: version2, exact catalogue ID/hash, per-file SHA-256/bytes/row counts/range,
  source rights evidence/expiry, generatedAt/jobId, source/basis, coverage/gaps/quality,
  disclaimer for non point-in-time data and export-access policy. All files staged and
  validated before publishing the export manifest. No silent overwrites or wider ACL.
* Parquet alternative: date32 session_date; nullable float64 OHLC/adjusted, int64 volume,
  UTC microsecond timestamp fetched_at; same identity/provenance columns and manifest.
* Legal rights for internal export must be reviewed separately if source entitlement limits
  extraction/redistribution. Release must verify an independent analyst's authorized read.
