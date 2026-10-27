# ADR-LLM-001 — Investment research semantics versus evidence infrastructure

- **Date:** 2026-10-26 (Asia/Bangkok)
- **Decision status:** **Proposed** — M0 documented, M3 independent shadow evaluation required before cutover
- **Applies to:** Investment_OS ChatGPT Micro/Macro/PDF + NoteMesh M5.3–M5.6, extending M5.5.1 Draft PR #128
- **Related audit:** [M0 Boundary Audit](./M0-llm-native-boundary-audit-2026-10-26.md)

## Context

Two original synthetic preview tests showed dangerous semantic false acceptance: unverified guidance described as verified, and contradictory illustrative `+20%` vs `-20%` guidance treated as a resolved positive conclusion. The draft M5.5.1 improves observable coverage with regex and exact-scope primary receipts but cannot reliably decide the economics, provenance and temporality of arbitrary natural language. Maintaining an expanding financial regex rulebook inside the writer would couple product judgment to server release cadence, introduce false holds, and preserve blind spots. Owner delegated ordinary investment analysis decisions to the AI framework, with discussion/challenge after delivery rather than routine manual per-claim approval.

## Decision (proposed, *not* activated)

Adopt a **versioned LLM-Native Canonical Research Decision Framework** as the owner of research semantics and an optional separate evidence critic for materially high-risk assertions. Keep NoteMesh a **thin but strict trust and knowledge graph infrastructure**: immutable source/receipt identity, source-byte integrity, actual indexed historical retrieval, Hub and Wikilink identity, path/scope/actor authorization, protected-note policy, Safe Edit CAS, audit and readback. Backend may provide bounded candidate matches and diagnostics but must label them provisional; it is not a natural-language investment adjudicator.

The model may independently publish an appropriately attributed `unresolved`, `no_change` or `conditional` Review subject to normal Safe Edit preview/apply, without pretending there is an official verification receipt. `verified_primary` and server-confirmed exact-claim status **require** an independently valid server-side claim-scope attestation. The model **cannot** create its own attestation, elevate user-entered IDs, invent independent reviewers, change protected Thesis/Timeline/Portfolio, or turn its confidence score into proof.

This decision is a **semantic ownership proposal**, not permission to bypass established hard gates. The existing M5.5.1 blocking checks remain in force until shadow testing and connector compatibility pass. The proposed policy must be delivered through a trusted application/developer configuration or versioned, hash-verified bootstrap; retrieved external PDFs/notes are lower-trust evidence and cannot supersede it.

### Scope: ChatGPT research now; multi-producer investment intelligence later

The owner's confirmed workflow starts in the **existing ChatGPT Micro/Macro/PDF rooms**: ChatGPT interprets user input, retrieves NoteMesh/Vault history, reasons under a versioned policy, then submits Source and Canonical Review through existing authorized tools. A second separately billed/provider-hosted LLM API is **not a dependency** of that workflow. API/MCP boundaries still exist for retrieval, storage, authorization and eventually external machine integration; "no extra LLM inference API" does **not** mean "no machine interfaces".

This research path must **not** become the complete or exclusive investment decision architecture. The Master Blueprint's eventual Quant/Python jobs, market and portfolio data engines, additional AI/human analysts, Investment Committee and risk engines must be able to contribute distinct, versioned findings. Store or reference each contribution with its producer identity, methodology/code/model version, parameters, dataset/input snapshot, observation/as-of timestamp, horizon, expiry, supporting Source/Run IDs and evidence status. Deterministic Quant computations remain executable, testable calculations; ChatGPT may interpret them but must not replace backtesting or portfolio reconciliation with prose.

The knowledge graph connects Source → Claim → Research Review → Quant Result/Signal → Candidate Decision using **typed relations and provenance**, not AI-authored filename guesses or implicit agreement. Different analysts/models do not independently verify an issuer fact merely by echoing the same Source. Future decision and portfolio interfaces need separate risk, authorization and execution policies; **no current routine ChatGPT Review can automatically edit protected Thesis, Evidence Register, Company Evolution Timeline, Decision Ledger, Portfolio or execute trades**. This ADR only records an interface invariant; it does not build or activate a Quant worker, investment decision engine, or new write permission.

## Alternatives

| Option | Advantage | Rejection / caveat |
|---|---|---|
| A. Chat prompt only | Fast iteration, flexible reasoning | No reliable shared version, schema discipline, enforcement or audit across rooms; prompts cannot prove writes or receipts |
| B. More deterministic financial regex in server | Predictable fixture results and local diagnostics | Coverage gap and maintenance grow combinatorially with language, metric, period, denominator and paraphrase; both false accept and false hold persist |
| **C. Hybrid LLM semantic judgment + verifiable backend** | Higher semantic adaptability while keeping actual bytes, IDs, permissions and writes independently testable | Requires adversarial Evals, trustworthy policy bootstrap, schema/citation checks, drift controls and careful rollback |

## Consequences and non-negotiable invariants

1. **Source-first:** durable user-supplied Source with honest attribution and any actual attachment readback is independently eligible even if Review semantic decision is held. Input text never becomes verified company fact by being saved.
2. **Bounded references:** every material assertion should identify what document/snapshot and section/page/quote supports it; model references must be checked against accessible records. Missing originals and conflicts remain `unresolved` with `What to Watch`.
3. **No autonomous privilege expansion:** confirmed primary receipt status and protected writes use separately validated authority. Optional human-signed Ed25519 issuance remains disabled by default; no private keys inside model/prompt/Vault.
4. **Portable semantics:** a single versioned policy and decision schema apply to Micro, Macro and PDF; prompts/specialist lenses can differ only by domain, not by evidence definitions.
5. **Reproducible evaluation:** freeze original news, preserved translations, actual historical context, and independently labeled expected outcomes. Track critical false-confirmed, false-hold, citation/link failures, coverage, repeat-trial variance, cost and latency.
6. **Rollback before release:** preserve old M5.5.1 as reference through M3; enabling a lean gate requires M4 security regression and real connected MCP schema parity, M5 staged end-to-end write and M6 deployment proof.
7. **Limits:** even multiple LLM critics do not verify external authorship; a SHA verifies stored bytes, not truth. Avoid using the same model as both generator and sole ground-truth evaluator.

## Decision gates

**M0 accepted for documentation only.** Advance design to M1 and M2. Do not remove any active M5.5.1 block, enable `verified_primary` issuance, mark Draft PR ready, merge or deploy before M3–M6 evidence. The actual connector payload and verified Production status remain separate acceptance requirements.
