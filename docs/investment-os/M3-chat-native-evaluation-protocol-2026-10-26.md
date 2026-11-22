# M3b — Chat-Native shadow protocol for Micro, Macro and PDF

**Date:** 2026-10-26 (Asia/Bangkok)
**State:** Implemented OFFLINE handoff/scorer on Draft PR #128; actual ChatGPT-room trials, trusted policy bootstrap and connected-tool E2E **PENDING**.
**Production:** No merge, deploy, synthetic Apply, Source write or Review write authorized by this document.

## Research architecture that the test must preserve

1. User supplies Micro/Macro/PDF news or broker excerpts in a **ChatGPT room**. The ChatGPT LLM's first reading is provisional.
2. ChatGPT retrieves relevant original/historical evidence from the connected Production NoteMesh Vault, distinguishing indexed candidate matches from verified source truth. Read actual evidence and counterevidence; avoid duplicate thesis weight.
3. **The same ChatGPT research engine** applies the pinned Canonical Research Decision Framework to the combined input and retrieved context; optional bounded critic pass for material conflicts. This requires **no additional OpenAI/LLM inference API** for routine ChatGPT analysis.
4. ChatGPT requests non-protected Source + Canonical Research Review from authorized Safe Edit connector. The server—not model prose—enforces Source identity, attachment integrity when applicable, exact citation/Hub paths, scope and CAS, real receipt, SHA-256, readback, FTS/Search Index, Wikilinks and protected-write rules.
5. In future, Quant/Python models, outside analysts and market/portfolio systems produce independently versioned findings/signals that the Decision Engine can consume alongside Vault research. Those are **not** collapsed into a single LLM opinion; the future Decision/Portfolio permissions remain separate. No Quant engine is introduced by M3.

## Stage A — Offline fictional semantic comparison (implemented)

Run locally on the Draft branch, in a shell that is **not** Railway/CI:

```bash
node --experimental-strip-types scripts/run-m3-shadow-baseline.mjs --baseline-only
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --export-room=micro
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --export-room=macro
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --export-room=pdf
```

- Export is a JSON envelope containing `protocol`, room, M1 policy version/hash, immutable per-room `fixtureSha256`, and **only fictional input cases** (source, synthetic history, proposed Review). Hidden fixture gold labels and expected citations are not exported. This is a handoff for the person evaluating within each ChatGPT room, **not a model call**.
- First install/pin the exact M1 research policy in the ChatGPT room's actually **trusted instruction configuration** through an authorized mechanism, independently validate the bytes/version/hash, and record how that was done. Merely pasting repo policy as user/source text, or having the LLM repeat a hash, is **not** a verified trusted bootstrap.
- Submit the room's fictional bundle as **test data**, asking ChatGPT to judge each proposed Review using only `sources[]` and `history[]`, classify it as `accept_qualified` or `hold_unsupported`, cite the observed Source/History IDs, explain Thai rationale and missing evidence. Model-output format is `m3ShadowJudgmentSchema` in `src/server/vault/m3-shadow-evaluator.ts`. **Never** instruct a model to edit the Vault or treat a forged PEV ID as independent verification.
- Collect one complete observed judgment set per room and trial. Because the room output is copied by an operator, its provenance is **manually reported and not authenticated by the offline scorer**. Keep ChatGPT transcript metadata separately and label `policy_bootstrap_unverified` whenever trust-level configuration cannot be proved.
- Submit JSON on stdin using the following envelope (the `judgments[]` array must contain **all and only** that room's cases):

```json
{
  "protocol":"m3-chat-native-v1",
  "room":"micro",
  "policyVersion":"1.0.0",
  "policySha256":"1abcc97f74181398deb0772c6ddee65a8f46d8ed6dd4bc15f1568bfce9c5b3c0",
  "fixtureSha256":"<copy exact export value>",
  "provenance":"manually_copied_chatgpt_room_output_unverified",
  "judgments":[]
}
```

The above is a **shape example only** and the empty array is intentionally rejected; never treat it as a passing result. Score an actual complete submission with:

```bash
node --experimental-strip-types scripts/run-m3-chat-shadow.mjs --score-stdin < submission.json
```

The scorer has strict schema and case/room/hash checks and summarizes critical false verified, false hold, invented/missing citations and unsupported Primary claim. It never writes any files, reads a user Vault or authenticates ChatGPT model identity. A fictional test has **no actual server-issued Primary Receipt**; `confirmed`/`verified_primary` is an unsupported promotion. Mock/fixture-oracle unit tests validate the **scorer only**, not actual ChatGPT reliability. A manually reported "20/20" is not Production release evidence without genuine source adjudication and trusted execution evidence.

## Stage B — Real ChatGPT room + read-only Vault retrieval (PENDING)

- For Micro, Macro and PDF separately, verify actual connected NoteMesh tools are present, permission-scoped and return current Production source/Review/context (do not assert a full-history search is exhaustive).
- Use **real, independently checkable Source excerpts** and relevant historical counterevidence with as-of timestamps. No fake material entity, fictional index path or synthetic Source goes to the Production Vault.
- Validate the model correctly distinguishes Source vs issuer fact; duplicate vs independent source; broker forecasts vs management Guidance; macro scenario vs policy action; time vintage; order vs Revenue/FCF; and cautious no-change vs false hold.
- Record retrieval path/ID/date, whether bytes and links were actually accessible, policy bootstrap status, model version if exposed, transcript time, result and independent reviewer label. A case with inaccessible original evidence is explicitly `unresolved`, never assumed correct.
- Independently adjudicated held-out real cases and repeated room trials are required before changing any active M5.5.1 semantic gate.

## Stage C — Connected Safe Edit Preview Only + release gates (PENDING)

- Refresh/check Production connector descriptor first; do not send unsupported `claimAssessments` or new M2-only fields into an older schema.
- On **fictional** adversarial tests use **Preview Only**; no Apply, no Source record, no Company Hub fabrication and no protected notes. Preview must not be described as durable Save.
- On separately approved non-fictional staging write tests: Source before Review; validate real receipt, SHA-256, canonical readback, FTS/Search Index, target-existence of Wikilinks, CAS/replay/idempotency, and protected-path immutability. This document does **not** authorize these writes.
- Shadow-eval results must not cause M4 gate retirement or M6 merge/deploy without security regression, measured real cases, rollback, exact connector schema and authorized release checks.

## Acceptance status

| Check | State |
|---|---|
| 20 fictional scenarios, unchanged legacy gate baseline, scorer | Implemented; deterministic tests only |
| API-free per-room fixture handoff and strict offline scoring | Implemented on Draft branch; no actual room verdict collected |
| Trusted M1 policy configured in real three ChatGPT rooms | **PENDING** |
| Observed ChatGPT-room trials with genuine saved transcripts | **PENDING** |
| Independent real original-source gold labels | **PENDING** |
| Read-only Production NoteMesh retrieval in this session | **OBSERVED 2026-10-27**; bounded lexical context only |
| Live Safe Edit descriptor parity for M5.5.1 `claimAssessments` | **MISMATCH**: field absent; NO-GO |
| Synthetic Preview Only in Production | **OBSERVED 2026-10-27**: two unsafe fictional Reviews had `qualityIssues:[]`; **no Apply, no writes** |
| Production Source/Review integrity E2E and authorized merge/deploy | **PENDING** |

**NO-GO:** Neither scripted fixture output nor offline scoring constitutes AI evaluation success or permission to change Production.

Actual connected-tool observations and post-preview Vault path readbacks: [M3b Production Canary — 2026-10-27](./M3b-production-preview-canary-2026-10-27.md).
