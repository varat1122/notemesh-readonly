# RI001-DRAFT-RISK-2.0-QP — proposal for quantitative PRIMARY research (DESIGN ONLY) — v0.4

**Status: PROPOSAL v0.4 / NOT IMPLEMENTED / NOT APPROVED / RISK2_DESIGN_HOLD.** v0.4 addresses
the Research CHAT semantic peer review of v0.3, F01–F06 as adjudicated by Main (see §3.0). That peer
review is an AI semantic assessment; this revision is not an independent security review or a Gold
approval. Earlier versions: v0.1 `7e5ee75`, v0.2 `6bfd5c7`, v0.3 `98b6989`. §1 and §2 are
unchanged. This document does not change
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

## 3. Proposal: `RI001-DRAFT-RISK-2.0-QP` — v0.4 (amends v0.3 §3 at `98b6989`)

### 3.0 Change log

- **v0.1 → v0.2.** Reconciled the G3/G7/G8/G9 contradiction: bounded tier semantics, and a critic
  that can only add HOLD/FAIL. v0.1 is at `7e5ee75`, v0.2 at `6bfd5c7`.
- **v0.3 → v0.4.** Addresses the Research CHAT semantic peer review of v0.3 (F01–F06) as adjudicated
  by Main. Every v0.3 rule not named in the table below is unchanged.

| Finding (v0.3) | v0.4 change | Section |
|---|---|---|
| **F01** T-P2 claimed wrong-subject attribution was "impossible by construction" (overclaim) | **Retracted.** Numeric/accounting binding is now separate from sentence-level semantic attribution. Three sentence kinds: `fact_template` (server-rendered, mechanically certifiable), `source_quote` (verbatim span, certifiable as quotation only), `analyst_interpretation` (free prose, **critic-dependent**, never mechanically certified). Value placeholders are allowed **only** in `fact_template`. New adversarial tests cover wrong subject, segment, period-in-prose, negation and causality, each with a negligent-critic variant. | §3.6, §3.8 T-P2a–f, RR-9 |
| **F02** S6 proves integrity, not material coverage | New **material coverage** rule. The server enumerates every block of the mandatory coverage set; every block must be classified; every counter, risk or guidance block must be addressed, otherwise HOLD. Mixed documents go Source-only when an honest split would mislead. R3 adds a `coverage_completeness` dimension. | §3.6a, §3.3 F, §3.8 T-CV |
| **F03** G4 treated an agency match as same-series; first-ever disclosure | G4 now distinguishes **`same_series_history`** (comparable: same issuer + metric/segment basis, or the same agency series id, with compatible schema and vintage) from **`cross_series_context`** (context only). Bootstrap dates are kept distinct. A possible first-event factual route is an **Owner decision**, not added scope. | §3.2 G4, §3.11 |
| **F04** No real-document test of mixed content | New real-primary test set, MSFT FY27Q1, to be sealed by the source custodian. It mixes actuals, outlook/forward-looking text and adverse context, and expects HOLD or Source-only where coverage cannot be preserved. | §3.8 T-RP |
| **F05** Signatures ≠ qualified judgment | Four assurance levels are distinguished; labels updated; qualification is left to the Owner. | §3.7a, §3.11 |
| **F06** Registry rollback with restored storage; rotation, revocation, recovery | Threat model and *options* only; nothing is chosen. **SECURITY DESIGN HOLD** remains. | §3.7b, §3.11 |
- **v0.2 → v0.3.** Resolves the author's internal adversarial self-review of v0.2: six Confirmed
  Defects (CD) and eight Design Gaps (DG). **That self-review is not an independent review.**

| Finding (v0.2) | v0.3 resolution | Section |
|---|---|---|
| CD-1: S6 whole section vs "every digit in received text classified" | Token classes apply only to **asserted** text: Review, claims, relationships. Received/section digits are bound by S1/S5/S6 hashes. | §3.6 |
| CD-2: S6 vs the `extractedText` cap of 12,000 characters | QP Source text is **derived by the server** from the archived snapshot and section id, under its own bound. Oversize means HOLD, never truncation. | §3.4 |
| CD-3: new `official_statistics` breaks the strict enum | **Removed.** Use the existing `macro_data`/`reported_fact`/`earnings` and the existing source kinds. | §3.1, §3.2 |
| CD-4: critic label collides with `draftMetadata.critic_independence` | `critic_independence: "not_verified"` stays **unchanged**. New separate keys `qp_*`. | §3.10 |
| CD-5: no root of trust for signers | Owner-signed registry, root fingerprint pinned in source, verified at boot, monotonic version. QP stays disabled without it. | §3.7 |
| CD-6: "critic ≠ actor" across namespaces is uncheckable | Registry principals declare their OAuth subjects. Overlaps are rejected. Labelled as attestation (residual). | §3.7 |
| DG-1: G3 for official statistics ambiguous | `material_primary_actual` is defined to cover issuer financial actuals **and** official statistical measurements. D2 methodology is a G5-only relaxation. | §3.2, §3.3 |
| DG-2: privileged classification is caller-controlled | **Sentence-bound Review** plus per-claim and per-sentence classes, all inside the R3-signed scope. R3 has a `classification_fidelity` dimension. | §3.6, §3.7 |
| DG-3: numeric misattribution in prose | **No raw digits in authored prose.** All digit-bearing tokens are server-rendered from bound placeholders. | §3.6 |
| DG-4: CER spec incomplete | Full CER spec: server recomputation, hidden content, footnotes, spans, scale scopes, Unicode rules, iXBRL fact binding, differential fuzzing. | §3.5 |
| DG-5: G4 relevance not checked | QP history must be a native intake with its own S1 snapshot, the same issuer or series, and an attested earlier publication. Bootstrap procedure stated; first-ever disclosures HOLD by design. | §3.2 G4 |
| DG-6: one event per packet | Classification per claim and per sentence. Vintage is part of the claim key. | §3.6 |
| DG-7: "C1/default stay 1.1" only documented | `qpEnabled()` fail-closed predicate is required in code. | §3.10 |
| DG-8: capacity limits unstated | At most 8 asserted values. References and quotes bounded. Overflow is HOLD, never silent truncation. | §3.6 |

**Unchanged from v0.2:**
- Honest classification is mandatory; manipulation is FAIL.
- A critic never repairs facts.
- Fixed evaluation order.
- Material financial *facts* are separated from unresolved *risk*.
- Guidance, broker, consensus, derived arithmetic, recast comparisons, PDF, PIT and competing
  values all remain HOLD.

### 3.1 Old → New gate matrix

| Gate | RISK-1.1 (default and C1, unchanged) | 2.0-QP (opt-in, `qpEnabled()` only) | Kind |
|---|---|---|---|
| G1 Binding | Envelope, scope inventory, policy stamp | Same; stamp `RI001-DRAFT-RISK-2.0-QP`. The inventory adds snapshot, CER, section, claim, sentence, R2 and R3 digests and the registry version. | invariant (extended) |
| G2 Coverage | All six dimensions, all keys | Same, plus every Review sentence and every claim has a class (§3.6) | invariant (extended) |
| G3 Disposition | Non-`absent` is HOLD; `unsupported` FAIL | §3.2. Only `financial_figures_forecasts` may use `material_primary_actual`, covering issuer financial actuals and official statistical measurements. | **changed, bounded** |
| G4 Dual basis | Source span plus receipt-bound native history span | Same, **plus** a QP history qualification (§3.2) | invariant (tightened) |
| G5 Digits | Any `\p{N}` anywhere is HOLD | Received/section digits are bound by S1/S5/S6. **Authored text has no raw digits at all**: the Review prose, claim statements and relationship text. Every digit-bearing token in them is a server-rendered placeholder (§3.6). | **changed** |
| G6 Broker | HOLD | HOLD | invariant |
| G7 Event / materialRisk | HOLD unless `added_detail`; `materialRisk` HOLD | §3.2. `new_event` only for a primary periodic release, and only if **every** claim and sentence class is admissible. | **changed, bounded** |
| G8 Declared material | HOLD on the listed types and classes | Existing enum only: `earnings` / `reported_fact` / `macro_data` are eligible when every claim class is `historical_actual`. Everything else in G8 is unchanged and HOLDs. **No new enum value.** | **changed, bounded** |
| G9 Critic | Unsatisfiable, therefore HOLD | Satisfied only by a valid R3 from a registry-authorized principal, PASS on all dimensions **including `classification_fidelity`**, and (v0.4) `semantic_entailment` and `coverage_completeness` (§3.7, §3.6a) | **changed** |
| G10 Context | issuer hub, PIT, PDF, typed Review, history, retrieval | Same. QP additionally requires a valid S1 snapshot and a CER section. | invariant (extended) |
| G11 Promotion | Never `verified_primary` | Same | invariant |
| C1 reviewer | Dashboard attestation, cannot override | Same; QP itself is **disabled in C1** (§3.10) | invariant |
| S / N / R / registry | — | Mandatory (§3.4–§3.7) | new |

Fixed evaluation order:
**registry → S → N (CER, claims, sentences, placeholders) → R2 → G1–G8, G10, G11 → R3 critic**.
The result is the most restrictive outcome. A critic can only add HOLD or FAIL.

### 3.2 Tier semantics for G3 / G4 / G7 / G8 / G9

**G3.** `material_primary_actual` is allowed on `financial_figures_forecasts` only. Under QP that
dimension is defined to cover issuer-reported historical financial actuals and official
statistical measurements, such as an index level or published rate. It is eligible **iff**:

- every material quantitative assertion is an N1 claim with class `historical_actual`;
- each such claim has a valid R2;
- there is no derived arithmetic and no forecast.

All other dimensions keep the v0.2 table: `material`/`uncertain` HOLD, `unsupported` FAIL, and
`material_primary_actual` used elsewhere is a schema-misuse FAIL. Classification of the dimension
is attested by R3 `classification_fidelity`.

**G4 under QP (v0.4: same-series vs cross-series).** Every QP history item is a native Source intake
receipted in this instance, with its own S1 snapshot (v0.3 (a) and (b)). Each item is then
classified, and the classification is part of the R3-signed scope:

- **`same_series_history`** (comparable). All of:
  - **issuer:** the same exact issuer resolution **and** the same metric definition, segment basis
    and accounting basis;
  - **macro:** the **same agency series id**, the same SA/NSA, a compatible base period, and a
    declared vintage relation;
  - an attested `published_at` earlier than the new Source's;
  - for a recast segment basis: either the issuer published recast comparatives, or the item is
    not same-series.
  - **An agency match alone is not same-series.** For example, BLS CPI and BLS Employment
    Situation are not comparable.
- **`cross_series_context`**: anything else related, such as the same issuer with a different
  metric or pre-recast basis, the same agency with a different series, or the same industry.
  - It may only be referenced by `source_quote` or `analyst_interpretation` sentences
    (critic-dependent).
  - It never satisfies the comparative-history requirement and never supports a comparison or
    trend statement.

**G4 rule.** Every finding still needs a receipt-bound history span (unchanged from RISK-1.1), and
**every comparative or trend statement** requires `same_series_history`. With only
`cross_series_context`, the Draft may contain no comparative statement; if a finding needs a
comparison, the result is HOLD.

**Bootstrap (truthful dates).** Capture the prior-period primary document first (`captureOnly`,
archived). The three dates stay separate:
- `known_at` is the real server capture time, i.e. *now*;
- `published_at` is the attested historical publication date;
- the Source receipt is issued now.

The prior document is "earlier published", **not** "earlier known". Never backdate, never use
legacy Vault notes, never present a recently captured document as contemporaneous knowledge.

**First-ever disclosure** (IPO, a new series, a first-time segment with no `same_series_history`):
**HOLD under QP v2.0 by design**. Any separate primary-only first-event factual route is an **Owner
decision** (§3.11) and is not part of this proposal's scope.

**G7.** As v0.2, with one change: `new_event` is admissible only for a primary periodic release
(issuer 10-Q/10-K/earnings EX-99.1; an official statistical release) **and only when every claim
and sentence class is admissible** (§3.6). Any `guidance_forecast`, `restructuring_mna`,
`restatement_recast`, `other_material` or `unclassified` item HOLDs the **whole** Draft. The Source
is preserved.

**G8.** Uses the existing strict enum:
- `earnings`, `reported_fact` and `macro_data` are QP-eligible when every claim class is
  `historical_actual`.
- `guidance`, `broker_*`, `portfolio_snapshot`, `analyst_opinion`, `market_commentary`, the claim
  classes `management_guidance`/`analyst_estimate`, an unresolved assessment, supplier/customer
  roles and more than one competing value all HOLD (unchanged).
- Source kinds: `regulatory_filing` / `issuer_release` (MICRO) and `official_macro` (MACRO).

**G9.** `criticRequired` is computed as in RISK-1.1. Under QP it is satisfied only per §3.7.

### 3.3 Decision table

| Case | 2.0-QP outcome |
|---|---|
| **A** Primary historical actuals (MSFT FY27Q1 segment revenue/op. income, as presented) | **PASS-eligible** when all of these hold: S1–S7; CER + iXBRL-bound N1 per asserted value; **values only in `fact_template` sentences**; every other sentence is `source_quote` or `analyst_interpretation`; **material coverage (§3.6a) satisfied with no unaddressed counter/risk/guidance block**; R2 per value; R3 PASS on all dimensions, including `classification_fidelity`, `semantic_entailment` and `coverage_completeness`; G4 `same_series_history` for any comparison. Interpretation remains critic-dependent (RR-9). |
| **B** Guidance or forecast, with or without digits | **HOLD.** A `guidance_forecast` sentence or claim class HOLDs the whole Draft; the Source is saved. |
| **C1** Value bound to the wrong row, column, period, basis, sign or scale relative to the CER/iXBRL fact or R2 scope | **FAIL** `claim_scope_mismatch` |
| **C2** Old-basis vs recast comparison not published by the issuer | **HOLD** |
| **C3** Derived arithmetic | **HOLD** (no placeholder exists for computed values) |
| **D1** Official BLS published measurement (`macro_data`, `official_macro`; series id, reference period, SA/NSA, base, vintage) | **PASS-eligible** under the same requirements as A |
| **D2** BLS methodology (missing October 2025 data handling) | Eligible as a **G5-only** relaxation: identifier and period placeholders only, no N1, G3 all `absent`, class `methodology`/`context`. Any October 2025 level or rate, or any interpolated figure presented as official, is **FAIL** `no_official_value_for_period`. |
| **E** Legacy note or unreceipted history | **HOLD** (G4) |
| **F** A filing mixing actuals with M&A, restructuring, guidance or outlook text | If **any guidance/outlook, restructuring/M&A or restatement block lies inside the mandatory coverage set** (§3.6a), the result is **HOLD and Source-only**: an actuals-only Draft would omit material context, and guidance stays out of scope. An honest split into a separate Draft is allowed **only** when the mandatory coverage set of the actuals Draft contains no such block, and R3 `coverage_completeness` attests that. Removing risk or outlook sentences from the Source and calling the rest complete is **FAIL** (S5/S6 mismatch). |
| **G** Cross-series context only (for example BLS CPI history used for an Employment Situation claim) | No comparative statement is allowed. A comparison or trend claim is HOLD. Context is allowed only via `source_quote` or `analyst_interpretation`. |

### 3.4 Source validation (S)

- **S1** Archive snapshot of the original bytes. Unchanged from v0.2: exact approved host, HTTPS,
  no redirect, permitted content type, size cap, isolated fetcher network.
- **S2** Source-rights record per origin; **an allowlist entry is not a rights approval**. Owner
  action, separate.
- **S3** Separate fields `published_at` / `period` / `known_at` / `event`. Under QP,
  `published_at` is **attested in R2**, not caller-declared.
- **S4** PDF, mixed and screenshot formats HOLD.
- **S5 (changed)** The QP Source text is the server-derived CER text of
  `{snapshotId, sectionId}`. A caller `extractedText` is not used for QP. The model sees the server
  text.
- **S6 (changed)** The section is the whole CER section/table containing every asserted value: its
  headings, scale lines, column headers and footnotes.
  - Bound: `QP_SECTION_MAX_CHARS`, proposed 100,000 characters, below the 250,000 packet limit.
  - An oversize section is **HOLD** (`qp_section_too_large`), never truncated.
  - The packet binds `cerSha256`, `sectionId`, `sectionSpan` and `sectionSha256`.
- **S7 (new)** The archive fetch remains an MCP-tracked tool execution under the maintenance
  fence (`assertMutationAllowed`). See RR-4 for its graceful-drain semantics.

### 3.5 CER and claim binding (N1)

**Canonicalizer**, `canonicalizerVersion` pinned:

- The **server recomputes** the CER from the archived bytes on every evaluation. No caller-supplied
  CER is accepted.
- Deterministic HTML → `{text, tables[], spans}`:
  - entities decoded through a pinned table;
  - whitespace normalized; NFC;
  - **digits, signs, parentheses, separators and currency symbols kept literally**;
  - no numeric conversion.
- **Excluded and non-citable:** `script`, `style`, comments, `display:none`/`hidden`/`aria-hidden`
  elements, `ix:hidden`, `ix:header`.
- **Tables:** rowspan/colspan expanded into a cell grid; row header paths and column header paths
  computed.
- **Footnotes:** `<sup>` and footnote markers are separate tokens and are **never** part of a cell
  value.
- **Scale:** the signer **declares** the per-row `scaleLabel` (for example "In millions, except per
  share amounts"). The canonicalizer only verifies that the label is a literal within the section.
- **Values HOLD** if a value span contains non-ASCII digits, mixed-script digits, bidi controls or
  zero-width characters (`qp_value_unicode_hold`).
- **Dual spans:** every cell, header, scale line and footnote has a `cerSpan` and the original raw
  byte `rawSpan`. The mapping is recomputed server-side and is monotonic.
- **Assurance:** differential testing against a second, independent HTML parser, plus fuzzing, is
  required before any sign-off.

**SEC iXBRL binding** (mandatory when the archived filing is inline XBRL): each N1 binds an
`ix:nonFraction` fact with:

- `name` (concept);
- `contextRef`, resolved to period and axis/member (for example segment);
- `unitRef`, `scale`, `decimals`, `sign`.

The displayed literal, the declared scale and sign, the period and the dimension members must all
agree with the fact; otherwise **FAIL** `claim_scope_mismatch`. A filing without the expected
iXBRL fact is HOLD.

**Official statistics binding:** agency, series id, reference period, SA/NSA, base (for example
`1982-84=100` as a unit literal), release vintage and table cell spans.

**Claim dimensions** equal the R2-signed scope exactly: entity, metric, period, unit+scale,
`accountingBasis` (standard/scope/recast flag/definition) and vintage. Literal anchoring is as in
`claim-value-anchor`: no clipping, rounding or rescaling.

### 3.6 Asserted-text rules (replaces G5 for authored text)

- **Structured QP Review.** Each Review field is an array of sentences `{kind, text, class, refs[]}`.
  - Every sentence must have one to four refs: an exact CER span or a claim key. An unreferenced
    sentence is HOLD.
  - Classes: `historical_actual`, `methodology`, `context`, `guidance_forecast`,
    `restructuring_mna`, `restatement_recast`, `other_material`. Only `historical_actual`,
    `methodology` and `context` are admissible.
- **Sentence kinds (v0.4, F01).** *Numeric/accounting binding* and *semantic attribution* are
  separate properties.

  | Kind | Content | What is mechanically certifiable | What is not |
  |---|---|---|---|
  | `fact_template` | **Entirely server-rendered** from one signed claim: "{entity} — {segment/series} — {metric}, {period}: {value} {unit+scale} ({basis}, {vintage}); source {document id}". No caller text. | Numeric value, unit, scale, period, basis, **and subject** (entity/segment/series/metric come only from the R2-signed claim) | Economic significance |
  | `source_quote` | A verbatim CER span rendered as an attributed quotation ("The issuer states: …"), with no caller text inside the quote | That the words are the issuer's or agency's exact words at that span | Truth of the quoted statement; whether the quote is representative (that falls under §3.6a coverage) |
  | `analyst_interpretation` | Free prose. **No digits, no value/period placeholders.** It must reference at least one claim key or span. | Nothing beyond reference existence and the no-digit rule | **Subject, segment, negation, causality and implication are critic-dependent** (R3 `semantic_entailment`). Never described as deterministically correct. |

- **Fail-closed rules.**
  - A `{{value:…}}` or `{{period:…}}` placeholder outside a `fact_template` is **HOLD**. Example:
    "Segment B benefited from revenue {{value:claim_A}}" is impossible to submit.
  - An `analyst_interpretation` sentence that references a claim of a **different subject** than
    any subject it names cannot be detected by the server. It is critic-dependent and disclosed as
    RR-9.
  - Whether `analyst_interpretation` is permitted at all in QP v2.0 is an **Owner decision**
    (§3.11). If it is not permitted, QP Reviews consist only of `fact_template` and `source_quote`,
    and semantic attribution becomes mechanically bounded, at the cost of research value.
- Draft label: `qp_semantic_attribution` is `"templates_and_quotes_only"` when there is no
  interpretation, otherwise `"critic_attested_not_mechanically_verified"`.
- **No raw digits** (`\p{N}`, Thai digits included) in authored sentence text, claim statements or
  relationship text. Digit-bearing tokens appear only as **server-rendered placeholders**:
  - `{{value:claim_N}}` renders "value unit, period, basis";
  - `{{period:claim_N}}`;
  - `{{id:span_K}}` for a form, accession, series or method identifier that is an exact CER
    literal;
  - `{{date:published_at|period}}`.

  A raw digit is HOLD. An unknown placeholder is FAIL.
- **Claims.** At most **8** asserted N1 values per Draft (existing caps: `intakeClaimsSchema`
  `.max(8)`, Judge `claims .max(8)`). More values are HOLD (`qp_claim_capacity`), never silent
  selection.
  - Each claim has `class` and `vintage`.
  - A superseding vintage is a new claim requiring competing-value adjudication, which stays HOLD
    in v2.0.
- **Received/section text digits** need no classification. They are bound by S1/S5/S6. The analyst
  and the critic must still assess the whole section (G2/S6).

### 3.6a Material coverage: support and counter-evidence (v0.4, F02)

S6 proves source integrity; it does not prove that the Review covers what matters. QP adds a
coverage rule:

1. **Mandatory coverage set (MCS).**
   - For each asserted claim, the R2 signer declares (signed) the sections that must be covered:
     the claim's own section or table; every footnote referenced by asserted rows; the
     issuer/agency discussion of the same segment or series (for example the MD&A segment results,
     or the release's technical notes and revisions); and the period's risk-factor or
     economic-conditions update and forward-looking/outlook text where present in the same
     document set.
   - The MCS is sealed into the packet. The critic attests it is not too narrow.
2. **Block enumeration (mechanical).** The server enumerates **every** CER block (paragraph, list
   item, table row, footnote) in the MCS. The analyst must classify **every** block as:
   - `supporting`, `counter_evidence`, `risk`, `guidance_outlook`, `restructuring_mna`,
     `restatement_recast`, `neutral` or `boilerplate`.

   An unclassified block is **HOLD** (`qp_coverage_unclassified`).
3. **Address rule (mechanical given the classes).**
   - Every `counter_evidence` or `risk` block must be referenced by at least one Review sentence
     (`source_quote` or `analyst_interpretation`); otherwise **HOLD**
     (`qp_counter_evidence_unaddressed`).
   - Any `guidance_outlook`, `restructuring_mna` or `restatement_recast` block in the MCS makes the
     result **HOLD / Source-only** (row F), because those classes are outside QP v2.0 scope.
4. **Critic dimension** `coverage_completeness`: the critic attests the MCS and every block class.
   **Misclassification** (for example a margin-pressure paragraph labelled `neutral`) is
   **critic-dependent**. With a negligent critic it can pass; this is disclosed as RR-10.
5. **No trimming.** The Source note stores the whole archived section set. Trimming adverse
   sentences from the received text fails S5/S6 (FAIL). Vintage and footnotes stay bound.
6. **Draft label** `qp_coverage_status: "mcs_all_blocks_classified_counter_addressed"`. This is a
   statement about process, not about truth.

### 3.7 Authority: registry, R2, R3

**Registry** `QP_SIGNER_REGISTRY` (new; root of trust):

- A JSON document `{registryVersion, issuedAt, entries[], revocations[]}`.
- Signed by an **Owner offline Ed25519 root key**. Its public-key fingerprint is **pinned in
  source** (`QP_REGISTRY_ROOT_FINGERPRINT`) and can change only through a reviewed code change.
- Verified at boot. Rejected if the signature is invalid, or the version is lower than the stored
  high-water mark (no rollback).
- Any registry failure disables QP (fail closed). RISK-1.1 is unaffected.
- Each entry has:
  - `principalId`;
  - `principalType: "human"|"ai"`;
  - `roles: reviewer|approver|critic`;
  - `scope {sourceFamilies, metrics}`;
  - `oauthSubjects[]`;
  - `keyId`, `publicKeyPem`;
  - `effectiveFrom`, optional `revokedAt`.
- For QP, the existing `PRIMARY_EVIDENCE_SIGNERS_JSON` keys must also appear in the registry with
  matching roles. That env variable alone is insufficient.

**R2 (primary receipt)** is M551 extended with:

- `canonicalizerVersion`, `cerSha256`, `sectionId`, cell, header and scale `cerSpan`/`rawSpan`;
- the iXBRL fact id;
- attested `published_at`;
- vintage and claim class.

Requirements: two distinct registry principals; both in scope; neither linked to the actor's OAuth
subject.

**R3 (critic attestation)**, signed over:

- the envelope digest, result digest and scope digest;
- `cerSha256`, `sectionId`, the set of R2 receipt ids, and the sentence/claim class map;
- (v0.4) the sentence-kind map, the MCS and the full block-class map (§3.6a), and the G4 history
  classification (`same_series_history` / `cross_series_context`);
- the registry version.

It carries per-dimension verdicts, **including `classification_fidelity`**, and (v0.4)
`semantic_entailment` (per `analyst_interpretation` sentence) and `coverage_completeness`. It is single-use at the
apply critical section and expires no later than the packet. The critic is a third distinct
principal, in scope, with no shared OAuth subject with the actor or with the R2 principals.

**Separation checks** are on principal ids and declared OAuth subjects. They are attestations, not
proof. Labels:
- `qp_critic_basis: "registry_principal_key_attested"`;
- `qp_critic_principal_type: human|ai`;
- `humanPresence: not_verified`.

**No MCP route** creates R2, R3 or the registry. A user-supplied, self-issued, expired, revoked,
out-of-scope or registry-unknown attestation is HOLD.

### 3.7a Assurance levels (v0.4, F05; labels only; qualification is an Owner decision)

| Level | Meaning | Provided by QP? |
|---|---|---|
| L-T Technical attestation | Signatures bind exact bytes, scopes and digests; keys are in the registry | Yes (R2, R3, registry) |
| L-S Investment semantic peer review | A reviewer assessed entailment, classification and coverage | **Claimed** by R3 verdicts; quality is not verified |
| L-Q Qualified reviewer | The principal meets an Owner-defined qualification (accounting/economics) for that scope | **No.** Only if the Owner defines and records qualification outside the server; QP cannot verify it |
| L-G Independent Gold | Frozen-spec, independently appointed evaluation | **No.** Separate process |

Labels:
- `qp_assurance_level: "technical_attestation+critic_claimed"`;
- `qp_critic_principal_type: human|ai`;
- `humanPresence: not_verified`.

No label may state or imply L-Q or L-G. Who may sign, what qualification means, and whether the
Owner counts as a principal remain **Owner decisions** (§3.11).

### 3.7b Registry rollback, rotation and recovery (v0.4, F06): threat model and options only

**Threat.** The v0.3 high-water mark lives in the same instance storage as the registry. A
restore or rollback of that storage (operator restore, snapshot, volume copy) can reinstate an
older registry together with its older high-water mark. Revoked keys then become valid again,
undetected. A compromised root key, or a lost root key with no recovery, has the same effect.

**Options** (not chosen; each needs Security/Owner review):

- **(O1) External rollback witness.** An append-only, Owner-controlled log outside the instance
  records the current registry version and digest. The server requires a fresh witness proof at
  boot, and QP stays disabled without it.
- **(O2) Short-lived registry.** The registry carries `expiresAt` and must be re-signed
  periodically. A restored old registry expires, which bounds the rollback window. This costs
  operational load.
- **(O3) Minimum version pinned in source** for each release. Rollback below it requires a code
  change.
- **(O4) Restore detection.** On any storage-restore or maintenance-restore marker, QP is disabled
  until the Owner re-attests.
- **(O5) Hardware or external monotonic counter.** Environment-dependent.

**Rotation and revocation semantics** to decide:
- overlapping root keys versus a hard switch;
- an emergency denylist pinned in source;
- the revocation-propagation deadline.

**Recovery authority** after root-key loss or compromise: **Owner decision**.

**This proposal does not implement or choose any recovery, key ceremony or custodian. SECURITY
DESIGN HOLD remains.**

### 3.8 Test matrix (written before implementation; all RISK-1.1 tests unchanged and green)

**Retained from v0.2.** Meaning unchanged; mechanics per v0.4, so §3.6a coverage and sentence kinds also
apply to T-A1/T-A2/T-D1. Values are bound via CER/iXBRL
and rendered via placeholders; the T-D2 methodology uses identifier and period placeholders only.

| ID | Scenario | Expected |
|---|---|---|
| T-A1 | Honest MSFT-style segment actuals: earnings content type, `materialRisk:true`, `new_event` periodic release, full section CER, N1 per value, R2 + R3 PASS | **PASS** Draft with restrictive labels; Source + Review receipts; resolved link |
| T-A2 | Same as T-A1 for a consolidated total and a per-share value (scale "except per share") | PASS; per-share unit bound separately |
| T-D1 | BLS CPI index level, SA, series id, vintage, R2 + R3 | PASS |
| T-D2 | Methodology Draft on the missing October 2025 data with identifier and period placeholders only (no N1) | PASS-eligible methodology Draft |
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

**New in v0.3:**

| ID | Scenario | Expected |
|---|---|---|
| T-W1 | Full income-statement section with many unselected rows; two asserted values | PASS-eligible: unselected digits need no class; the two values are bound |
| T-W2 | Section above `QP_SECTION_MAX_CHARS` | HOLD `qp_section_too_large`, no truncation |
| T-W3 | Caller `extractedText` differs from the server CER section | CER used; mismatch recorded; caller text is never the QP Source |
| T-X1 | iXBRL `sign="-"` or `scale` disagreeing with displayed text or declared scale; wrong `contextRef` period or segment member | FAIL `claim_scope_mismatch` |
| T-X2 | Footnote `<sup>` adjacent to a value; rowspan/colspan headers; repeated "except per share" scale | Value excludes the footnote; correct header path; per-share row unit separate |
| T-X3 | Hidden (`display:none`, `ix:hidden`) duplicate of a value used as the anchor | HOLD (non-citable) |
| T-X4 | Fullwidth, Arabic-Indic or mixed digits, a bidi or zero-width character inside a value | HOLD `qp_value_unicode_hold` |
| T-X5 | Two independent parsers disagree on the cell grid | HOLD (implementation-time differential test) |
| T-P1 | Raw digit typed in a Review sentence; unknown placeholder | HOLD / FAIL |
| T-P2 | *(v0.3 wording "impossible by construction" **retracted** in v0.4. See T-P2a–f below.)* | superseded |
| T-P3 | A digit-free guidance or M&A sentence classed `context`, or unreferenced | Unreferenced: HOLD. Misclassed: R3 `classification_fidelity` must HOLD; test with a negligent-critic fixture showing that the server still HOLDs on the unreferenced variant |
| T-P4 | Nine asserted values | HOLD `qp_claim_capacity` |
| T-K1 | Unsigned or invalidly signed registry; lower `registryVersion` replayed; revoked key; key outside scope | QP disabled or HOLD |
| T-K2 | Actor OAuth subject listed for an R2 or R3 principal; R3 principal equal to an R2 principal | HOLD |
| T-K3 | M551 env key not in the registry | HOLD for QP; RISK-1.1 unaffected |
| T-H1 | QP history without its own S1 snapshot, different issuer/series, or later attested `published_at` | HOLD |
| T-Q1 | `qpEnabled()` with `c1Pilot()` true, or the opt-in absent | RISK-1.1 path; QP artefacts HOLD |
| T-M1 | Old binary receiving QP-only input fields | Strict reject, no write; Source-only capture via existing fields still works |
| T-M2 | A QP Draft read by `researchTrust` | `research_status: draft`; `critic_independence: not_verified`; `qp_*` keys ignored by old readers |

**New in v0.4** (expectations are exact; "known limitation" rows document a residual risk
honestly rather than claiming detection).

| ID | Scenario | Expected |
|---|---|---|
| T-P2a | "Segment B benefited from revenue {{value:claim_A}}" (value placeholder in free prose) | **HOLD** (placeholder outside `fact_template`); mechanical |
| T-P2b | `fact_template` for claim_A rendered | Subject, segment, metric, period and value come from the signed claim; caller text cannot alter them; mechanical |
| T-P2c | Interpretation: "Segment B drove the quarter's growth" when the source attributes it to Segment A. Honest R3 / negligent R3 PASS | Honest: HOLD (`semantic_entailment`). **Negligent: PASS. Known limitation RR-9**; Draft labelled `critic_attested_not_mechanically_verified` |
| T-P2d | Interpretation with negation: "revenue did not decline" when the source shows a decline, citing the claim key. Honest / negligent R3 | HOLD / **PASS (known limitation RR-9)** |
| T-P2e | Interpretation with causality: "growth was driven by pricing" when the source states volume or gives no cause. Honest / negligent R3 | HOLD / **PASS (known limitation RR-9)** |
| T-P2f | Period words in prose ("last year", "this quarter") contradicting the claim period; digit periods typed | Digits: **HOLD** (no raw digits). Words: critic-dependent (RR-9) |
| T-P2g | Owner chooses "no `analyst_interpretation` in v2.0"; any interpretation sentence present | **HOLD**; T-P2c–e become unreachable |
| T-CV1 | MCS with one unclassified block | **HOLD** `qp_coverage_unclassified` |
| T-CV2 | A `counter_evidence`/`risk` block (for example margin pressure or customer concentration) is classified but not referenced by any sentence | **HOLD** `qp_counter_evidence_unaddressed` |
| T-CV3 | The counter block misclassified as `neutral`; honest / negligent R3 | Honest: HOLD (`coverage_completeness`). **Negligent: PASS. Known limitation RR-10** |
| T-CV4 | MCS declared too narrow (the signer omits a footnote referenced by an asserted row) | **HOLD** (a referenced footnote is mandatory and checked mechanically against the row's footnote markers) |
| T-CV5 | Adverse sentences trimmed from the received text | **FAIL** (S5/S6) |
| T-G4a | BLS CPI history used as comparative history for an Employment Situation claim | Classified `cross_series_context`; any comparison **HOLD** |
| T-G4b | Same issuer, pre-recast three-segment history vs recast two-segment claim, with no issuer recast comparative | `cross_series_context`; comparison **HOLD** |
| T-G4c | First-ever segment or series (no `same_series_history`) | **HOLD** (by design; Owner decision §3.11-7) |
| T-G4d | Prior document captured now: `known_at` = now, `published_at` historical | Dates stored distinctly; rendering never says "known at" the historical date |

**Real-primary mixed-content set T-RP (F04).**
- Fixture: the MSFT FY27Q1 primary set, i.e. the Form 10-Q for the period ended 2026-09-30
  (EDGAR accession 0001193125-26-436133, as cited in the CHAT source packet) and the matching
  earnings release, if any.
- **Bytes, rights and exact passages must be sealed by the source custodian before use.** The
  author has not re-verified these bytes in this revision.
- Each expectation below is conditional on the sealed content.

| ID | Scenario | Expected |
|---|---|---|
| T-RP1 | Actuals-only Draft (segment revenue / operating income templates) while the MCS contains an economic-conditions or risk update block that is not referenced | **HOLD** `qp_counter_evidence_unaddressed` |
| T-RP2 | The MCS contains outlook or guidance text (earnings release or forward-looking discussion) | **HOLD / Source-only** (row F), even when the actuals are perfectly bound |
| T-RP3 | Honest Draft: templates for asserted actuals, `source_quote` of every adverse block, all blocks classified, MCS free of guidance/restructuring | **PASS-eligible** only if the sealed MCS really contains no out-of-scope block. Otherwise HOLD is the *correct* expected outcome, not a false HOLD. |
| T-RP4 | Comparison of the recast two-segment FY27Q1 values with the old three-segment FY26 values | **HOLD** (C2, T-G4b) |
| T-RP5 | Source presented with risk or outlook sentences removed | **FAIL** (S5/S6) |
| T-RP6 | T-RP1 with the risk block misclassified as `neutral` and a negligent R3 PASS | **PASS (known limitation RR-10)**, recorded as the residual it demonstrates |

### 3.9 Residual risks (not technically removable; for independent reviewers and Owner)

1. **RR-1 Key ≠ human.** In a personal deployment with a single admin, the Owner may hold every
   key. An AI principal remains an AI (`principalType` is a declaration). There is no technical
   proof of independence or competence.
2. **RR-2 Critic error or collusion.** Mitigated by placeholders, sentence binding and fact gates
   first. Not eliminated.
3. **RR-3 Canonicalizer or iXBRL resolver bugs** sit on the trust path. Mitigated by a pinned
   version, a differential parser and fuzzing.
4. **RR-4 Archive fetch under graceful drain.** `mutationFenced` admits in-flight work during
   DRAINING; this is not under the strict D1 oracle. Belongs in the ADR-D1-GIT-01 scope.
5. **RR-5 Legal rights and retention** (S2) are Owner/legal decisions.
6. **RR-6 First-ever disclosures and long sections HOLD** (product cost).
7. **RR-7 Mixed-version rollout:** QP gates HOLD on old binaries (intended).
8. **RR-8 Root-key custody.** Loss or compromise of the Owner root key compromises the registry.
   Rotation needs a code change, by design.
9. **RR-9 Semantic attribution in `analyst_interpretation`** (subject, segment, negation, causality,
   relative period) depends on the critic. A negligent or wrong critic PASS is not caught
   mechanically (T-P2c–f). It is eliminated only if the Owner excludes interpretation from v2.0
   (T-P2g).
10. **RR-10 Coverage classification** depends on the critic. Misclassifying a counter, risk or
    outlook block as `neutral` passes with a negligent critic (T-CV3, T-RP6). Enumeration and
    address checks are mechanical; class truth is not.
11. **RR-11 Registry rollback** with restored storage remains open until an F06 option is chosen
    and reviewed (§3.7b).
12. **RR-12 MCS breadth** is declared by the R2 signer and attested by the critic. Only referenced
    footnotes are checked mechanically.

### 3.10 Compatibility, enforcement and rollout

- **Enforcement:** `qpEnabled()` returns true only if all of:
  - `RESEARCH_RISK_POLICY === "2.0-QP"`;
  - **not** `c1Pilot()`;
  - the registry is valid and current.

  Otherwise the RISK-1.1 path applies and QP artefacts HOLD. **The default and C1 remain
  RISK-1.1.**
- **Schemas:**
  - New QP-only input fields (`primarySection {snapshotId, sectionId}`, structured sentences,
    placeholders) are advertised only by QP instances. Old binaries reject them strictly, with no
    write.
  - **No change to existing enums** (`contentTypes`, `sourceKind`).
  - New stamp and Judge protocol increment invalidate pending gates restrictively.
- **Metadata:**
  - `draftMetadata` is **unchanged**, including `critic_independence: "not_verified"` and
    `RESEARCH_STATE_POLICY`.
  - New keys only: `qp_risk_policy`, `qp_critic_attestation_id`, `qp_critic_basis`,
    `qp_critic_principal_type`, `qp_primary_receipts`, `qp_cer_sha256`, `qp_registry_version`, and
    (v0.4) `qp_semantic_attribution`, `qp_coverage_status`, `qp_assurance_level`.
  - `researchTrust` and `assertResearchStateAuthority` only compare `draftMetadata` keys
    (`research-state.ts`), so readers stay compatible.
- **Rollout gates (none approved):**
  1. Independent security and source/research review of **v0.4**. F06 stays under SECURITY DESIGN
     HOLD until an option is chosen and reviewed.
  2. Owner decisions in §3.11.
  3. Owner decision to implement exactly this tier.
  4. Source rights and allowlist action.
  5. Root-key and signer ceremony (WORK).
  6. Isolated implementation with §3.8 tests first.
  7. Exact-tree CI.
  8. Independent delta review.
  9. Separate isolated real-source E2E grant.

  Full L1 SECURITY HOLD (ADR-D1-GIT-01) still applies before any release.

### 3.11 Open Owner decisions (not assumed by this document)

1. **Critic principal type:** human-only, or AI allowed (labelled `qp_critic_principal_type: ai`,
   never `human`).
2. **Who holds the Owner offline root key**, and the custody and rotation procedure.
3. **Minimum distinct principals.** The proposal uses three (R2 × 2 + R3). Decide whether any
   principal may be the Owner.
4. **`QP_SECTION_MAX_CHARS`** value (proposed 100,000).
5. **Initial source families and metrics** in registry scope, for example SEC filings for listed
   issuers and BLS CPI only.
6. **(F01)** Whether `analyst_interpretation` sentences are allowed in QP v2.0, with RR-9
   disclosed, or whether QP Reviews are templates and quotes only.
7. **(F03)** Whether to commission a *separate* primary-only first-event factual Draft route for
   first-ever disclosures. It is outside this proposal and would need its own design and review.
8. **(F05)** Qualification standards per assurance level (L-Q), who may sign, and whether the Owner
   counts as a principal. Not decided here.
9. **(F06)** Which rollback-protection option(s) (O1–O5), rotation and revocation semantics, and
   recovery authority after root-key loss or compromise. Not decided here.
10. **(F02)** Approval of the per-source-family MCS profile, i.e. which companion sections are
    mandatory, before implementation.
