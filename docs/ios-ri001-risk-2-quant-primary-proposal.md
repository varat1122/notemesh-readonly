# RI001-DRAFT-RISK-2.0-QP — proposal for quantitative PRIMARY research (DESIGN ONLY)

**Status: PROPOSAL / NOT IMPLEMENTED / NOT APPROVED.** This document does not change
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

## 3. Proposal: `RI001-DRAFT-RISK-2.0-QP` (quantitative primary tier)

**Goal:** admit faithful **issuer-reported** or **official-statistics** numeric research as a
*restrictive Draft*. G1–G4 and G6–G11 stay exactly as they are; G5 is replaced only for numeric
tokens that pass the stricter gates below. RISK-1.1 remains the default. 2.0-QP is a separate,
opt-in instance policy with its own stamp. Older writers already reject unknown stamps, so a
2.0-QP gate on an old binary fails closed.

### 3.1 Scope (all else stays RISK-1.1)

In scope:
- **Primary issuer filings and releases:** SEC EDGAR 10-K/10-Q/8-K/EX-99.1, and the issuer IR
  host on the archive allowlist.
- **Official statistical releases:** for example BLS CPI tables and methodology pages, on the
  allowlist.

Still HOLD:
- broker research, consensus and estimates;
- management guidance and forecasts;
- portfolio, price-target or valuation conclusions;
- derived arithmetic (growth %, margins, recast comparisons) unless the issuer or agency itself
  publishes the figure;
- PIT (`historyCutoff`);
- correction, contradiction and unresolved events.

### 3.2 Source validation (new gate S)

Each of S1–S4 is required:

- **S1 Archived original bytes.** The Source is captured through the existing
  content-addressed archive (`archive_original_source`, allowlist, real `SOURCE_ARCHIVE_USER_AGENT`).
  The packet binds `snapshotId`, `sha256`, URL and the issuer/agency document identity
  (accession number or release id).
- **S2 Received-text equivalence.** Each cited received-text span is also a literal in the archived
  bytes (`archivedSourceContainsLiteral`). Caller-pasted text alone is never primary.
- **S3 Dates kept separate.** `published_at` (document metadata), `period` (claim dimension),
  `known_at` (server capture time) and `event` stay distinct. A page "last modified" date is never
  an event date.
- **S4 PDF and mixed formats** stay HOLD until reviewed coverage exists. This is the existing G10
  rule, unchanged.

### 3.3 Numeric token classification (replaces G5 only inside 2.0-QP)

Every `\p{N}` run in the received text and the proposed Review must fall into **exactly one**
sealed class. Any unclassified digit HOLDs, exactly as in RISK-1.1.

- **N1 claim value.** Bound to a structured claim with all of:
  - `entity`, `metric`, `period`, `unit`;
  - `accountingBasis` {standard GAAP/non-GAAP/statutory, scope segment/consolidated, recast flag,
    definition};
  - for statistics: seasonal adjustment SA/NSA, series id, base period, vintage.

  The value must be a literal match with no clipping (`claim-value-anchor`), in the received span
  *and* in the archived bytes. No rounding, rescaling or sign inference. A unit scale such as "in
  millions" must appear in an anchored context span.
- **N2 identifier.** Form type, accession number, series id, method name (`X-13ARIMA-SEATS`) or
  ticker. Each is a declared typed span that is an exact archived literal. Identifiers carry no
  economic meaning and may never appear in a numeric claim.
- **N3 document date.** Must equal the bound `published_at`, `period` or `known_at` field.
- **Review prose.** Every digit in the Thai Review must be a verbatim restatement of an N1 value
  (same unit and period label), or an N2 or N3 token. Any other number HOLDs; that includes
  arithmetic, comparisons, percentages not in the source, and Thai-digit transliteration.

### 3.4 Reviewer and critic provenance (replaces the unsatisfiable G9 only for 2.0-QP)

- **R1 Analyst/actor.** Unchanged: the OAuth actor label. It is not a human or model identity.
- **R2 Primary receipt for each material N1 claim.** The existing M551 receipt:
  - two out-of-band Ed25519 signatures (`reviewer`, `approver` keys in
    `PRIMARY_EVIDENCE_SIGNERS_JSON`, public keys only);
  - signed over snapshot, entity, metric, period, unit, verified value, locator and excerpt;
  - with competing values adjudicated.

  There is still no MCP route that creates receipts.
- **R3 Critic.** A new signed critic attestation over the **packet envelope digest, the result
  digest and the risk scope digest**:
  - verdict PASS/HOLD/FAIL per dimension, with references;
  - signed by a key with role `critic`;
  - the critic key must not be the R2 reviewer/approver key used for the same claim, and must not
    be the actor;
  - expiry no later than the packet expiry; single-use, consumed at the apply critical section.

  It is recorded as `criticIndependence: "key_attested_out_of_band"`. This is still **not**
  `verified_human`. MFA and real-world independence are attested outside the single-admin
  server, as M551 already states.
- **R4 Dashboard reviewer** (C1) stays as is and is *additional*. It never replaces R2 or R3.
- **Combination rules:**
  - Missing R2 or R3, any non-PASS critic dimension, or a signature/scope mismatch means HOLD.
  - A critic FAIL is recorded and the result is FAIL.

### 3.5 Invariants that must not change

- Immutable Source bytes.
- Server receipts: write, readback and reindex verified.
- Exact CAS and preview-token single consume.
- Resolved Review→Source link.
- `historical_analysis_only`, `comparator_eligible: false`, `independent_evidence_increment: 0`,
  and no Thesis, Evidence Register, Company Evolution, Portfolio or Timeline writes.
- No Git, Obsidian or Prices ingress in C1.
- Maintenance and D1 fences.
- Old binaries fail closed on the new stamp.
- A 2.0-QP PASS **never** sets `verified_primary` on the Review. Primary authority stays with M551
  receipts.

### 3.6 Risks

- **False HOLD (accepted cost).**
  - Tables whose scale header is far from the value.
  - Values split across HTML cells or formatted with non-ASCII digits.
  - Recast comparisons (MSFT old three segments vs new two) — correctly HOLD.
  - Agency revisions without a vintage.
  - Missing-data periods (BLS October 2025) used in year-on-year statements — correctly HOLD.
- **False PASS, and its mitigation.**
  - A value that is literal but in the wrong period or unit: claim dimensions plus critic, with
    scale in the anchored context.
  - Cherry-picked excerpts: the critic attests completeness against the archived section.
  - Restatements: a new vintage creates a new claim key with competing-value adjudication.
  - Prompt injection inside the Source: the Source stays untrusted data; the critic must cite
    spans.
- **Security.**
  - Key compromise: public keys are pinned out of band; rotation needs a restart; the audit log
    records the key id.
  - Replay: signatures bind the envelope and expiry, and are single-use.
  - Signer collusion: distinct-key rule; MFA and independence are attested outside the server.
  - Allowlist widening (bls.gov, microsoft.com) is an operator change that needs Owner approval.
  - Archive egress is fetch-only, no redirects, size-capped.

### 3.7 Compatibility and migration

- New stamp `RI001-DRAFT-RISK-2.0-QP` and Judge protocol increment, so pending RISK-1.1 gates are
  invalidated restrictively (the existing pattern).
- Instance opt-in, for example `RESEARCH_RISK_POLICY=2.0-QP`. **Default and C1 stay at 1.1**
  until approved.
- No schema change to Source/Review notes, only new frontmatter labels (`risk_policy`,
  `critic_attestation_id`, `primary_receipts`).
- Existing notes and receipts are untouched. Legacy Vault notes such as the MSFT FY26Q4 note with
  `source_sha256: null` can never serve as G4 history.

### 3.8 Test matrix (to write *before* implementation; every RISK-1.1 test stays green unchanged)

- **Positives:** MSFT segment revenue as N1 with both receipts and a critic PASS gives a Draft
  PASS; a BLS published CPI index level (SA, vintage, series id) with receipts and critic PASS
  gives a Draft PASS.
- **HOLD/FAIL:**
  - an unclassified digit;
  - a derived growth %;
  - a recast-period comparison;
  - a period or unit mismatch with the anchor;
  - a scale header missing from context;
  - a value clipped from a larger number;
  - a received span not present in the archive;
  - a host not on the allowlist;
  - PDF without coverage;
  - missing R2;
  - missing, expired, replayed or wrong-scope R3;
  - critic key equal to the reviewer key;
  - a critic HOLD (HOLD) or FAIL (FAIL);
  - broker, estimate or guidance;
  - `historyCutoff`;
  - the old binary reading a 2.0-QP gate (fail closed);
  - a 1.1 instance given a 2.0-QP result (HOLD).
- **Invariants:** protected bytes unchanged; receipts and links cold-verified; no Review
  `verified_primary`; maintenance-active refusal.

### 3.9 Rollout gates (none approved)

1. Owner approval of this text.
2. Independent security and source-review sign-off.
3. Signer/critic key ceremony out of band (WORK).
4. Allowlist decision.
5. Implementation on an isolated branch.
6. Exact-tree CI.
7. Independent delta review.
8. Separate real-source E2E grant.

Full L1 Security HOLD (ADR-D1-GIT-01) is independent of all of this and still applies before any
release.
