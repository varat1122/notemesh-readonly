# PR #97 — Investment Reasoning Contract (Offline / Synthetic)

## Strategic pivot

PRs #84–96 established offline structured historical comparison, source
snapshot reconciliation, bounded citation and Thesis-line matching,
unverified candidate triage, multi-claim event review, and optional
accounting identity checks. **This milestone shifts from adding more
accounting validators to defining how an investment analyst's proposed
reasoning MUST be evidenced, challenged and reviewed.**

The target is institutional reasoning across:

Demand → Revenue Conversion → Gross Profit → Operating Profit →
Earnings → Cash Flow → Return on Capital → Valuation.

**Important:** This PR is a schema/validation **contract** for a future
reasoning model, not the model itself. It does not demonstrate the
ability to infer economic mechanisms from a document or to evaluate
whether a management statement is correct.

## Actual executable code

`reviewOfflineInvestmentReasoningContract` accepts:
1. The existing PR #95 **2–6 claim synthetic offline release packet**;
   PR #95 re-executes the source's physical Markdown/SQLite/FTS checks,
   bounded Thesis-line exact hash/citation checks and per-claim historical
   review before producing a release-level exception queue.
2. A separately authored, **untrusted** reasoning proposal containing:
   - a 1–6-step **explicit forward illustrative causal chain**;
   - case-index citations for each causal step and text labelled
     `unverified_hypothesis`;
   - a candidate primary bottleneck, not a declared established one;
   - bounded demand / conversion / execution / economic / balance-sheet /
     valuation risk candidates;
   - status of cited counter-evidence, one or more **alternative
     explanations**, and outstanding evidence requirements;
   - proposed Thesis relation and direction, **unquantified magnitude**
     and **uncalibrated low/medium confidence**;
   - explicit `marketExpectation: not_assessed_no_current_market_data`
     with `priceInConclusion: not_determined`.

**New behavior:** Checks explicit evidence-case indices are within the
physically processed release packet, that at least one linked claim
carries the relevant proposed economic channel, that the forward chain
is contiguous and jumps are marked as unverified intermediate
mechanisms, that the model cannot set high confidence, price-in,
owner authorization, automatic write, or a fabricated verified fact.
A hypothetical Thesis challenge or inherited PR #95 contradiction
escalates to **owner-priority UNVERIFIED review**, never approval.

Note: the chronological and financial causal pathway of a real
company is more flexible than a linear chain. This contract is only
one **illustrative forward path**, not a claim that every causal
relationship must follow adjacent stages. Skipped stages are permitted
only with an explicitly named missing intermediate mechanism, and
require human review; reverse and feedback-loop causality remain
future work. The validator is not a replacement for analytical
judgment.

## What is NOT proven

- `evidenceCaseIndices` are *indices into this candidate packet*,
  **not authenticated primary source citations**. The selected
  historical/Thesis bytes exist in an offline snapshot, but the real
  owner has not independently consented to their use. An issuer URL
  or source SHA is caller-declared, not authenticated against
  the issuer's actual filing.
- The typed economic channel comes from earlier **untrusted** analyst/
  model proposals. Matching a channel enum is NOT proof that the
  mechanism is financially valid.
- Free-form hypotheses, risk rationale and alternative explanations
  are untrusted and **never echoed** into the returned review envelope.
  The output contains ordinal case indices, approved enums and fixed
  reason codes only, not protected Thesis text, claim values, note
  locations, URLs or arbitrary model instructions.
- Historical citations do not make archived AI an independent
  issuer source; checking candidate counter-evidence does not
  establish exhaustive source coverage.
- Market price, current consensus, positioning, earnings revisions,
  absolute or relative valuation and price-in are **not assessed**.
- No scenario probability, conviction, target price, portfolio action,
  autonomous drafting of live Thesis change, human approval or
  real production notification.
- No model invoked; API testing is **PAUSED** until the owner
  explicitly resumes it. The contract is offline code only.
- No production Vault access, sync change, MCP endpoint, API key,
  file write, Current Thesis edit, Evidence Register edit or
  Portfolio mutation.
- Passing synthetic CI proves test code behavior against fabricated
  examples, **not** actual AI semantic performance, economic truth,
  owner permissions or deploy readiness.

## Synthetic adversarial tests

The isolated fixture creates fictional Markdown, SQLite and FTS
snapshots; verifies 3-claim historical reconciliation; accepts a
bounded causal reasoning draft while retaining all claims; escalates
proposed Thesis challenges; inherits prior numerical contradictions;
rejects fabricated/out-of-range citations, unanchored mechanisms,
broken chains, confident or priced-in claims, empty counterfactuals,
forged approval fields and tampered snapshot/Thesis files; verifies
proprietary quote and prompt-injection redaction.

## Next milestone

Implement a **Model-Ready Reasoning Evaluation Dataset (offline)**:
structured, dated, synthetic Bull/Base/Bear interpretations with
explicit grounded claims, adversarial counter-evidence and expected
uncertainty, so future API/model testing can be evaluated against a
pre-agreed rubric instead of merely format validity. Only perform
API testing after the owner's explicit restart instruction.

**This PR must remain DRAFT. DO NOT MERGE OR DEPLOY.**
