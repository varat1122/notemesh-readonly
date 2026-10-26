# M2 — Research Decision Schema v2 / Source Reference Preflight

**Date:** 2026-10-26 (Asia/Bangkok)
**Status:** Shadow-only implementation on Draft PR #128; **not a Production connector or review-writing path**.
**Policy:** `docs/investment-os/llm-policy/v1.0.0/research-decision-policy.md`; manifest SHA-256 `1abcc97f74181398deb0772c6ddee65a8f46d8ed6dd4bc15f1568bfce9c5b3c0`.

## 1. Implementation

- `src/server/vault/research-decision-v2.ts`: strict Zod `researchDecisionV2Schema`, `preflightResearchDecisionV2`, **default actual-index resolver** `m2VaultReadDeps` and a test-only dependency seam.
- `src/server/vault/research-decision-v2.test.ts`: fixtures and adversarial reference/receipt tests; all synthetic and local, no Production Vault interaction.
- `src/server/vault/research-decision-v2.integration.test.ts`: exercises the **default actual SQLite/FTS + on-disk Source resolver** in an isolated temporary Vault, including stale physical Note SHA and a non-Source note masquerading at a Source path; no Production Vault interaction.
- `src/server/vault/research-policy-contract.test.ts`: extends M1 digest check to bind M2's policy constant to the exact on-disk policy Manifest.
- No changes to registered MCP tool names/schema, `canonical-writeback.ts`, Safe Edit authorization, TypeScript production route, Production Vault or protected-note permission policy.

## 2. Model output vs server computation

| Field or result | Model provides | Backend independently checks | Important boundary |
|---|---|---|---|
| `policyVersion`, `policySha256` | Version/hash stamp as data | Equal to build-pinned contract | A copied hash **does not prove** the ChatGPT trusted instruction layer loaded that policy; real bootstrap is still pending |
| `intakeId`, claim `sourceRefs[]` | Claimed Source path, Intake ID, whole-note SHA and exact quote | Exact canonical Source path, indexed note/FTS presence, physical note readback, frontmatter `type`/ID, declared original text digest, SHA of entire note, quote inside preserved original-language text fence | This proves **reference to stored user material**, not publisher authenticity or claim entailment |
| `sourceRef.documentLocator` | Optional page/table/section label | Bound quote in Source text only; report page/table label as **caller-declared unverified** | PDF page anchors remain unverified; original PDF byte availability separately warned |
| Claim scope | Entity, metric, period, unit, denominator, vintage, selected value, countervalues/attributions | Field bounds, unique local keys; passing quote/identity checks | Financial *comparability* and factual truth are M3 semantic tasks, not regex or Zod checks |
| `event.classification`, `relatedNotes[]` | New/known/correction/contradiction/etc and named prior notes | Exact current path/whole-note SHA/index only; warn on relation lacking a historical pointer | A historical link is not independent source confirmation or a semantic dedup verdict |
| `primaryEvidence` | Requested PEV ID, purported primary URL and value | Calls existing `validatePrimaryEvidenceReceipt` on **entire exact claim scope**; missing/false/mismatched receipt holds | The AI cannot mint or self-attest the PEV; signer issuance still disabled by default |
| `claim.conclusion` | `no_change`, `conditional`, `confirmed` | `confirmed` requires successful **server-side** scoped PEV and cannot coexist with model `epistemicStatus=unresolved` | No automatic Thesis change; `confirmed` means an adjudicated exact source claim, not a portfolio action |
| Preflight output | None | `hold_schema` / `hold_references_or_authority` / `structurally_grounded_shadow_only`, issues/warnings, verified server claim keys | Every outcome has `writesPerformed:false`, `canWriteProtectedNotes:false`, `investmentTruthVerified:false` |

## 3. Practical M2 workflow (no writes)

1. Source Intake is saved first under existing M5.3/M5.4 Safe Edit and independently verified; if not saved, M2 Review preflight **holds** and Source capture remains separately eligible.
2. A future trusted host supplies AI with actual referenced Source IDs, whole-note SHA and relevant historical notes; model constructs a Decision v2 with exact quotations and uncertainty labels.
3. `preflightResearchDecisionV2` parses strict fields, resolves current Source physically and in SQLite, rechecks the preserved original-language code fence and validates any requested primary PEV **on server**, not by string format alone.
4. If structurally grounded, M3 **still** runs Semantic/Causal/Citation Evals and optional critic. No preflight result is a publish authorization, factual truth verdict or proof of complete historical retrieval.
5. In M5, a separately reviewed adapter may map accepted decisions to an existing compatible `researchReview` wire payload and receive real Safe Edit Preview/Apply receipts. **There is no such adapter or connector registration in M2.**

## 4. Adversarial coverage and intentionally unresolved risks

Cases: matched Source `+20%` versus `-20%`; requested `confirmed` without attestation; fabricated but format-valid `PEV-*`; swapped Intake ID; false whole-note SHA; unsupported quote; quote only in non-source commentary; false stored-text digest; missing indexed Source; stale/mismatched historical path; invalid fiscal event date; unauthorized request field; caller-declared PDF page and missing original bytes; duplicate local Claim key; known good test verifier vs invalid server receipt.

**Not solved in M2:** maliciously convincing source text, issuer-authenticity, quote taken out of context, financial arithmetic/units beyond schema, period-specific cross-source contradiction, missed counterevidence, correct broker forecast vintage, whether `+20%` Guidance actually exists, whether a declaration is paraphrased as fact, and true independence of multiple publications. This is why M3 must use independent original documents, frozen gold labels and model/critic trials before changing M5.5.1 semantic hard blockers.

**Test seam restriction:** `M2ReadDeps` injection exists so isolated tests can simulate indexed notes and valid/invalid server attestations without any Vault write. An actual runtime caller must use `m2VaultReadDeps`, not a model-supplied implementation. JSON payloads cannot provide functions; nevertheless do not expose a resolver argument through a future MCP tool.

## 5. Acceptance and release status

- [x] Decision v2 schema, exact indexed Source/quote/hash validation, historical path binding and default server PEV check.
- [x] Independent Source capture vs Review hold; no automatic authority to modify protected content.
- [x] Adversarial tests including forged PEV and stale/fictional citations, no synthetic Apply.
- [x] Real default index/readback adapter checked against synthetic indexed Source fixtures on a **temporary local Vault**.
- [x] **Final local verification, 2026-10-26:** `pnpm run build` exit 0 (local prerender warning: `ENCRYPTION_KEY` unavailable); `pnpm run typecheck` and `pnpm run lint` exit 0; post-build full Vitest **113/113 files, 1,519/1,519 tests pass**. One earlier full-suite attempt correctly refused stale pre-build HTTP artifacts; it is superseded by the passing post-build run.
- [ ] Actual model-generated decisions under a trusted verified policy bootstrap (M3).
- [ ] Semantic entailment, counterevidence, chronologies and false-hold Evals on independently labeled originals (M3).
- [ ] Production Safe Edit descriptor/schema compatibility and real E2E Source/Review/FTS/Wikilinks (M5).
- [ ] Controlled merge/deploy and Production synthetic **Preview Only** (M6).

**Decision:** Retain Draft PR status, existing M5.5.1 behavior and default-disabled primary issuance; do not activate or publish a claimed verified fact based merely on successful M2 structural preflight.
