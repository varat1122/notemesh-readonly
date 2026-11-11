# N8 — Broker Estimate Old→New Read-only Candidate

Task: `IOS-ORCH-RI-001` — N8. Stacked Draft on N7 / PR #173.
Version: `IOS-RI001-N8-READONLY-1`. Development-only, not merged or deployed.

## Purpose

Answer whether two **specific existing attributed broker-estimate observations**
can safely be compared. The result is a numerical **revision candidate**, not
independent verification of a broker's report, a company forecast, market
consensus, true price-target raise, or investment recommendation.

This slice reuses the existing Safe Edit Source/Claim receipts and current
Company Hub navigation. It does not create a new Source, Claim, PDF archive,
ledger, graph, policy, dashboard or runtime service.

## Input and output

Read-only MCP tool: `preview_estimate_revision`.

- `earlier.path`, `earlier.noteSha256`: exact existing generated Claim and full note hash.
- `later.path`, `later.noteSha256`: later **different** Claim and hash.
- `asOf` optional: timezone-aware cutoff; current-index availability filter.

Success requires separately indexed/read-back receipts for both full Claim
and Source bytes, exact original received-text anchors, a consistent current
Company Hub, matching entity, metric, fiscal period, unit, and matching
fully declared accounting basis (`standard`, `shareBasis`, `scope`,
`definition`). Both claims must be `analyst_estimate` with
`estimate.role=broker_estimate`, the same explicit broker provider, and
strictly increasing calendar-date `forecastVintage`.

A date-only source publication is conservatively treated as a time window.
Inverted publication chronology, missing dates, mismatched identity/basis,
invalid hash/receipt/index, future recorded bytes, unparseable numeric values
or insufficient Hub navigation produce `hold` without a numeric delta.

For valid values, differences are exact scaled-base-10 integers. Percentage
change = (new − old) / abs(old) × 100, rounded to two decimals. Old=0 means
percentage is `null`. No rounding of the original values and no conversion
between currencies, scale units, share bases, fiscal calendars or accounting
standards. The output includes both source-receipt pointers, source
publication dates, forecast vintages, caller-provided excerpt/locator and
disclosure of unknowns.

## Trust / time / authority boundaries

- Byte/hash/receipt verification is **local persistence integrity**, not
  third-party publisher authentication or factual/semantic validation.
- Broker names, report dates, accounting dimensions and PDF page/table
  locators are caller-attributed metadata; no PDF visualization or original
  byte-archive access occurs in this tool.
- Neither a single-broker estimate nor multiple rewrites of one broker are
  consensus or independent corroboration. Every output has
  `independentEvidenceIncrement=0`, `semanticFidelity=not_assessed`,
  `sourceAuthenticityVerified=false`, `economicForecastVerified=false`.
- `asOf` filters current note bytes by verified server-written time plus
  declared publication/vintage; it does not reconstruct historical market
  knowledge or prior Vault versions. Missing/ambiguous timestamps hold.
- All `canAutoWrite`, `canEditThesis`, `canEditPortfolio` flags are false.
  Protected Thesis, Evidence Register, Company Timeline, Portfolio and
  Decision Ledger are outside this feature.

## Test scope

Synthetic tests cover comparable revenue revisions, retained estimates,
zero-old-value percentage, wrong issuer, mismatched broker/role/metric/fiscal
period/unit/accounting basis, invalid forecast order, historical cutoff,
tampered full note hashes, duplicate identity, MCP read-only annotations,
quoted-text fencing and no Vault/receipt/database mutations.

CI and independent assessment must bind the exact commit/tree. The present
code is not a deployed finance data source or an accepted semantic
investment recommendation.

## Next research work (separate acceptance)

Add PDF page/table/footnote-to-Claim proof and report-version mapping using
actual authorized original bytes; then evaluate source-grounded broker revision
semantics against blind fixtures. Only after rights, original-byte archive,
page coverage and independent review may the product call this a verified
report revision or use it as an estimate dataset input.
