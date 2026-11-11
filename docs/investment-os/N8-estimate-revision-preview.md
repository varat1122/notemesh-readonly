# N8 — Broker estimate revision preview (IOS-ORCH-RI-001)

Read-only MCP tool `preview_estimate_revision` compares **two exact persisted Structured Claim note paths and SHA-256 hashes**, not free-form numbers. It does not write notes, receipts, forecasts, graph edges, protected records or portfolios.

Both source documents must be separately persisted `broker_research` records. Claims must be `analyst_estimate`, `broker_estimate`, with same resolved company Hub, provider, metric, fiscal period, unit and explicit accounting basis (standard/share basis/scope/definition). Strictly increasing ISO-date forecast vintages and compatible declared publication dates are required.

The tool checks claim/source byte hashes, original source excerpts and numeric anchors, FTS/index/link bindings, existing server-issued Safe Edit receipts and optional `asOf` cutoff for actual receipt times plus declared publication/vintage dates. This is a current-index availability filter, **not historical reconstruction**.

The comparison uses exact decimal arithmetic (no float rounding in deltas) and returns old/new, absolute change and percentage change. Zero old value yields null percentage; equal values are a no-change candidate, not proof of a repeated rating/target. Unknown currency, units, periods or accounting bases are never inferred.

**Not verified:** issuer/broker identity, PDF page/table/footnote, semantic metric equivalence, forecast accuracy, independent evidence, market consensus, economic exposure, valuation/price-in or original PDF archive. These require separate source-grounded review/C2 coverage. HOLD is returned on integrity, identity, chronology, unit, role or vintage mismatch.

N8 is a **CI-only engineering candidate** based on N7; it is not a live client, Staging or Production release.
