# Investment OS — Instrument Identity Contract v1

Status: draft hardening contract; no Production activation.

## Purpose

Market data, valuation, portfolio and quant must distinguish the economic issuer/security from each traded listing. The current price cache reference such as `US:TSM` is useful for one provider/listing query, but it is not an immutable canonical listing identity and must never by itself imply issuer, share class, ADR/DR status, underlying security or conversion ratio.

This contract implements the Master requirements that ticker is insufficient, Entity != Instrument, and DR/ADR prices remain listing-specific.

## Identity layers

- `issuerId` — economic issuer/entity identity. Several securities/listings may share one issuer.
- `securityId` — security/share-class/depositary-receipt identity.
- `listingId` — immutable listing identity, independent of ticker rename.
- `venue` — four-character MIC/documented venue code.
- `ticker` — venue-local current symbol, not the stable identity.
- `marketPriceRef` — compatibility link to the legacy `market:symbol` cache; never the canonical identity.
- provider aliases — provider-specific symbols with valid-from/valid-to dates.
- underlying mappings — ADR/DR receipt-unit relation to an explicit underlying listing, also with effective dates and provenance.

## Evidence and fail-closed rules

A listing or receipt mapping may exist as `unverified` / `not_reverified` for discovery, but cross-listing unit conversion is allowed only when both:
1. the listing identity is `verified_against_primary`; and
2. the active underlying mapping is `verified_against_primary` with an HTTPS primary-source locator and observation date.

The registry rejects:
- duplicate immutable listing IDs;
- one provider alias mapping to two live listings over the same period;
- self-underlying mappings;
- missing underlying listing IDs;
- overlapping active ADR/DR ratio mappings;
- ADR/DR entries without an explicit mapping record;
- currency conflict between a listing and its legacy market-price adapter.

An unverified mapping is not silently upgraded. A changed ratio creates a new dated mapping period; history is preserved.

## Price semantics

The price of an ADR/DR is the traded price of that listing. The underlying price is a related observation, not a substitute quote. Conversion metadata relates units only; FX, time-zone/session differences, market closures, fees, taxes, creation/redemption frictions and basis risk remain separate.

No function in this contract calculates an arbitrage value or executable proxy price.

## Real mapping intake

Real issuer/listing mappings must be sourced from official exchange, issuer/depositary, prospectus/terms or another authorized primary record. Record:
- source URL/document and observation date;
- listing/security/issuer IDs;
- venue, local ticker, share class, currency, type and validity dates;
- provider aliases and their validity;
- ADR/DR underlying listing and exact decimal unit ratio;
- effective dates and verification status.

Do not populate TSM/2330, Thai DRs or other real mappings from model memory. If primary evidence is unavailable, keep the relationship unverified and conversion disabled.

## Current compatibility state

The existing daily-price cache remains unchanged and continues to key bars by `market:symbol`. Read surfaces now state that this is a legacy price-cache reference with:
- `canonicalListingId: null`;
- `crossListingConversionAllowed: false`.

This hardening layer is intentionally additive. A later reviewed migration can persist canonical listing IDs/provider aliases in the price/archive catalogue after real identity data and compatibility tests are ready.

## Acceptance before scale

Before price data is used for cross-listing valuation, Quant or Portfolio:
1. representative common/ADR/DR mappings pass primary-evidence review;
2. ticker rename and ratio-change fixtures preserve history;
3. provider alias collisions fail closed;
4. reads never substitute an underlying quote for the traded listing;
5. Drive catalogue/snapshots bind to canonical listing IDs or carry an explicit legacy-unmapped status;
6. Portfolio imports resolve executions to canonical listing IDs before reconciliation.

No Production collection expansion is authorized by this document.
