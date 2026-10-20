# PR #93 — Offline Evidence-safe Review Triage (DRAFT / NO PROD)

## Purpose

Reduce **unsafe false duplicate** decisions in PR #92's offline
review-by-exception workflow. A model/analyst may propose
`duplicate_candidate`, but that proposal is **never a verified
duplicate and never permission to suppress a headline**.

This milestone adds `buildOfflineEvidenceSafeTriage`. It consumes the
unverified PR #89 candidate packet already accepted by PR #92 plus
synthetic, caller-provided structured incoming/prior claims and bounded
index/snapshot declarations. It **recomputes** PR #84
`classifyHistoricalClaim` locally. No model inference, real Vault,
network, model API, production endpoint or write.

## Overrides, ordered by safety

- Same event/entity/metric/unit/financial period with a **different
  numeric literal** → potential correction/contradiction → priority
  human review. Do **not** decide which value is correct.
- Same URL/event/metric/period but **different declared source hashes**
  → possible source revision; priority human review even if an older
  exact-metadata note also matches.
- Same value/entity/metric/unit but **different accounting period**
  → not an identical claim; a duplicate proposal gets priority review.
- Archived/derivative AI-only history, incremental detail, changed source
  or no historical match under the bounded scan cannot prove a duplicate;
  contradictory model duplicate proposals are escalated.
- Stale, unknown or mismatched snapshot fingerprints, incomplete index
  scope or a failed comparison → **hold for review**; never interpret
  zero results as a novel event or a safe duplicate.
- Even exact `eventKey + entity + metric + period + unit + value +
  source URL + hash` only means **metadata matched**. The candidate
  stays in analyst review. Fact, publisher and economic claims remain
  unverified.

No finding is automatically discarded, written to the Vault, or turned
into owner approval. Task outputs include only fixed classification and
reason codes plus bounded IDs and counts. They intentionally omit source
URLs, note paths, private Thesis excerpts, free-form user/model prose
and portfolio content.

## Limitations and trust boundaries

1. `snapshotCurrent:true`, `completeIndexScan:true`, SHA-256 and
   structured fields are *supplied declarations*; they are not proof of
   physical freshness, exhaustive Vault coverage, issuer authenticity,
   note independence or semantic accuracy.
2. PR #84 compares structured keys and literal strings, not qualitative
   synonymy, Thai-language paraphrases or causal hypotheses.
3. A matching SHA-256 proves neither a legitimate source publisher nor
   the truth of the issuer statement. A source revision indicator needs
   reading both original issuer documents.
4. All tests use SYNTH fictitious claims; output is an **offline triage
   candidate list**, not a real owner notification or execution.
5. `buildOfflineExceptionReviewQueue` remains unchanged; this new
   adapter is not wired to a production route or a real ingest stream.
6. No external model, key, secret, confidential Current Thesis or
   production Obsidian file was accessed.

## Acceptance and follow-up

Unit tests cover numeric contradictions, equal values across different
periods, same-URL revision (including one competing exact match),
archived AI, same-event new metric, stale SHA, incomplete scan,
cross-case/missing input, privacy redaction, forged semantic label,
and no-match abstention.

Passing CI confirms these code/synthetic assertions only. Next step
would be an independent security review of full offline pipeline
orchestration; *do not* merge or deploy as a substitute for owner
authorization and independently authenticated reads.

**NO MERGE / NO DEPLOY / NO PRODUCTION VAULT OR THESIS WRITE.**
**OpenAI API experiment remains PAUSED until the user explicitly resumes.**
