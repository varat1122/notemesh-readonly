# PR #95 — Offline Multi-Claim Release Reconciliation

**Scope:** deterministic, read-only TypeScript orchestration and synthetic
integration tests. **Not** live earnings parsing, AI semantic inference,
owner authentication, primary-source verification, or production deployment.

## Why

A single earnings release can contain Revenue, Margin, Guidance and Free
Cash Flow statements that carry **different economic and evidentiary
implications**. Treating the release as one broad "duplicate" risks hiding
material contradictions. PR #94 had only one incoming structured claim per
execution. This PR composes up to **six separately validated claims** into
one conservative review outcome.

## Executed path

Each claim runs the existing PR #94 physical snapshot + SQLite/FTS history,
citation-bound scoped Thesis excerpt check, unverified proposed mechanism
judge and exception queue. The batch requires:

- 2–6 claim inputs, each with **exactly one** unverified finding/analyst
  proposal; one-to-one case index and independent citation scope
- One identical **caller-declared** issuer, event key, source URL,
  declared source hash, snapshot directory and expected manifest
- Reconciled physical snapshot for every claim, with a **final**
  independent reconciliation of the same snapshot after the batch
- Atomic fail-closed semantics: if any citation, Thesis line, snapshot,
  identifier or source-version condition fails, return **no queue**
- Output includes only bounded ordinals, enum mechanisms/classifications
  and deterministic reason codes — no incoming values, private quotes,
  note paths, source URLs or free-form model text

## Cross-claim reconciliation

For pairs sharing issuer/event/source, compare separately by **metric +
period + unit**; the literal value is compared only after these
dimensions match.

| Case | Conservative response |
|---|---|
| Same metric/period/unit, **different literal value** | Escalate BOTH claims to unverified owner priority; requires issuer originals / potential correction review |
| Same metric/period/unit/value repeated in release | Retain BOTH in analyst review; repeated mentions are not independent proof |
| Same metric/unit/value, **different financial periods** | Do not treat as same-period conflict or corroboration; flag period distinction |
| Different metrics such as Revenue vs GM vs FCF | Keep each in its separately determined evidence queue; avoid assuming one confirms another |
| Any per-claim contradiction, Thesis challenge, incomplete claim scope | Keep priority from underlying physical pipeline; aggregate release priority is the most serious case |
| Bad Claim #3 of #4, stale snapshot or mismatched source version | Abort entire batch; never emit misleading partial acceptance |

**Date discipline:** event, source publication, and import dates remain
separate. A caller-supplied common event key is *not* independent proof that
financial statements belong to the same original issuer document.

## Explicit limitations

1. Synthetic fixture label and owner identity are not independently
   authenticated. The source hash is declared, not checked against a
   published issuer original.
2. Physical snapshot reconciliation is not full Obsidian device, source
   archive or semantic coverage. The individual PR #94 scans are bounded.
3. Proposed economic channels are validated enum values from untrusted
   model/analyst input; the system **does not infer Margin/EPS/FCF causal
   changes**, quantify materiality or revise valuation/portfolio.
4. No automatic duplicate suppression, event dismissal, Current Thesis
   mutation, approval, live notification, API call or production endpoint.
5. The current strict one-event/one-source identity gate is intentional.
   Multi-document cross-issuer reconciliation and independent research
   sources belong in a later milestone with broader trust/auth controls.
6. This orchestrator currently runs the PR #94 flow once per claim.
   It prioritizes safety and source traceability over scalable ingest
   performance. Do not interpret synthetic CI as production load testing.
7. Review-by-Exception is still a **candidate queue**; analyst/owner
   authorization and legitimate privacy-scoped disclosure are not present.

## Test strategy

Isolated fictional Markdown/SQLite/FTS snapshots cover multi-metric
earnings, changed source, conflicting revenue within a release, repeated
literals, same numbers for different periods, malicious prose,
cross-issuer and cross-snapshot mixing, fabricated citations and stale
files. Tests must pass via normal GitHub CI. No real Vault is used.

**NO MERGE / NO DEPLOY / NO PRODUCTION DATA WRITES.**
**OpenAI API testing stays PAUSED until owner explicitly resumes it.**
