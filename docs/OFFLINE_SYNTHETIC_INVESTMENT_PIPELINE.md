# PR #94 — Synthetic Offline Historical → Thesis → Exception Queue

**Scope:** executable TypeScript orchestration and integration tests on a
synthetic, isolated, locally created SQLite/Markdown/FTS snapshot.
**Not:** production ingestion, autonomous analyst, live note review, real
model inference, owner notification, authorization or a write workflow.

## Call sequence (actual code invoked)

1. Accept a **caller-declared** `synthetic_offline_test_only` fixture with
   the expected physical Markdown manifest, a bounded historical claim,
   keywords, selected exact Thesis line/hash, historical references and
   externally authored/unverified interpretations.
2. `judgeOfflineThesisSemanticDraft` (#89) reruns:
   - `prepareOfflineScopedThesisComparison` (#88), including exact line
     SHA and post-readback physical manifest check
   - `prepareOfflineEvidenceBoundThesisReview` (#87), checking citations
   - `prepareOfflineInvestmentIntelligenceBrief` (#86), calling
     `reviewHistoricalChangeOffline` (#84, structured SQLite metadata)
     and `retrieveOfflineNarrativeEvidence` (#85, indexed/physical prose)
3. `buildOfflineExceptionReviewQueue` (#92) retains all candidate
   findings without granting approval.
4. Independently rerun #84 against the **physically reconciled offline
   snapshot** (not caller-supplied historical priors), check that its
   manifest matches the judge's, and recheck the full snapshot again.
5. Apply conservative priority overrides and return a **redacted
   metadata-only** owner/analyst review candidate queue:
   - A structured contradiction is priority even if another label
     sounded benign (the earlier judge may independently reject it).
   - A duplicate hypothesis that does not match **exact declared**
     same-source/event/period metadata is priority.
   - Source edition changed, event/period differs, incomplete structured
     claims or archived-only context cannot be a safely suppressed
     duplicate.
   - Even an exact metadata match remains in analyst review; nothing
     is silently discarded.
   - Outputs never contain the protected Thesis passage, historical
     excerpt, source URL, notes paths, incoming claim value or arbitrary
     untrusted proposal prose.

## PR #93 relationship

The standalone #93 adapter reclassifies **caller-declared** prior claims,
which is useful for deterministic unit/negative tests but **not** proof
that those claims were read from the physical snapshot. The #94
orchestrator therefore uses the real offline #84 snapshot-scoped read
instead of claiming a #93 flag is independent verification.

## Limits

- An offline snapshot can be physically reconciled and still be an
  incomplete copy of the live Obsidian Vault and legacy sources.
- `fixtureKind` is only a declaration. This function does not independently
  authenticate who created the fixture or authorize protected-data
  disclosure. There is no network or public endpoint for this code.
- The exact Thesis excerpt is rechecked against bytes, **not** evaluated
  for correct business implications; caller/model proposals are untrusted.
- A SHA/URL match does not authenticate a source publisher or financial
  report. Event/published/imported/verified dates remain distinct.
- Narrative FTS and structured metadata search do not establish
  comprehensive semantic coverage, including Thai paraphrases.
- Each batch shares **one incoming structured claim** and a bounded 1–6
  interpretation set. Different incoming claims require independent
  executions. Do not treat this as full multi-event orchestration.
- No real-world owner notification, review UI, API/model scoring, Vault
  mutation, Thesis evolution or production release.

## Synthetic test cases

The new integration tests build isolated indexed Markdown/SQLite/FTS
copies on disk and assert physical evidence/citation checking, equal
metadata duplicate retained, different-period same value, changed
declared source edition, numeric conflict, malicious note/model prose
redaction, stale snapshot rejection, fabricated citation or line hash
rejection, and non-authorization invariants.

Passing CI proves the code and synthetic fixtures behaved as asserted,
not real investment accuracy, source authenticity, actual owner access
permissions, production safety or cross-device sync.

**No Merge. No Deploy. No Production Vault, Thesis or Portfolio Write.**
**OpenAI API testing remains explicitly PAUSED by the owner.**
