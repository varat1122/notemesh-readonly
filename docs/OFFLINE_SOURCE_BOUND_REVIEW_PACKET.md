# PR #78 — Offline Source-Bound Evidence Packet (NO PROD)

This is the next safe handoff after PR #76's offline human review worksheet
and PR #77's pure detached exact-diff proposal. This branch introduces
prepareOfflineBoundEvidenceProposal in
src/server/vault/offline-bound-evidence-proposal.ts.

## Why it exists

PR #77 can validate equalities of *supplied* note SHA-256, index
fingerprint, physical manifest and original-byte receipt, but it cannot
know whether the caller supplied genuine measurements. PR #78 **derives**
the values from an already-captured, segregated and internally consistent
Vault + SQLite + source-archive copy. It does not create that copy, import
new originals, verify issuer authenticity or accept a production backup.

## Operator contract

1. Use an explicitly authorized existing, detached snapshot rooted at an
   absolute directory with vault/, app.sqlite and registered archive bytes.
   Do NOT pass Railway or live DATA_DIR. No production copy/capture here.
2. Select exactly one nonprotected historical/review Markdown path and
   supply its expected SHA-256 from a separate prior read.
3. Choose a human worksheet action, source/event relationship, bounded
   review rationale and one proposed before/after line. These choices are
   **unverified assertions**, not a reviewer identity or owner approval.
4. The bridge runs PR #76's selected exact-note worksheet and PR #75's
   archive integrity scan (which requires PR #74's physical/SQLite checks).
   It separately obtains PR #74's physical Markdown content manifest.
5. Opens current exact note and one declared registered original blob in
   read-only descriptor/no-follow mode; checks fstat before/after,
   SHA-256, size, indexed mtime/frontmatter, matched receipt revision,
   registered source key and SHA-256. A second readback and SQLite
   fingerprint check reject observed concurrent changes.
6. Constructs PR #77 input with hashes, record revision, source type and
   separate event/publication/import/verification fields from actual
   indexed-and-physically-reconciled Markdown metadata. Structured claim
   fields are included **only** when a single complete claim is present.
   Legacy narratives keep claim=null.
7. Reviewer authentication is explicitly FALSE; no offline identity
   provider has verified the actor. Even if byte checks pass, the result
   remains human_review_required, and no diff/preview is emitted.

There is deliberately NO HTTP/MCP endpoint, no Safe Edit invocation,
no source capture, no automatic proposal export, no Vault write and no
production deployment. Input hashes are selectors and expectations,
never permissions.

## Independent boundaries

- The offline index digest is
  isolated_sqlite_note_rows_and_links_not_pr73_live_queue. It is
  **different from** the priority-scoped live index fingerprint in #73.
  Neither is proof of an immutable snapshot.
- The PR #74 content manifest is an internal Markdown reconciliation
  digest, not an externally signed physical backup identity.
- Original source registry and SHA-256 checks prove integrity of stored
  bytes inside the supplied copy, **not publisher identity, source
  independence, claim values/period/units or external corroboration**.
- The archive may be only partially populated. Passing a specific receipt
  does not establish full source completeness, backup safety or DR.
- Rechecks catch changes observed during the call, but do not make
  an independently immutable filesystem or a guaranteed atomic capture.
- A captured URL, digest, operator label or metadata stating
  verified_against_primary does not turn an archived ChatGPT analysis into
  primary evidence.
- Event date is never inferred from publication, capture or import date;
  unknown fields remain null. Same-event repeat imports are not additional
  independent evidence.
- Paths in 05_Thesis/, 06_Portfolio/, 07_Sources/, templates, archived AI,
  Current Thesis and Evidence Registers are not eligible for this adapter.
- Returned payload includes bounded references and counts, not original
  archive content or full note prose. Exact diff remains null.

## Required flags

ownerApprovalGranted=false; reviewerAuthenticationIndependentlyVerified=false;
publisherAuthenticityVerified=false; investmentClaimFactsVerified=false;
originalSourceIndependenceVerified=false; immutableSnapshotVerified=false;
disasterRecoveryAccepted=false; canAutoWrite=false;
canAutoUpdateThesis=false; vaultModified=false.

## Development QA

Synthetic fixtures exercise exact correct readback, missing chronology,
missing/altered source bytes, mismatched note hash/index, YAML numeric hash
coercion, protected paths, nonindependent sources, live/Railway refusal,
unmatched edit anchor and no mutation. No actual Production Vault is used.

The next **separately authorized** milestone would be an offline human
identity and approval workflow with signed, expiry-scoped review records.
Do not treat it as permission to enable Safe Edit or any production write.
