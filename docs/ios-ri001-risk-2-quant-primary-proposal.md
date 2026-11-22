# RI001-DRAFT-RISK-2.0-QP — proposal for quantitative PRIMARY research (DESIGN ONLY) — v0.2

**Status: PROPOSAL v0.2 / NOT IMPLEMENTED / NOT APPROVED.** v0.2 reconciles the
G3/G7/G8/G9 contradiction in v0.1 (blob at commit `7e5ee75`); see §3.0. §1 and §2 are unchanged
from v0.1. This document does not change
RISK-1.1, the Judge or the reviewer, and it adds no runtime path.

Implementation requires both of these, in this order:

1. Explicit Owner approval.
2. An independent security and source-review approval of this exact text.

Base for this analysis: branch `ccr-eca3beae-c1-usability`, built on PR #184 `2a8845dd`.

## 1. Current contract: RISK-1.1 (exact gates, `src/server/vault/research-draft-risk.ts`, `research-judge.ts`)

A non-Source Draft/Review is admitted only if `evaluateResearchJudge` returns `PASS`. Every
item below adds a HOLD reason (`unsupported` is a FAIL). Source capture is always preserved.

| Gate | Rule (code) | HOLD reason |
|---|---|---|
| G1 Binding | Exact envelope digest, sealed `riskScope` inventory and policy stamp `RI001-DRAFT-RISK-1.1` | `draft_risk_exact_envelope_required`, `draft_risk_policy_or_scope_hold` |
| G2 Coverage | All six risk dimensions are assessed, and every scope key is covered | `draft_risk_coverage_hold`, `draft_risk_dimensions_hold` |
| G3 Disposition | Every dimension must be `absent`. `material`/`uncertain` HOLD and require a critic; `unsupported` FAILs. | `draft_risk_<disposition>` |
| G4 Dual basis | Every finding cites (a) an exact UTF-16 span of the received Source **and** (b) an exact span of a *history* item that carries `sourceReceiptKey`. Only history notes at `00_Inbox/ChatGPT/Investment Intake - IN-*.md` carry one, so the prior Source must have been captured canonically in the same instance. | `draft_risk_source_history_basis_hold`, `draft_risk_citation_hold` |
| G5 **Any digit** | `/\p{N}/u` is tested over the full received text, all proposed Thai Review strings, broker metadata, and claim and relationship candidates. Thai digits, years, form names (`10-Q`) and method names (`X-13ARIMA-SEATS`) all match. | `draft_risk_quantitative_scope_not_supported` and critic required |
| G6 Broker | Any `brokerUpdate` or `sourceKind: broker_research` | `draft_risk_broker_scope` and critic |
| G7 Event | `materialRisk: true` or classification other than `added_detail` (also correction, contradiction, unresolved) | `draft_risk_not_routine_added_detail` and critic |
| G8 Declared material | Any of: content types earnings, guidance, broker_*, portfolio_snapshot; claim class management_guidance or analyst_estimate; an unresolved claim assessment; supplier/customer roles; more than one competing value | `draft_risk_declared_material_scope` and critic |
| G9 **Critic** | `criticRequired`, which is then **always** HOLD: the schema only allows `critic.independence: "not_verified"`, and no code path verifies a critic | `independent_critic_provenance_unavailable` |
| G10 Context | Any of these HOLD: issuer not resolved to an exact hub title or alias; PIT `historyCutoff`; `inputFormat` of pdf, mixed or screenshot; no typed Thai Review; history changed or not read back; incomplete retrieval or scope | constraint reasons |
| G11 Promotion | The Judge can never mark a claim `verified_primary`/`confirmed` | `judge_cannot_authorize_primary_promotion` |
| C1 reviewer | A dashboard session approves the exact binding digest, recorded as `admin:<id>` with `humanPresence` and `criticIndependence` both `not_verified`. An approval cannot override a HOLD or FAIL. | — |

**Consequence:** under RISK-1.1, *any* faithful financial or statistical item, and any item that
merely names a form or method containing a digit, is Source-only. This is a deliberate
abstention, not a defect. Two parts of it are product capability gaps: G5 makes no distinction
between kinds of digits, and G9 has no way to be satisfied.

## 2. Two-case feasibility under RISK-1.1 (mechanical; source custodian still decides)

- **MSFT P1-M2 (FY27Q1 10-Q, recast two-segment financials):** the faithful content is USD
  revenue and operating income per segment. It fails G5, G7/G8 (financial figures), and so G9.
  **Verdict: Source-only HOLD is correct.** A digit-free paraphrase would be unfaithful and is
  forbidden.
- **BLS P1-A (CPI seasonal-adjustment FAQ):** the content that is genuinely *added detail* is the
  treatment of the missing October 2025 index (geometric-mean approximation for seasonal
  factors). It contains a year or month digit, and the method name `X-13ARIMA-SEATS` contains
  digits. It therefore fails G5, and G9 follows. The pre-existing method description (intervention
  analysis) is not new relative to history. **Verdict: HOLD under RISK-1.1.**
- `bls.gov` and `microsoft.com` are also not in the default `SOURCE_ARCHIVE_ALLOWED_HOSTS`
  (`www.sec.gov, ir.amd.com, www.nso.gov.vn`). Archived original bytes for BLS would need operator
  configuration.
- **Narrow mechanism positives remain possible only** with self-contained, faithful excerpts that
  are genuinely digit-free, qualitative and non-material. In addition, an earlier related Source
  must have been captured canonically in the same C1 instance, so that G4 can cite it.
- Preflight a candidate before any run. This is the same predicate as G5, applied to both texts:
  `node -e 'const t=require("fs").readFileSync(0,"utf8");const m=[...t.matchAll(/\p{N}+/gu)].map(x=>[x.index,x[0]]);console.log(m.length?m:"digit-free")' < excerpt.txt`

## 3. Proposal: `RI001-DRAFT-RISK-2.0-QP` — v0.2 (supersedes v0.1 §3 at `7e5ee75`)

### 3.0 What changed v0.1 → v0.2 (contract reconciliation, Main adjudication 2026-11-22)

- **v0.1 contradiction, accepted.** v0.1 said G1–G4 and G6–G11 stay "exactly as they are" while
  replacing G9. It also expected an MSFT earnings PASS. That positive is impossible under the
  RISK-1.1 rules:
  - G3 holds a `material` financial-figures disposition;
  - G7 holds `materialRisk:true` and any event that is not `added_detail`;
  - G8 holds the honest `earnings` content type.

  v0.1 was therefore internally inconsistent. Do not sign it off.
- **What v0.2 does.** It defines tier-specific semantics for **G3, G5, G7, G8 and G9 only** (§3.2,
  §3.3), backed by new mandatory gates S, N and R (§3.5–§3.7). Every other gate is unchanged
  (§3.1 matrix).
- **The core separation (§3.2).**
  - *Material financial fact*: an honest property of the content, for example quarterly segment
    revenue.
  - *Unresolved risk*: unsupported, uncertain, contradictory, forward-looking, or a binding
    defect.

  The first may proceed to PASS only through verified bindings plus a critic attestation. The
  second stays HOLD or FAIL in every tier.
- **A critic never repairs facts.** Every fact, binding and source gate is evaluated
  independently. A critic signature can only *add* HOLD or FAIL. It can never turn another gate's
  HOLD into PASS.
- **Honest classification is mandatory.** Earnings stay `contentTypes:["earnings"]` and
  `materialRisk:true`. A periodic release stays `new_event`. Trimming, reclassifying or removing
  digits to obtain PASS is itself a FAIL condition (§3.8, T-N5).

### 3.1 Old → New gate matrix

| Gate | RISK-1.1 (unchanged default; also C1) | 2.0-QP (opt-in instance policy) | Kind |
|---|---|---|---|
| G1 Binding | Exact envelope, scope, policy stamp | Same; stamp `RI001-DRAFT-RISK-2.0-QP`. Scope inventory adds the S/N/R artefact digests. | invariant (extended) |
| G2 Coverage | All six dimensions, all scope keys | Same | invariant |
| G3 Disposition | Any non-`absent` disposition is HOLD (`unsupported` FAIL) | Per-dimension table §3.2. Only `financial_figures_forecasts` may carry a new `material_primary_actual` disposition. Every other non-`absent` value stays HOLD/FAIL. | **changed, bounded** |
| G4 Dual basis | Source span plus receipt-bound native history span | Same. A legacy note without a native C1 receipt can never be history (row E). | invariant |
| G5 Digits | Any `\p{N}` is HOLD | Every digit run in exactly one sealed token class (N1–N4, §3.6). An unclassified digit is HOLD. | **changed** |
| G6 Broker | HOLD | HOLD | invariant |
| G7 Event / materialRisk | HOLD if `materialRisk` or the event is not `added_detail` | `materialRisk:true` allowed **only** when every material item is a `material_primary_actual`. Events: `added_detail` and `new_event` allowed (the latter only for a primary periodic release, §3.2). `duplicate` stays HOLD. `correction`/`contradiction`/`unresolved` stay HOLD. | **changed, bounded** |
| G8 Declared material scope | HOLD on earnings, guidance, broker_*, portfolio_snapshot, guidance/estimate claim classes, unresolved claims, supplier/customer, more than one competing value | `earnings` (historical actuals) and a new `official_statistics` content type become eligible. **Everything else in G8 stays HOLD unchanged**: guidance, broker_*, portfolio_snapshot, management_guidance, analyst_estimate, unresolved, supplier/customer, competing values. | **changed, bounded** |
| G9 Critic | Always HOLD when required (no verifiable critic) | Required for **every** QP-eligible material item. Satisfied only by an R3 attestation that is valid, authorized and PASS on all dimensions (§3.7). Any other critic state is HOLD; a critic FAIL is FAIL. | **changed** |
| G10 Context | issuer hub, PIT, PDF/mixed/screenshot, typed Review, history, retrieval | Same. PDF still HOLD (no canonicalizer). | invariant |
| G11 Promotion | Never `verified_primary` | Same. A QP PASS never promotes. | invariant |
| C1 reviewer | Dashboard attestation, cannot override | Same, and *additional*. It never substitutes for R2 or R3. | invariant |
| S, N, R (new) | — | Mandatory for any QP eligibility (§3.5–§3.7) | new |

### 3.2 Exact tier semantics for G3 / G7 / G8 / G9

**G3, per risk dimension, under 2.0-QP:**

| Dimension | `absent` | `material` | `material_primary_actual` (new) | `uncertain` | `unsupported` |
|---|---|---|---|---|---|
| financial_figures_forecasts | pass | HOLD | eligible **iff** every material financial item is an N1 claim with a valid R2 receipt, is a historical actual (not a forecast or guidance), and has no derived arithmetic | HOLD | FAIL |
| valuation_thesis_mechanism | pass | HOLD (thesis/valuation implications stay outside Draft authority) | not allowed (FAIL as schema misuse) | HOLD | FAIL |
| material_relationships | pass | HOLD | not allowed | HOLD | FAIL |
| correction_contradiction_vintage | pass | HOLD | not allowed | HOLD | FAIL |
| unsupported_or_unresolved_assertions | pass | HOLD | not allowed | HOLD | FAIL |
| protected_authority | pass | HOLD | not allowed | HOLD | FAIL |

**G7, event and materialRisk:**

| Classification | Condition | 2.0-QP result |
|---|---|---|
| `added_detail` | any | eligible (other gates apply) |
| `new_event` | Source is a primary periodic release: issuer 10-Q/10-K/earnings EX-99.1, or an official statistical release; `published_at` bound (S3); not a restructuring/M&A/guidance announcement | eligible |
| `new_event` | anything else | HOLD |
| `duplicate` | — | HOLD for Review, unchanged (existing dedup; no new Review) |
| `correction` / `contradiction` / `unresolved` | — | HOLD (invariant) |

`materialRisk:true` with *only* `material_primary_actual` material items is eligible. With any
other material item it is HOLD.

**G8:** eligible content types are `earnings` (historical actuals only) and `official_statistics`
(new). Every other G8 trigger is unchanged and HOLDs:

- content types guidance, broker_rating, broker_price_target, broker_estimate, portfolio_snapshot;
- claim classes management_guidance and analyst_estimate;
- an unresolved claim assessment;
- supplier/customer roles;
- more than one competing value.

**G9, critic:** `criticRequired` is computed exactly as in RISK-1.1. Under QP it is satisfied
**only** if all of these hold:

- R3 is present and its signature is valid;
- it binds this envelope, result and scope digest;
- it is unexpired and unconsumed;
- the critic principal is authorized for this source family and is distinct from the actor and
  from the R2 principals;
- every dimension verdict is PASS.

Otherwise the result is HOLD, and a critic FAIL is FAIL. Evaluation order is fixed:
**source (S) → token and claim binding (N) → receipts (R2) → G1–G8 and G10–G11 → critic (R3)**.
The result is the most restrictive outcome across all steps.

### 3.3 Decision table (required cases)

| Case | Example | 2.0-QP outcome | Why |
|---|---|---|---|
| **A** Official primary historical actuals, consolidated or segment, complete provenance | MSFT FY27Q1 10-Q segment revenue and operating income (USD millions, three months ended 2026-09-30, recast two-segment basis as the issuer presents it) | **PASS-eligible Draft.** Requires: S1–S6; N1 table binding per value (§3.5); R2 per material value; R3 PASS; `new_event` periodic release; Review restates values verbatim with unit and period. | Material fact, fully bound; no unresolved risk |
| **B** Issuer guidance or forecast | "expects next-quarter revenue of …" | **HOLD** (G8 guidance invariant). Source saved. | Forward-looking; outside the actuals tier |
| **C1** Unit, period or GAAP mismatch with the signed scope | Review states a non-GAAP figure as GAAP, or a value under the wrong period | **FAIL** (`claim_scope_mismatch`). Binding contradicts R2. | Falsified binding |
| **C2** Comparison across bases not recast by the issuer | Old three-segment FY26 value compared with a new two-segment FY27 value | **HOLD** (`recast_basis_comparison_unsupported`) | No issuer-published comparable |
| **C3** Derived arithmetic | Growth %, margin or sum computed by the analyst | **HOLD** (`derived_value_not_supported_v2_0`) | Only issuer- or agency-published figures |
| **D1** Official BLS published figure | A CPI-U index level or percent change for a published reference month, with SA/NSA, series id and release vintage | **PASS-eligible.** Same requirements as A, with `official_statistics`. | Official actual, fully bound |
| **D2** BLS methodology about the missing October 2025 data | Explaining that BLS did not collect October 2025 prices and used approximations for seasonal-factor computation | **Methodology Draft eligible** only with N2/N4 tokens (method name, reference-period label) and no N1 value for October 2025. Any October 2025 index level or rate, or any interpolated figure presented as official, is **FAIL** (`no_official_value_for_period`). | Never invent or imply an official CPI level |
| **E** Old legacy Source without a native C1 history receipt | MSFT FY26Q4 Vault note with `source_sha256: null` | **HOLD** (G4 invariant). History must be a canonical intake receipted in the same instance. | Cannot prove prior known-at |

### 3.4 Source validation (S, all mandatory)

- **S1** Original bytes in the content-addressed archive: approved origin, exact host, HTTPS, no
  redirects, permitted content type, size cap, archive fetcher network isolation. The packet binds
  `snapshotId`, raw `sha256`, URL, and the issuer/agency document identity (accession number or
  release id plus series id).
- **S2** A source-rights record per origin, covering terms of use and retention. **An allowlist
  entry is not a rights approval.** Adding `www.bls.gov` or issuer hosts is a separate Owner
  action; nothing is changed by this proposal.
- **S3** Dates are separate, bound fields: `published_at` (document), `period` (claim),
  `known_at` (server capture) and `event`. A "last modified" date is never an event date.
- **S4** PDF, mixed and screenshot formats remain HOLD (G10).
- **S5** The received text (what the model saw) must equal the canonical section text (§3.5) for
  every cited span; otherwise HOLD.
- **S6** Section completeness: the packet carries the **whole** canonical section or table that
  contains each claim, including headings, unit-scale line and column headers. It is never a
  caller-chosen excerpt. The critic attests that it reviewed that whole range.

### 3.5 Claim and table binding (N1 requirements)

Literal substring presence in raw bytes is **not** sufficient: a number may appear in the wrong
row, period or basis. Each N1 value binds to:

- **Canonical Evidence Representation (CER).** A pinned, deterministic canonicalizer
  (`canonicalizerVersion`) converts archived HTML into a hashed text and table model (`cerSha256`):
  - HTML entities decoded;
  - whitespace normalized;
  - NFC;
  - **digits, signs, parentheses, separators and currency symbols preserved literally**;
  - no numeric conversion.
- **Table path.**
  - `tableId`, plus the full row header path (for example segment → line item);
  - the column header path, i.e. the period (for example "Three Months Ended September 30, 2026");
  - `scaleLabel`, the unit scale in force for the cell, such as "(In millions, except per share
    amounts)";
  - `basisLabel` (GAAP / non-GAAP / as recast);
  - the cell text.
- **Dual spans.** Each of these has two spans: one in the CER (`cerSpan`) and the original raw
  byte offsets in the archived document (`rawSpan`): the cell, every header in its path, and the
  scale line.
- **Claim dimensions** must equal the R2-signed scope exactly: `entity`, `metric`, `period`,
  `unit` (including scale), `accountingBasis` (standard, scope, recast flag, definition); for
  statistics also SA/NSA, series id, base period and vintage.
- **No clipping, rounding or rescaling** (`claim-value-anchor` semantics). The Review restates the
  cell value verbatim with its scale and period label.

### 3.6 Numeric token classes (G5 under QP)

Every `\p{N}` run in the received text, the proposed Review and the claims belongs to exactly one
class:

- **N1** a claim value (§3.5).
- **N2** a document or method identifier, declared as a typed span that is an exact CER literal:
  form type, accession number, series id, method name, ticker.
- **N3** a document date equal to a bound S3 field.
- **N4** a reference-period label equal to a bound claim period, or a declared methodology period
  (row D2).

An unclassified digit is HOLD. A digit in Review prose that is not a verbatim N1–N4 restatement is
HOLD.

### 3.7 Reviewer and critic authority (R)

- **R1 Actor.** Unchanged: the OAuth access label. It is not a human or model identity.
- **R2 Primary receipt.** M551 extended with the §3.5 binding fields (`canonicalizerVersion`,
  `cerSha256`, `tableId`, header paths, `scaleLabel`, `basisLabel`, `cerSpan`, `rawSpan`):
  - two out-of-band Ed25519 signatures, reviewer and approver;
  - competing values adjudicated (more than one remains HOLD in v2.0).
- **R3 Critic attestation.** A new signed object over the envelope digest, result digest, scope
  digest and the reviewed section range, with per-dimension verdicts and references. Expiry no
  later than the packet's. Single-use at the apply critical section.
- **Authority is not keys.** The signer registry (out of band, public keys only) records for each
  key:
  - a principal id;
  - its role (reviewer / approver / critic);
  - an Owner-signed appointment with scope (source families and metrics);
  - effective and revocation dates;
  - an identity-verification statement.

  Rules:
  - R2 needs two distinct **principals**, and R3 needs a third distinct principal. None may equal
    the analyst actor's principal.
  - **Distinct keys prove distinct keys only.** They do not prove distinct humans, literacy,
    authorization or absence of collusion. These facts are attested outside the server and
    recorded as `criticIndependence:"key_attested_out_of_band"` and
    `humanPresence:"not_verified"`. Neither label is `verified_human`.
  - No MCP route creates or approves R2 or R3. A user-supplied, self-issued or copied receipt or
    critic attestation is invalid.
  - A QP PASS never grants Verified Primary.

### 3.8 Test matrix (written before any implementation; fixtures synthetic or archived-public, no live writes)

**Every RISK-1.1 test stays unchanged and green.** A 1.1 instance given QP artefacts still holds.

| ID | Scenario | Expected |
|---|---|---|
| T-A1 | Honest MSFT-style segment actuals: earnings content type, `materialRisk:true`, `new_event` periodic release, full section CER, N1 per value, R2 + R3 PASS | **PASS** Draft with restrictive labels; Source + Review receipts; resolved link |
| T-A2 | Same as T-A1 for a consolidated total and a per-share value (scale "except per share") | PASS; per-share unit bound separately |
| T-D1 | BLS CPI index level, SA, series id, vintage, R2 + R3 | PASS |
| T-D2 | Methodology Draft on the missing October 2025 data with N2/N4 only | PASS-eligible methodology Draft |
| T-D3 | T-D2 plus an "October 2025 CPI" value or an interpolated level | FAIL `no_official_value_for_period` |
| T-B1 | Guidance sentence or `guidance` content type | HOLD; Source saved |
| T-B2 | Broker or consensus estimate | HOLD |
| T-C1 | Value bound to the wrong column period, a non-GAAP value labelled GAAP, a scale mismatch, or a cell taken from the wrong row with an identical literal elsewhere | FAIL `claim_scope_mismatch` |
| T-C2 | Old-basis vs recast-basis comparison | HOLD |
| T-C3 | Derived growth % or margin | HOLD |
| T-E1 | Legacy Vault note used as history | HOLD (G4) |
| T-S1 | Host not approved, redirect, oversize, disallowed type, PDF | HOLD |
| T-S2 | Received span not equal to CER; caller excerpt instead of whole section; header or scale line missing | HOLD |
| T-S3 | HTML entity or format variants (`&nbsp;`, `&#8722;`, parenthesized negatives, thin spaces) | Canonicalizer is deterministic and literal-preserving; parenthesized values are never converted to a sign |
| T-N1 | Unclassified digit in the Review; a digit-bearing identifier declared as N1 | HOLD / FAIL |
| T-N5 | Honest earnings relabelled `added_detail`, `materialRisk:false`, digits removed or a paraphrase made digit-free to avoid gates | FAIL `classification_or_fidelity_manipulation` (the critic must flag it; mismatch with the CER section) |
| T-R1 | R2 missing, scope mismatch, one signature, or same principal twice | HOLD |
| T-R2 | R3 missing, expired, replayed, wrong envelope, unauthorized principal, principal equal to the actor or to an R2 principal, or self-issued | HOLD |
| T-R3 | R3 HOLD on any dimension / R3 FAIL | HOLD / FAIL |
| T-R4 | R3 PASS but N1 binding fails (the critic cannot repair facts) | HOLD/FAIL from N, not PASS |
| T-G3 | `material_primary_actual` used on a non-financial dimension | FAIL (schema misuse) |
| T-G7 | `new_event` that is not a periodic release (restructuring announcement); correction or contradiction | HOLD |
| T-V1 | Old binary or RISK-1.1 instance reading a QP gate | fail closed |
| T-I1 | Invariants: protected bytes unchanged; immutable Source; receipts and resolved links cold-verified; no `verified_primary`; maintenance refusal; C1 no Git/Prices ingress | unchanged |

### 3.9 Remaining risks after v0.2 (for the independent reviewers)

1. **Canonicalizer correctness.** It is new code on a trust path. It needs its own review,
   fuzzing and fixed versions. A wrong canonicalization defeats S5 and S6.
2. **Critic quality.** A signature proves a key acted, not that the review was competent.
   Mitigations are the "critic can only add HOLD" rule and fact gates evaluated first. A
   competent-but-wrong critic remains a residual risk.
3. **Signer governance.** Principal identity, appointment and revocation live outside the
   single-admin server. Collusion between principals cannot be excluded technically.
4. **Periodic-release `new_event` boundary.** A filing can also contain restructuring or M&A text.
   Those claims must be held, while actuals may still pass. This needs per-claim classification
   tests.
5. **Recast and restatement.** A later issuer restatement creates a new vintage. The old Draft
   stays historical. Detection relies on new receipts, not on automatic tracking.
6. **Legal rights and retention** per origin are Owner/legal decisions (S2), not engineering ones.
7. **Scope creep.** Derived arithmetic, competing values, PDF and guidance all remain HOLD in
   v2.0. Any extension needs a new version and a new review.

### 3.10 Compatibility, migration and rollout (unchanged in intent from v0.1)

- New stamp and Judge protocol increment invalidate pending RISK-1.1 gates restrictively.
- Opt-in per instance. The default **and C1 stay at RISK-1.1**.
- New frontmatter labels only: `risk_policy`, `critic_attestation_id`, `primary_receipts`,
  `cer_sha256`.

Rollout gates (none approved):
1. Independent security and source/research review of **v0.2**.
2. Owner decision to implement exactly this restricted tier.
3. Separate Owner action on source rights and allowlist.
4. Separate out-of-band key ceremony and signer governance (WORK).
5. Isolated implementation with the §3.8 tests first.
6. Exact-tree CI.
7. Independent delta review.
8. Separate isolated real-source E2E grant.

Full L1 SECURITY HOLD (ADR-D1-GIT-01) is independent and still applies before any release.
