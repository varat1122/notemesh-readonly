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

## Source/Issuer and Event gate successor (Semantic Contract 1.0.0)

This section supersedes the opt-in-only admission limitation **inside the same
isolated revision pilot**. PR #177 at `5736f02dd485c28f6239e1732fd7136f93e82671`
remains the unchanged parent. It does not enable any persistent or live instance.
Design source: CHAT/ORCH Semantic Contract v1.0.0, SHA-256
`161519e3361b0b2dd87907f146ad6c4214278f55e4ed64cd2e10780000adacbe`.
No Master, issuer mapping, economic ontology, schema migration or provider added.

| Boundary | Existing mechanism reused | Successor behavior / remaining boundary |
|---|---|---|
| Received Source | Canonical intake ID, exact text SHA, Safe Edit receipt, physical/index/FTS readback | Source-first capture remains possible; receipt authenticates received bytes, not publisher or issuer truth. |
| Issuer | Indexed Hub resolution and exact Hub/context hash | Ambiguous/unresolved/readback failure HOLD; no ADR/DR/listing equivalence inferred. |
| Historical scope | Bounded `judgeScopeWitness` / `judgeScopeCurrent` and exact receipted self-write exclusions | Ordered selection + current bytes/receipt/FTS rechecked at admission and inside Safe Edit lock. Unselected unrelated changes remain allowed. Legacy unreceipted Review is explicitly historical/unverified, never a fabricated Source/Review binding. Selected Generated Claims must pass the existing receipt/Source/anchor/index/link reader; invalid bindings HOLD instead of legacy fallback. |
| Semantic result | Chat-first typed attestation, exact UTF-16 citation verifier | `IOS-RI001-SOURCE-EVENT-SEMANTIC-1.0.0` binds per-Source slice and issuer/event decision. `documentRelation=multi_issuer` requires per-issuer slices. No backend LLM, semantic truth, human presence or independent critic is authenticated. |
| Create | Existing canonical prepare/apply | Explicit `new_event/create_new_review`, complete assessed bounded scope and all existing gates required. Missing `existingReview` never proves new event. Normal eligible new events are not blocked merely because another Review exists for the issuer. |
| Revise | Dedicated revision prepare/apply and append-chain reader | Exact target Review receipt/SHA and `added_detail/append_revision/materiality=low`, fresh Source/Event assessment and dashboard approval required. |
| Other dispositions | Source-only + existing read-only reuse proposal | Duplicate never creates another Review. Correction, contradiction, unresolved, unknown/not-related issuer remain HOLD/Source-only. Automatic durable duplicate-link mutation is not implemented; an explicit revision proposal cannot relabel a duplicate as added detail. |
| Reviewer | Existing authenticated dashboard approval | Full Sources/history/assessment and exact entire bundle are visible. Every pending non-Source target needs exact diff/evidence approval before the first non-Source write. Approval is a session attestation, not demonstrated human understanding. |
| Generic/raw routes | Existing Safe Edit and raw-writer boundaries | Generic company Review preview/apply and managed Claim subset cannot bypass assessment. Raw create/update/disk/importer routes are refused in the pilot; use canonical Source capture. Unsupported routes fail closed rather than obtain new rights. |
| Legacy outside pilot | Existing permissions and canonical workflows | Unenrolled legacy instances are not silently opted into this new executable policy. Previously enrolled target gates remain restrictive. No runtime deployment is authorized. |

### Exact handoff and lifecycle
1. Preserve the Source using existing canonical `captureOnly` (no analysis/claims).
2. Call Writer MCP `prepare_source_event_packet` with `kind=create` plus canonical
   input, or `kind=revise` plus exact revision input. This reads real Sources and
   at most eight selected historical notes, with a 250,000-character packet cap.
3. Obtain `source_event_result_contract`; inspect the untrusted received text,
   selected History and proposed content. Return concise evidence-grounded
   issuer/event rationale, exact nonblank SHA/UTF-16 references, all required
   checks and coverage limitations via `sourceEvent={packet,result}` on the
   **unchanged** canonical/revision input. A ticker, confidence or high-level
   action label alone is insufficient.
4. Server authenticates HMAC/actor/packet/result, selected scope, Source receipts,
   policy, 30-minute expiry and action eligibility. Existing Research Judge /
   RISK-1.1 decisions still apply independently; prior HOLD/FAIL cannot become
   an unjudged revision fallback. No opt-in Judge new-event rule is relaxed.
5. Review every exact pending non-Source diff in the authenticated dashboard;
   apply through its dedicated canonical route. Exact operation ID, actor,
   payload, approved evidence digest, token, CAS and final scope are rechecked.

The packet projects only server-generated `analysis_created_at` as pending;
all analyst prose, claims, cutoff and semantic input stay exact. Actual Preview
clock/operation/content hashes are then server-bound in the sealed enrollment
and dashboard approval, preserving delayed assessment/authorization without
backdating. The original chronology verifier remains authoritative.

Matching authenticated HOLD/FAIL is recorded before outer MCP schema/token or
planner rejection; journal/lock failures are surfaced, not silently acknowledged.
An exact withdrawn envelope cannot re-enable PASS. Recovery requires a strictly
later fresh envelope and fresh bound assessment/approval. Old/other-actor packets
cannot revoke a newer enrollment. Gate history is capped at 128 entries / 32 MB;
quota never suppresses withdrawal of an already granted PASS. Repeated matching
restrictions do not append unlimited copies. No journal/receipt is rewritten.

The receipt reader validates the final approval against the last real Preview
(or token rotation) and sole written event using row order and timestamps. This
supports legitimate fresh assessment of identical canonical bytes, where the
operation ID stays content-derived. It still rejects corrupt hash/chronology;
identical approval retry is idempotent. Historical single-approval receipts keep
working. Pending old pilot approvals lacking Source/Event binding require a new
packet and exact evidence approval; existing written receipts stay readable.

### Explicit partial boundaries / acceptance gates
- SE08: exact issuer slices and target-swap denial work. Creating a **second new
  issuer Review** from an already single-issuer canonical Source still HOLDs at
  the existing Source/planner scope boundary. This delta does not rewrite that
  Source's subject, manufacture another origin, or widen Source-reuse authority.
  Broader multi-issuer new-Review decomposition needs a separately reviewed
  compatible Source-scope proposal. Do not report full SE08 product acceptance.
- Semantic association/event equivalence can still be wrong if an analyst and
  reviewer attest wrong reasoning. The seal authenticates the supplied scope,
  not correctness. SE fixtures simulate decisions to test enforcement only;
  independent actual semantic evaluation remains pending for every scenario.
- MCP server descriptors expose the new fields/tools under existing
  `vault:read vault:edit` OAuth requirements. Installed ChatGPT descriptor refresh,
  endpoint/audience binding, actual reviewer session and fresh-room retrieval
  are untested and require separate authorization. InMemoryTransport is not
  evidence of an installed client connection.
- This is one cooperative single-writer disposable process/instance, not a
  guarantee against unmanaged filesystem writers, key/DB administrators,
  renamed/moved instance activation or rollback to old binaries. Existing
  reserved-path/flag/Railway restrictions remain; no operational cutover is
  authorized. Existing unindexed journal readers remain a scaling limitation;
  this patch does not cache mutable receipt authority.
- Delta review should focus on all create/revision/raw routes, whole-bundle
  approval, the server-clock projection, final receipt approval chronology,
  terminal-state recovery and context freshness. Reuse unaffected accepted
  D1/D2/F1/F2/RISK evidence; CI is not independent or runtime acceptance.
