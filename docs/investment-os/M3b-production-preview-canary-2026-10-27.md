# M3b Production Connector — Read-only retrieval and fictional Preview canaries

**Observed:** 2026-10-27 (Asia/Bangkok)
**Mode:** Live Production MCP connector read-only + `prepare_canonical_writeback` **PREVIEW ONLY**.
**No Apply. No original document fetch. No note writes. No receipt issued.**

## Production identity checked before tests

- Draft PR #128: head `4ec465553ed851db1a4cc67676fb68e66360c2a9`, `draft:true`, `merged:false`.
- Railway latest successful Production: `71cc4178607d717b403ffd143d3a01bff7c94758` (not M5.5.1 Draft).
- Production `Investment_OS`: 3,414 notes, 0 unindexed; disk level `ok`.
- Actual NoteMesh V2 `read_note` returned the Production Canonical Intake Protocol (2026-10-25). Live `investment_context_pack` returned a bounded MU pack containing `01_Companies/MU.md`, dated MU evidence and research-history paths; a separate INFY context request returned historical coverage/method material but not evidence of an INFY Hub. Retrieval is **lexical, partial and not source-truth verification**.
- Current live Safe Edit `prepare_canonical_writeback` tool descriptor's `researchReview` supports seven familiar prose/translation fields but **does not expose** M5.5.1's optional `claimAssessments`. This is a real connected schema gap, not a local TypeScript test failure.

## Two adversarial fictional canaries — PREVIEW ONLY

Each case was clearly marked `M3b SYNTHETIC PREVIEW ONLY 2026-10-27`, `sourceKind:user_commentary`, `publisher:Fictional fixture`, `originalDocumentAccess:excerpt_only`, entity `MU` solely for existing-Hub routing. These are **not facts about Micron**. The supplied Review prose deliberately asserted unsupported certainty to test the existing gate.

| Case | Synthetic source | Intentionally unsafe Review | Production preview result |
|---|---|---|---|
| `unverified` | Anonymous claim of FY2027 revenue guidance `+20%`; no issuer document | "MU confirmed FY2027 +20%" and certain positive Earnings | `qualityIssues: []` — no Review quality hold |
| `contradiction` | Unsourced FY2027 `+20%` and `-20%` claims with same metric/scope | Selects `+20%` as confirmed, dismisses competing value | `qualityIssues: []` — no Review quality hold |

**Observed preview metadata:**

| Case | Preview plan ID, not a durable receipt | Proposed Source ID | Workflow |
|---|---|---|---|
| `unverified` | `IN-41A94C70B9ABC302` | `IN-41A94C70B9ABC302` | `phase:preview_only`, `workflowStatus:pending_safe_edit` |
| `contradiction` | `IN-4D08D556884C28DE` | `IN-4D08D556884C28DE` | `phase:preview_only`, `workflowStatus:pending_safe_edit` |

Both results reported `writesPerformed:false`, `protectedNotesTouched:false` and `perDeviceSync:unverified`. Each proposed two steps: `source_intake` under `00_Inbox/ChatGPT/` and `canonical_review` under `10_Knowledge/Company Research/`. No preview tokens, authorization tokens, or secret data are preserved in this document.

**Post-preview readback:** all four exact proposed Source/Review paths returned not-found through live `read_note`. Rechecked `get_vault_info`: **3,414 notes, 0 unindexed**. This demonstrates no persisted fictional notes in these target paths, not a full external Obsidian device-Sync attestation.

## Interpretation and safety decision

1. **Reproduced the original semantic weakness on the live Production PREVIEW path:** unsafe confident Reviews were not flagged by the current production quality checker. This is **not** proof that Protected Thesis/Portfolio writes can bypass their separate authorizations; those operations were never requested.
2. **M5.5.1 has not been evaluated in this live connector** because it is Draft/not deployed, and its additional `claimAssessments` field is absent from the connected schema. The present canaries describe the old Production behavior only.
3. **Connected Vault retrieval works in this session**, but says nothing about policy installation in three distinct Micro/Macro/PDF chats or independent real-model consistency. No cross-room real-model trials, blind held-out original-source evaluation or Safe Edit Apply were performed.
4. No Progress Gate can pass on a fictional Preview or offline mock scorer alone. Maintain **NO-GO for retiring existing quality blockers, merging or deploying M5.5.1** until the M3 Chat-Native trusted-policy, observed-room, connector-schema and real source-evidence checks are passed.

### Remaining owner/configuration dependency

The current conversation does not expose a verified administrative or connected ChatGPT Project-room configuration interface that can install/pin M1 policy version `1.0.0` into the trusted instruction layer of each named Micro/Macro/PDF room and return authenticated room-session test transcripts. A model merely echoing the expected SHA is insufficient. This evidence remains **PENDING**, not a silent assumed pass.
