# IOS-ORCH-RI-001 — Source → Existing Canonical Review revision pilot

**Status:** DRAFT / ISOLATED SYNTHETIC ONLY / NO DEPLOY.  
**Task lineage:** IOS-ORCH-RI-001.  
**Parent engineering baseline:** PR #176, commit 732eca73c41237b651c7426b9cb348ab63ca95fe.  
**Candidate:** PR #177; inspect the exact current head/CI before any engineering acceptance.

## Product gap
Seven separately captured appearances may point to fewer underlying economic events. Source-only persistence can be complete while an unselected canonical writer still offers another Review indexed by Intake ID. Receipt/FTS success does **not** establish economic identity, reviewer approval, or future semantic retrieval. The #176 \`existingReview\` binding is only a read-only proposal.

## Bounded implementation
- \`prepare_canonical_review_revision\` consumes the exact existing Review path/SHA/original receipt, every additional Source path/SHA/receipt, a typed analyst-attested event relation, dates, counter-evidence and Draft-only addendum.
- Server reopens the physical indexed Review and each Source, validates their independent Safe Edit receipt/whole-note hash, current status and original Source link. Original text is not rewritten. No issuer, event, or primary truth is inferred from a matching ticker alone.
- **Only** \`added_detail\` with analyst-attested \`PASS\` and \`materiality=low\` is eligible for *synthetic pilot*. Duplicate, correction, contradiction, material or unresolved risk must HOLD; this does not verify the analyst's reasoning or establish a critic.
- Dedicated preview appends a dated Draft evidence section to the **same** Company Review, preserves frontmatter, binds Source links, and records a server-sealed admission bound to actor, full before/after SHA and Source receipts.
- During this isolated pilot, generic Safe Edit cannot update the managed Company Review; the dedicated path requires existing dashboard authenticated-session attestation of the **exact diff**, then single-writer Safe Edit CAS, backup, SHA readback, reindex, resolved Source links, and validation of the original Review append chain.
- \`apply_canonical_review_revision\` must use the original previewToken and expectedHash even on an idempotent written retry; any changed input/actor/source/review binding holds.

## Non-negotiable operational gates
Feature defaults OFF. Pilot requires **all**:
1. \`IOS_C1_REVISION_PILOT=synthetic\` explicitly set by authorized isolated test.
2. Real physical \`DATA_DIR\` under OS temp directory with basename \`ios-revision-pilot-*\`, no symlink.
3. **No** \`RAILWAY_PROJECT_ID\` / \`RAILWAY_SERVICE_ID\`.
4. Existing \`C1_RESEARCH_PILOT\` mode must not be active. This pilot does not loosen C1 add-only guard.
5. Synthetic-only Vault and separate keys/actors; no production or persistent staging mounts, credentials, Source data or real user workflow.

A dashboard session is not proof of human presence, critic independence or a Verified Fact. An OAuth Writer grant is not reviewer authority. All Source/Review trust remains Draft; independentEvidenceIncrement=0, comparator_eligible=false, owner_thesis_authority=false.

## Acceptance evidence and open boundaries
- Draft tests include low-risk Source-only → same Canonical Review addendum, generic-route rejection, absent approval, bad hashes/receipts/issuer, material/contradiction HOLD and CAS drift, plus post-write Source link/receipt-chain checks.
- CI #692 / workflow 43121650920: SUCCESS on commit ee60aee73b679b9593e74088a496fe86a4db81ac, **before** later idempotent/chain-readback strengthening; do not silently assign it to the later head. Reverify latest commit CI.
- No live ChatGPT plugin descriptor/Runtime/OAuth binding, real human review, AMD live Vault Revision, cross-chat retrieval, or device-specific Obsidian Sync proven by this Draft.
- Full Event Identity Gate remains open: unselected legacy writer may still create a second Review; this prototype is **opt-in**, not universal duplicate prevention.
- Only a new, explicitly approved runtime/reviewer/client acceptance can move beyond Draft. No merge, deploy, client refresh, live Vault write, protected Thesis/Evidence/Timeline/Portfolio mutation, or paid infrastructure authorized here.

## Product-first next checkpoint
Close synthetic fixture acceptance for this exact head; independently audit scope/approval/negative cases; then design the mandatory event-decision checkpoint across intake paths without blanket issuer-wide HOLD or hardcoded economic heuristics. Only after authority/client parity should an authorized non-production end-to-end pilot attempt a real revision.

## F1/F2/F3 corrective delta — synthetic pilot only
- Admission version `IOS-REVIEW-REVISION-PILOT-2` requires the dashboard to present **every additional Source's full receipted text**, canonical path, intake ID, whole-note SHA and receipt ID. Its `reviewedEvidenceDigest` binds that surface, actor, operation, before/after hashes and sealed source set to the session approval. Missing/wrong digest cannot approve. Sources and their receipts are rechecked before approval and at the write boundary.
- `issuerBinding=not_verified` is explicit. Neither a source's receipt nor dashboard approval establishes association with the Review's issuer/economic event. A receipted OTHERCO Source must be fully visible to a TESTA reviewer with this warning; it is **not** server-certified as TESTA evidence. Real-use issuer correctness/Product Acceptance remains blocked pending an approved verifiable association contract. This delta does not introduce ticker heuristics or an issuer verification authority.
- Generic `apply_edit` refuses an operation enrolled as a managed revision, even with an approved token and even after removal of the pilot flag. Only dedicated `apply_canonical_review_revision` can consume it. The Safe Edit write boundary also revalidates the original Review Source receipt after the sync pause; bytes/receipt drift refuses before any Review write.
- Identical revision reprepare returns `revision_admission_replay_hold` before rotating its token, expiry or clearing approval. The original unexpired approved token remains usable by dedicated apply; a lost/expired token requires a fresh reviewed proposal, not automatic re-enrollment or journal repair.
- Pending v1 admissions/approvals cannot authorize new writes under v2; no old journal/receipt is rewritten. Already written Source/Review receipts remain readable through the existing append-chain reader. Exact successful v2 retries remain idempotent. The approval endpoint gains a digest only for managed revisions; ordinary Safe Edit/Thesis exact-diff approval is unchanged.
- Regression evidence is mechanical and disposable: OTHERCO visibility, real session-route rendering with simulated authentication, original/additional Source drift, generic/dedicated MCP denial, unchanged reprepare journal, two appends to one Review and fresh-process receipt/index/link readback. This does not establish actual human presence, independent criticism, investment semantics or installed ChatGPT compatibility.
