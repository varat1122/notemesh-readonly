# PR #76 — Evidence-Gated Human Review & Detached Safe Edit Proposal (NO PROD)

Development-only, offline, **pure** module:
`src/server/vault/evidence-gated-review-proposal.ts` exports
`prepareEvidenceGatedReviewProposal(input)`.

## Deliberate architectural separation

- PR #70's `getLegacyReviewDossier` verifies selected **live** note/index equality in its particular environment.
- PR #71's `prepareLegacyReviewDecision` accepts a caller-selected human review worksheet, not authenticated owner approval.
- PR #72–#73 review queue fingerprint covers **indexed** SQLite note versions and links, NOT immutable physical bytes.
- PR #74's `verifyOfflineSnapshotCoverage` reconciles physical Markdown with SQLite in a **pre-captured isolated copy**. Its content manifest is not a signed archive identity.
- PR #75's `verifyOfflineSourceArchiveCoverage` reconciles **registered** stored source blobs with indexed explicit locators; aggregate status and hash matches do not prove issuer identity or an individual claim.
- PR #76 accepts those *separately collected* assertions as an in-memory input contract. It does not call their live readers, conflate their environments, authenticate supplied receipts, or grant an approval. **No MCP/RPC/HTTP endpoint, registered tool, Safe Edit Apply, privileged capability, filesystem read/write, or production integration was added.**

## Offline operator sequence — none of these steps has been run on Production

1. Separately obtain a consistent authorized snapshot in a segregated location. Never use Railway's live `DATA_DIR` or a live production Vault. PR #74 and #75 do not create this snapshot.
2. Audit the **same detached copy** with PR #74 then PR #75. Stop on any Markdown coverage mismatch, archive integrity problem, unregistered URL/hash, or bad full-document hash (including unquoted YAML number coercion).
3. Independently read the exact target note from that same detached copy and record its SHA-256, index mtime/size, index-only fingerprint, and PR #74 manifest. Check versions before any preview. The pure function checks these *provided* equalities but does not itself perform trusted readback.
4. Supply **one** declared source URL, text-typed full-original SHA-256 and an individually inspected revision receipt whose stored bytes were actually checked. Never use a source excerpt hash as a whole-file hash. Preserve event date, publisher time, import time and verification time separately; use `null` when unknown.
5. For structured registers, pass exact claim ID, entity, period, metric, unit and literal value; for legacy narrative, pass `claim: null` rather than invent fields. Check against previous source-family/event/revision; duplicate imports do not constitute independent confirmations.
6. Provide reviewer classification, bounded reason and a unique, plain, exact body line to replace. Do not use a YAML, code block, duplicate or ambiguous anchor. The output may contain a bounded one-line diff and computed before/after SHA-256 **only if every input gate is satisfied**.
7. Treat the generated diff as a **draft not saved or owner-approved**. It is never a Safe Edit operation. Future authenticated owner approval and a separately authorized Safe Edit preview/apply with fresh version checks are out of scope.

## Results

- `hold`: mismatched note/index/snapshot/source, invalid hash, protected note, wrong source revision, ambiguous patch, or another hard stop. No preview.
- `human_review_required`: unresolved chronology, legacy narrative, claimed but unauthenticated owner approval, unverified reviewer identity, duplication/contradiction/correction or other manual claim-level work. No preview.
- `read_only_proposal_ready`: exact detached text and caller-supplied receipts meet *internal* checks; a bounded one-line diff and proposed hash are computed in memory. **NOT permission to edit, not claim verification, not approval.**

Protected: `05_Thesis/`, `06_Portfolio/`, `07_Sources/`, `09_Templates/`, source-archive, and paths named Current Thesis, Evidence Register or Portfolio. This development API handles only historical analysis/review roles; all other uses are held.

Never treat `reviewerAuthenticated: true` or `ownerApprovalClaimed: true` supplied by an arbitrary caller as an authentication service. The boolean only changes *review planning* status; `reviewerAuthenticationIndependentlyVerified` and `ownerApprovalGranted` remain false for every output. The proposal contains no write mechanism.

Every output retains false for publisher authenticity, source independence verification, investment claim verification, immutable snapshot acceptance, DR acceptance, owner approval, auto-write, auto-thesis update, and Vault modification.

**Tests:** `pnpm test -- src/server/vault/evidence-gated-review-proposal.test.ts` uses synthetic strings/digests only. Normal CI must also pass lint, typecheck, build, integration, E2E, image and audit. No real snapshot, original publisher verification, off-server restore, Desktop/Mobile sync acceptance or Production readiness is established by these tests.

**Known remaining gap:** A future separately reviewed **offline source-specific evidence adapter** may bind individual receipt readback and snapshot identity using trusted input construction; this pure proposal intentionally cannot assert that the caller's attestation is genuine. Live Safe Edit ownership/audit design and any deployment remain independent, explicitly authorized milestones.
