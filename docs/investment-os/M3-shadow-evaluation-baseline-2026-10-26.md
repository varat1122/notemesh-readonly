# M3 — Synthetic baseline and corrected Chat-Native evaluation track

**Date:** 2026-10-26 (Asia/Bangkok)
**State:** M3a deterministic baseline + M3b offline Chat-Native handoff/scorer implemented; **no actual ChatGPT-room evaluation completed**.
**Production:** Draft PR #128 only. **No merge, deploy, Preview-to-Apply, or Production Vault write**.

## Why the evaluation track changed

The routine workflow already uses the **ChatGPT LLM in Micro/Macro/PDF** to interpret the submitted news, retrieve NoteMesh/Vault history and apply the common investment research policy. An additional separately billed LLM inference API would duplicate a role rather than test that actual ChatGPT workflow. The previous default-disabled developer-only Responses API proof of concept (`m3-shadow-openai.ts`, `run-m3-live-shadow.mjs`, matching mock tests) has therefore been **removed from this Draft branch**. No live API calls had been made. This does **not** remove the connected NoteMesh/Safe Edit APIs, or the future interfaces for Quant/Python models and analyst/decision-system inputs.

## M3a: What was actually measured

- Frozen **20 developer-authored, expressly fictional** Micro/Macro/PDF cases: 11 unsafe proposed Reviews, nine sufficiently qualified/attributed Reviews. Their labels are **not independently adjudicated real issuer facts** and not a representative statistical sample.
- `src/server/vault/m3-shadow-evaluator.ts` invokes unchanged M5.5.1 `validateResearchM55` against each fictional proposal. The scorer also checks structured model-like judgments for critical false acceptance, false holds, citations and unsupported Primary-verified status. Its injected-callback test is a **mock contract test only**, not an actual model run.
- `node --experimental-strip-types scripts/run-m3-shadow-baseline.mjs --baseline-only` is offline and safe: no models, Vault data, network or files written.

| Observed on the fixed fictional fixtures | Count |
|---|---:|
| Total / unsafe / qualified-safe | 20 / 11 / 9 |
| M5.5.1 allowed / held | 15 / 5 |
| **Critical false acceptance of unsafe proposed Reviews** | **6** |
| False holds of nine qualified Reviews | 0 |
| Actual ChatGPT room trials or provider-model calls | **0** |

Six old-gate false accepts on this corpus: planned CapEx cast as earned Revenue; broker PT mistaken for company Guidance; unsupported Price In; two reposts mistaken for independent sources; hypothetical 25bp macro discussion rewritten as actual 50bp cut; and instructions embedded in untrusted source text repeated as a Thesis-change directive. These numbers are **semantic gate proposal acceptance**, **not** proof that a protected write would bypass separate backend authorization.

The existing M5.5.1 gate held the other four unsafe claim scenarios and an overclaimed unread broker PDF. It allowed all nine deliberately qualified Review fixtures. No conclusion about real-world sensitivity or false-hold prevalence can be drawn from 20 author-selected items.

## M3b: Chat-Native evaluation interface implemented, actual model trial pending

New API-free, local-only tool: `scripts/run-m3-chat-shadow.mjs`.

- `--export-room=micro|macro|pdf` emits only that room's frozen fictional case inputs, exact M1 policy identity/hash and a case-bundle digest; no hidden verdict/gold labels are shown.
- `--score-stdin` validates a manually copied ChatGPT-room response against exact room/case IDs, policy and fixture SHA-256; scores false verified, false hold, missing/invented citations and unsupported claim of primary verification. Accepts only a complete per-room set, **never writes to Vault**, and does not claim model, transcript or policy installation authenticity.
- Strict Zod contract and unit tests cover digest/room/ID swaps, missing/duplicate cases, fake receipt promotions and cross-room contamination. It uses no new MCP fields or production connector actions.

The evaluation procedure, raw submission shape, three-room trusted policy bootstrap, real-context read-only E2E, Preview Only and quantified release barriers are documented in [M3 Chat-Native Evaluation Protocol](./M3-chat-native-evaluation-protocol-2026-10-26.md).

## Explicit blockers

- [x] Fixed fictional cases, deterministic legacy baseline and untrusted mock scorer.
- [x] API-free ChatGPT-room fixture export + manual-observation scorer.
- [ ] Actual results from independent ChatGPT room sessions (Micro, Macro, PDF), with authenticated transcript provenance and repeated trials.
- [ ] Confirm M1 trusted policy was actually loaded at the correct trust level; a model repeating the policy hash is not sufficient.
- [ ] Independently labeled held-out original-source cases, bounded retrieval and counter-evidence coverage.
- [ ] Production-connected read-only NoteMesh retrieval, actual Safe Edit connector schema parity, synthetic **Preview Only** and authorized real staging E2E with SHA/readback/FTS/Wikilinks.
- [ ] Security regression, verified rollback and release authorization before M4 gate retirement/M6 Merge/Deploy.

**GO/NO-GO: NO-GO for any Production semantic-gate cutover.** The research LLM owns interpretive judgments in the proposed architecture; the server still owns actual evidence binding and write authority. Quant/Python and analyst contributors remain future first-class producers as required by the Master Blueprint.
