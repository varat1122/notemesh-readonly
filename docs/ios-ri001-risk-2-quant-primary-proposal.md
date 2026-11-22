# RI001-DRAFT-RISK-2.0-QP — proposal for quantitative PRIMARY research (DESIGN ONLY) — v0.3

**Status: PROPOSAL v0.3 / NOT IMPLEMENTED / NOT APPROVED.** v0.3 resolves the v0.2 internal
adversarial self-review (CD-1 to CD-6, DG-1 to DG-8) written by the author; see §3.0. That
self-review is **not** an independent review. Earlier versions: v0.1 `7e5ee75`, v0.2 `6bfd5c7`.
§1 and §2 are unchanged. This document does not change
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

## 3. Proposal: `RI001-DRAFT-RISK-2.0-QP` — v0.3 (supersedes v0.2 §3 at `6bfd5c7`)

### 3.0 Change log

- **v0.1 → v0.2.** Reconciled the G3/G7/G8/G9 contradiction: bounded tier semantics, and a critic
  that can only add HOLD/FAIL. v0.1 is at `7e5ee75`, v0.2 at `6bfd5c7`.
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
| G9 Critic | Unsatisfiable, therefore HOLD | Satisfied only by a valid R3 from a registry-authorized principal, PASS on all dimensions **including `classification_fidelity`** (§3.7) | **changed** |
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

**G4 under QP.** Each history item used by a finding must meet all of:

- **(a)** be a native Source intake receipted in this instance, as today;
- **(b)** carry its own S1 archive snapshot;
- **(c)** have the same exact issuer resolution (company) or the same series id/agency (macro) as
  the new claim scope;
- **(d)** have an attested `published_at` (from the R2 signer) earlier than the new Source's
  attested `published_at`.

Bootstrap, honest only:
- Capture the prior-period primary document first (`captureOnly`, archived), with its real
  `known_at` and its attested historical `published_at`.
- Never backdate `known_at`. Never use legacy Vault notes.
- A first-ever disclosure with no prior primary document (IPO, a new series) **HOLDs by design**.

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
| **A** Primary historical actuals (MSFT FY27Q1 segment revenue/op. income, as presented) | **PASS-eligible** when all of these hold: S1–S7; CER + iXBRL-bound N1 per asserted value; every value rendered from a placeholder; every sentence bound and classed `historical_actual`/`context`; R2 per value; R3 PASS including `classification_fidelity`; G4-QP history (for example the prior-period 10-Q/10-K captured first) |
| **B** Guidance or forecast, with or without digits | **HOLD.** A `guidance_forecast` sentence or claim class HOLDs the whole Draft; the Source is saved. |
| **C1** Value bound to the wrong row, column, period, basis, sign or scale relative to the CER/iXBRL fact or R2 scope | **FAIL** `claim_scope_mismatch` |
| **C2** Old-basis vs recast comparison not published by the issuer | **HOLD** |
| **C3** Derived arithmetic | **HOLD** (no placeholder exists for computed values) |
| **D1** Official BLS published measurement (`macro_data`, `official_macro`; series id, reference period, SA/NSA, base, vintage) | **PASS-eligible** under the same requirements as A |
| **D2** BLS methodology (missing October 2025 data handling) | Eligible as a **G5-only** relaxation: identifier and period placeholders only, no N1, G3 all `absent`, class `methodology`/`context`. Any October 2025 level or rate, or any interpolated figure presented as official, is **FAIL** `no_official_value_for_period`. |
| **E** Legacy note or unreceipted history | **HOLD** (G4) |
| **F** A filing mixing actuals with M&A/restructuring/guidance text | **HOLD** for the whole Draft if any such sentence is present (classes are per sentence); the Source is saved. Splitting is allowed only as two honest Drafts, and the actuals Draft must itself pass G2 coverage of the full section (S6) with no omission of material counter-context, attested by R3. |

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

- **Structured QP Review.** Each Review field is an array of sentences `{text, class, refs[]}`.
  - Every sentence must have one to four refs: an exact CER span or a claim key. An unreferenced
    sentence is HOLD.
  - Classes: `historical_actual`, `methodology`, `context`, `guidance_forecast`,
    `restructuring_mna`, `restatement_recast`, `other_material`.
  - Only `historical_actual`, `methodology` and `context` are admissible.
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
- the registry version.

It carries per-dimension verdicts, **including `classification_fidelity`**. It is single-use at the
apply critical section and expires no later than the packet. The critic is a third distinct
principal, in scope, with no shared OAuth subject with the actor or with the R2 principals.

**Separation checks** are on principal ids and declared OAuth subjects. They are attestations, not
proof. Labels:
- `qp_critic_basis: "registry_principal_key_attested"`;
- `qp_critic_principal_type: human|ai`;
- `humanPresence: not_verified`.

**No MCP route** creates R2, R3 or the registry. A user-supplied, self-issued, expired, revoked,
out-of-scope or registry-unknown attestation is HOLD.

### 3.8 Test matrix (written before implementation; all RISK-1.1 tests unchanged and green)

**Retained from v0.2.** Meaning unchanged; mechanics per v0.3. Values are bound via CER/iXBRL
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
| T-P2 | Correct literal attached to the wrong segment in prose | Impossible by construction (values only via `{{value:claim_N}}` with metric/period rendered) |
| T-P3 | A digit-free guidance or M&A sentence classed `context`, or unreferenced | Unreferenced: HOLD. Misclassed: R3 `classification_fidelity` must HOLD; test with a negligent-critic fixture showing that the server still HOLDs on the unreferenced variant |
| T-P4 | Nine asserted values | HOLD `qp_claim_capacity` |
| T-K1 | Unsigned or invalidly signed registry; lower `registryVersion` replayed; revoked key; key outside scope | QP disabled or HOLD |
| T-K2 | Actor OAuth subject listed for an R2 or R3 principal; R3 principal equal to an R2 principal | HOLD |
| T-K3 | M551 env key not in the registry | HOLD for QP; RISK-1.1 unaffected |
| T-H1 | QP history without its own S1 snapshot, different issuer/series, or later attested `published_at` | HOLD |
| T-Q1 | `qpEnabled()` with `c1Pilot()` true, or the opt-in absent | RISK-1.1 path; QP artefacts HOLD |
| T-M1 | Old binary receiving QP-only input fields | Strict reject, no write; Source-only capture via existing fields still works |
| T-M2 | A QP Draft read by `researchTrust` | `research_status: draft`; `critic_independence: not_verified`; `qp_*` keys ignored by old readers |

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
    `qp_critic_principal_type`, `qp_primary_receipts`, `qp_cer_sha256`, `qp_registry_version`.
  - `researchTrust` and `assertResearchStateAuthority` only compare `draftMetadata` keys
    (`research-state.ts`), so readers stay compatible.
- **Rollout gates (none approved):**
  1. Independent security and source/research review of **v0.3**.
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
