# PR #96 — Offline Cross-Claim Economic Consistency (Synthetic Only)

## Why this milestone exists

PR #95 evaluates 2–6 separately cited and physically reconciled
synthetic claims from one declared issuer event. That does not imply that
Revenue, Gross Profit, Gross Margin, Operating Cash Flow, CapEx and FCF
are **economically consistent** or that any link was verified.

This change adds `runOfflineSyntheticEconomicConsistency` as an
**offline-only arithmetic-candidate layer** stacked on PR #95.
It never calls a model/API, reads live Vault data, authenticates sources,
exports protected notes, or grants any write or approval permission.

## What it checks — only when explicitly scoped

Supported identities require **exactly three distinct claim indices**:

| Explicit check | Required metric identities | Requirements |
|---|---|---|
| `gross_margin_identity` | `revenue`, `gross_profit`, `gross_margin` | Same period; Revenue/GP exactly same non-percent reporting unit; gross margin in `%`; revenue positive |
| `free_cash_flow_bridge` | `operating_cash_flow`, `capex`, `free_cash_flow` | Same period and monetary unit; explicit `nonnegative_cash_outflow_magnitude` for CapEx |

Inputs must be exact decimal strings (up to 6 fractional digits and
12 whole digits). Arithmetic uses fixed-point `bigint` rather than
IEEE floating-point. The user/caller declares an absolute rounding
tolerance in the common monetary unit (bounded at 0.5 reporting unit,
including zero).

- Difference **within** that declared tolerance:
  `arithmetically_compatible_not_fact_verified`.
- Difference **exceeds** that tolerance:
  `discrepancy_exceeds_declared_tolerance_needs_review`, and every
  linked claim is escalated to an **unverified owner-priority candidate**.
- Do not invent checks for missing line items or treat a matching
  arithmetic identity as proof that the issuer statement is true.
- Any duplicate metric/period/unit line item in the batch makes the
  identity ambiguous and **fails closed** — it is unsafe to cherry-pick
  one candidate of two conflicting reported values.
- Invalid indices, metric mapping, inconsistent currency/unit, different
  periods, bad precision, missing cash-flow sign convention, negative
  CapEx magnitude, zero/negative Revenue or unbounded tolerance all
  fail closed.

The batch still executes PR #95's physical snapshot/SQLite/FTS and
exact-line citation checks before releasing ANY review output.
No safe-to-discard decisions are issued and **no findings are dropped**.

## Financial / trust boundaries

- The gross-margin identity uses Gross Profit / Revenue; a percentage
  reported by management may be rounded or calculated with a different
  revenue perimeter (GAAP versus non-GAAP, segment versus consolidated).
- FCF is not universally standardized. OCF minus a *positive cash
  CapEx outflow magnitude* is only an **explicit hypothetical
  definition**, not proof of the company's reported FCF definition.
- Historical match, source hash and stored note text do not authenticate
  an issuer original; `fixtureKind` does not independently prove it is
  actually a synthetic fixture or give owner permission to read.
- A matching arithmetic relationship is **NOT** a causal conclusion
  about demand, revenue conversion, margins, operating leverage,
  earnings, cash conversion, ROIC or valuation.
- Profit margins cannot substitute for dollar revenue conversion;
  FCF cannot be derived from Net Income without other evidence.
- No current market pricing or consensus was consulted; no valuation,
  portfolio recommendation or automatic Thesis update is made.
- The owner-facing queue intentionally omits note paths, URLs, raw
  values, amounts/deltas, selected Thesis prose and free-form
  model/analyst content. Returned reason codes are fixed.
- Test CI success is not real financial accuracy, independently
  verified source provenance, cross-device sync or production
  authorization.

## Synthetic integration coverage

Isolated fictional Markdown/SQLite/FTS fixture tests cover:
normal GP/revenue/margin reconciliation, large GM mismatch, bounded
rounding, FCF bridge and required cash-outflow convention, both
identities in a six-claim release, distinct periods, mismatched units,
duplicate line items, nonnumeric/out-of-bounds decimals, stale Thesis
bytes, protected-text and prompt-injection redaction, preservation of
all claims and denial of write/release authority.

**No Merge. No Deploy. No production Vault, Thesis, Evidence Register
or Portfolio writes. OpenAI API testing remains PAUSED by user.**
