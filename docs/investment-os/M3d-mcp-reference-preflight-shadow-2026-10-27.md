# M3d — MCP Research Decision v2 reference preflight (DRAFT / SHADOW ONLY)

**Date:** 2026-10-27 (Asia/Bangkok)  
**Status:** Developer candidate on an isolated branch based on Draft PR #128; no Production deployment, Vault write, protected-note edit, PR Merge, or synthetic Apply.

## Problem addressed

Existing `researchDecisionV2Schema` and `preflightResearchDecisionV2` (M2) check exact stored Source/History references and server-side Primary Receipt scope, but M2 did not expose a callable MCP action. A ChatGPT Research Analyst cannot invoke a module that is absent from the connected tool descriptor. The currently connected Production Safe Edit tool remains old and does not expose Draft `claimAssessments`; Project Instructions alone cannot change that.

## Proposed read-only MCP entrypoint

- Tool: `preflight_research_decision_v2`, registered in **Safe Edit MCP** (same existing OAuth `vault:read` + `vault:edit` consent boundary; handler checks `canSafeEdit`).
- Input: strict `researchDecisionV2Schema.shape`, `schemaVersion:2.0.0-shadow`, `policyVersion:1.0.0`, pinned candidate SHA-256 `1abcc97f74181398deb0772c6ddee65a8f46d8ed6dd4bc15f1568bfce9c5b3c0`; this stamp alone is **not** proof of trusted installation.
- Output: `hold_schema`, `hold_references_or_authority`, or `structurally_grounded_shadow_only`, with exact `errors[]`, `warnings[]`, quote-binding statuses and any **server**-validated Primary Receipt keys.
- **No writes:** `writesPerformed:false`, `canWriteProtectedNotes:false`, `investmentTruthVerified:false`, `sourceAuthenticityVerified:false`; no Safe Edit preview token or permission to call Apply is conferred.
- The resolver opens the actual indexed Source note again and checks whole-note SHA, canonical Intake ID/path/type, user-original text digest and exact quote **inside the preserved original-language code fence**. Historical pointers require exact current indexed SHA.
- Forged caller `PEV-*` IDs do not verify: independently resolved exact-scope Primary Evidence Receipt is still required to classify a primary claim as server-verified.
- **Source-first:** an unpersisted Source cannot pass this tool. Regular `prepare_canonical_writeback` can still Preview Source independently; do not treat proposed Source paths, expected hashes, or in-memory previews as already persisted Sources.

## What this does NOT solve

1. An exact quote can be faithfully bound while the LLM draws a false economic inference. This tool does **not** decide whether backlog becomes revenue, a broker PT is issuer guidance, 25bp discussion equals 50bp action, or a source quote entails a forecast. Those remain **LLM Semantic/Evidence Critic** responsibilities with M3 evaluation; the existing M5.5.1 quality blockers are not removed here.
2. The tool does not establish original publisher identity, source authorship or independence. SHA establishes stored bytes, not that an issuer published or confirmed them.
3. PDF page labels without independently accessible bytes are caller-declared and reported as warnings.
4. Connector-client descriptor refresh and an actual trusted M1 policy bootstrap are still **NOT VERIFIED** in Production. The M3d Tool only becomes callable in real Micro/Macro/PDF rooms after an authorized rollout and descriptor refresh.
5. No `apply_canonical_writeback` or `prepare_canonical_writeback` authorization rules were modified. The preflight is a **separate read-only check**, not yet an enforced gate in Apply, and cannot by itself fix Production false passes.

## Test acceptance — isolated temp Vault

- MCP tool listing advertises strict v2 contract and `readOnlyHint:true`.
- A fixture already indexed with correct `source_text_sha256`, current entire note SHA and exact original quote yields only `structurally_grounded_shadow_only`, never Fact Verified, never Write Authorized.
- Wrong Source SHA returns `hold_references_or_authority` with `claim_a:source_note_sha256_mismatch`.
- Forged `PEV-*` and `confirmed` claim return `hold_references_or_authority` with `claim_a:primary_receipt_not_server_validated`.
- Wrong OAuth scope is rejected by the same Safe Edit MCP handler. Physical Source note remains unchanged.

All tests are local-temp fixtures and must not write fictional claims into Production. Before moving this tool into Production, run full GitHub CI and real connector compatibility/security review.

## Safe adoption sequence

1. Freeze exact M3d commit and run lint/typecheck/build/unit/E2E/container/audit on the same build.
2. Include only tested files in **Draft PR #128**, leaving it Draft and not deployed.
3. Before any release, verify compatible connected tool descriptors and actual client-side request bodies; do not rely on schema claims in GitHub alone.
4. Collect real Micro/Macro/PDF LLM semantic Evals and independent actual-source adjudication. Observe the need for a **Source-first** two-stage workflow; never silently allow a Preview-only Source to satisfy an indexed-reference check.
5. On separately approved staging only, test source→preflight→review with real receipts, SHA/readback, FTS, Wikilinks, CAS/replay, and protected-note immutability; no synthetic Apply in Production.

**Decision: SHADOW ONLY / NO-GO for Production.**
