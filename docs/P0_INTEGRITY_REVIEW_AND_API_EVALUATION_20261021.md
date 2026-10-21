# P0 integration and pending model evaluation — 21 October 2026

Development only. No main merge, deployment, App publication, real Vault access,
production permissions, or paid inference is authorized by this document.

## Latest linked-save continuation (21 October 2026)

Code candidate: `e1ac0b3643630d0978b3095eadf37d42ac59f190`. The owner's
ChatGPT screenshot reports an expired NoteMesh V2 connection. It does not
establish a provider/server bug, a queued submission, or a failed Vault write.
Normal owner OAuth reconnection is required; no authentication change was made.

Two development defects were reproduced before fixing:

- Actual `intake-importer.cjs` output under `00_Inbox/ChatGPT/.../N01.md`
  was absent from subsequent scoped investment context. The existing context
  builder now retrieves bounded imported AI history when its leading title
  subject and exact resolved canonical Company/Macro hub link agree. Broker
  mentions, incidental countries, missing links and promoted/inconsistent
  metadata are excluded. Legacy fields stay undeclared; the existing schema
  adapter labels `chatgpt_analysis` as non-independent AI without rewriting
  Source hashes, event keys, notes or receipts. This does not authorize a
  Source-bound graph write or update Company Evolution.
- A `blocked` intake receipt incorrectly said it was still queued. It now
  directs review without retry and does not claim no partial files exist.

The existing real-HTTP OAuth test now expires a temporary opaque save token,
renews through its actual approved refresh grant, reads the original submission
and resends its identical payload. Both requests retain one submission ID/row.
This is offline/local integration evidence, not a diagnosis of the deployed
ChatGPT connection. Existing consent, audience, revocation and scope gates remain.

Local checks on this source commit: frozen pnpm 11.16.0 installation, lint,
typecheck, build/client/runtime scans and **1,946 tests / 166 files passed**;
the separate backup script suite passed **46 tests**. Playwright passed 31/35;
four local `file://` UI tests were blocked by managed Chromium
`ERR_BLOCKED_BY_ADMINISTRATOR`. Docker reached dependency installation but
failed with `EAI_AGAIN registry.npmjs.org`; runtime was not tested locally.
Production dependency audit exited successfully under unchanged policy; its
metadata still lists 12 moderate and two high vulnerabilities with reviewed
existing exceptions. This is not a zero-advisory claim. Authoritative CI for
the final PR head must separately pass Test, Image and Audit.

No deployment, App action refresh, live Vault mutation or paid inference was
performed. After reconnecting the intended App, inspect any existing submission
ID before resending; a read-only `IN-...` plan ID is not a submission receipt.
The shortest remaining acceptance step is the owner's already reviewed
single-note save and independent readback in the connected chat, followed by
separately authorized staging graph/Timeline acceptance.

## Confirmed defects and repairs

Starting remote #108 HEAD was `de2bd970bf6a1f8ab0c5e6665ec61e46933d8ed9`;
main was `b563c55fd99c5fb2738fda0682f7b6f76a0ef42a`. Recheck before use.

Regression tests were added before production edits and failed in five cases:
stale Source FTS body, stale frontmatter, incorrect size, absent FTS row, and
reverification of event A after a successful event B append. The Source cases
actually wrote Analysis/Timeline before returning a partial-reconciliation
status. The Timeline case returned a physical/receipt hash mismatch despite a
legitimate second append.

The existing preparation and bundle preflight now require physical Source
body/frontmatter/byte size to agree with SQLite/FTS before graph mutation, in
addition to the reviewed SHA binding. No automatic reindex or source rewriting
is used to make inconsistent input pass.

The existing graph verifier now distinguishes the historical operation version
from the current living Timeline. For a changed Timeline, the existing Safe Edit
journal must establish an unambiguous append chain from the requested receipt
to the current physical bytes. Each operation must have successful receipt
stages, consistent before/after hashes and exact snapshots; recomputing its
append payload must reproduce its saved afterText. Current FTS, markers,
Source SHA, canonical targets and reciprocal backlink checks still apply.

This is intentionally conservative: another OAuth client's append, missing or
pruned journal history, a fork/ambiguous chain, interrupted operation, replace,
rollback or unjournaled edit requires reconciliation. No other client's
snapshots are exposed. Old successful receipts are never rewritten.

## API compatibility

| Interface | Required contract |
| --- | --- |
| Preparation | `issuer` (not `entity`), exact source/event/period; returns `expectedSourceSha256` in proposedWriteFields and `source_path`/`source_sha256` in requiredAnalysisSourceMetadata |
| Bundle | `expectedSourceSha256` required in both MCP and server schema; Analysis frontmatter must match the prepared source path/hash |
| Replay | Uses durable Analysis binding and receipts; cannot replace the source hash or add another Timeline entry |
| Recovery | Same binding and Source/index checks; identical saved Analysis; only a never-started Timeline operation can be repaired with a newly authorized action |
| Verification | Does not accept a caller replacement source hash; reads the receipt-bound Analysis metadata and current Source/index |
| Later Timeline | `historicalWriteReceiptsVerified=true`, `currentGraphIntegrityVerified=true`, positive subsequentAuthenticatedAppendCount; `exactOperationAfterHashesVerified=false` because the current Timeline is newer |
| Legacy unbound records/clients | Explicit reconciliation/client upgrade; no invented provenance, automatic backfill or implicit writer permission |

The fifteen-tool candidate registry is not evidence that those tools are
published in the installed ChatGPT App. General Safe Edit APIs remain available;
legacy graph records do not acquire new verification claims automatically.

## Release integration and acceptance

Main is already an ancestor through integration commit `5173086`; no new merge
is needed. The inherited chain is #108 down through #48, then #46 and #36 to
main: 63 Draft PRs at inspection, including substantial DR/backup and historical
review work. Each current stack base is an ancestor of its child except the
historical root #36 versus newer main; the top candidate already incorporates
that main through `5173086`. Do not blindly merge the old parent PRs in sequence.
Top-candidate ancestry is resolved, but that does not approve the whole
stack for production. Date/source dedup routing and intake importer still match
main; issuer/industry recall and source archive safeguards remain present.

Run frozen pnpm installation, lint, typecheck, build, full Vitest including real
HTTP/in-memory MCP integration, Playwright, Docker build/runtime and production
dependency audit on the final commit. Record CI Test/Image/Audit independently.
The existing audit exceptions must remain visible and owner-reviewed.

In this cloud machine `/tmp` is a separate tmpfs. Set test `TMPDIR` to an
isolated directory under `/workspace/.cache` for the existing disk test's
root-filesystem fixture assumption. Do not change its assertion. Managed system
Chromium blocks file:// and the pinned-browser CDN is restricted; use normal
GitHub CI for authoritative E2E and Docker evidence. No test gate is waived.

## Historical OpenAI adapter inspection (before budget/proxy changes)

The inspection below predates `cd36fa2` (persistent cumulative budget and graph
evaluation transport) and `ba7ddc8` (opaque cloud credential support). It is
retained as a historical finding, not the current adapter contract. Consult
[OPENAI_EVALUATION_BUDGET.md](./OPENAI_EVALUATION_BUDGET.md) and actual source
for current limits/readiness gates. Paid evaluation remains paused; this
linked-save continuation does not require an OpenAI API key.

Inspected `offline-synthetic-openai-eval.ts`, its mock-transport tests,
`offline-synthetic-model-evaluator.ts`, the fixed corpus/scorer and
`scripts/run-synthetic-openai-eval.mjs`. The adapter uses the Responses API at
`https://api.openai.com/v1/responses`, hardcodes `gpt-5-mini`, `store:false`,
strict JSON output, 1,000 max output tokens/case, eight sequential cases and a
60-second per-request timeout. Redirects, CI and Railway execution are refused.
It has no Vault reader/writer, no autonomous tool calls and no production route.

Mock transport inspection (zero provider calls) measured 12,117 prompt characters
across eight requests, approximately 3,030 input tokens at four characters/token
**before schema/protocol overhead**. Mock answers totalled 3,330 characters;
the configured total output cap is 8,000 tokens, including reasoning tokens.
These are estimates and fixture measurements, not actual provider usage.

The current runner is ready for a separately approved, fixed synthetic smoke
test on a supported local developer machine. It is **not technically ready to
measure all eight requested end-to-end capabilities**:

- History is supplied as handwritten excerpts, not returned by the real indexed
  context preparation/MCP path. Retrieval relevance/omissions are unmeasured.
- The schema grades relation labels, citation IDs, abstention and one economic
  channel. It does not produce or grade a complete causal chain or graph draft.
  `economicReasoning` is a fixed `hypothesis` enum, not substantive reasoning.
- The corpus has eight visible developer labels, not held-out real-source
  evidence. Correct labels alone cannot establish investment judgment.
- Correction detail, full-path canonical selection, required draft metadata,
  safe write preparation and actual next-event retrieval are not integrated
  into the provider runner. Existing deterministic MCP tests cover the mechanics
  with externally written synthetic drafts, not model quality.
- Usage is discarded, there is no spend ledger/global run budget, and no model
  selection or reasoning-effort control. A 1,000-token cap may produce incomplete
  JSON when reasoning consumes the allowance; incomplete responses fail closed.
- The CLI reads `OPENAI_API_KEY`, and its live entry requires a raw `sk-` prefix.
  That is not compatible with proxy placeholder credentials. A Cloud secret
  bridge must be reviewed before use; do not reject a valid proxy binding merely
  because it does not look like a raw key. Do not weaken opt-in gates.

Runtime checks found neither API-key/opt-in variable exported; saved cloud
metadata contained no secret or runtime requirements. No credentials or network
configuration were changed. Official model/pricing pages could not be refreshed
because this environment returned HTTP 403; current availability/rates are
therefore unverified.

## Smallest evaluation plan after separate spending approval

Reuse the existing adapter, corpus, scorer and temporary MCP fixture machinery;
do not create another inference framework or writer. Before an end-to-end run,
connect model inputs to actual preparation results, collect provider usage,
configure a bounded model/reasoning/output budget and serialize model output
into the existing Analysis contract. Only explicit fixture code may invoke the
existing writer on synthetic data; model text never supplies authorization.

Candidate models: existing `gpt-5-mini` for a cheap smoke pass, then `gpt-5` as a
reasoning comparator if available. Pin a supported snapshot after checking
official metadata and pricing; these names are planning candidates, not a claim
that a live model has been accessed or evaluated.

Use the existing eight cases for the first smoke run. The subsequent smallest
integrated evaluation needs four **paired** source events (eight items), with
gold expectations withheld from model prompts:

1. New demand report followed by a delivery/conversion constraint: retrieve
   Thesis/Evidence/Industry and distinguish demand from recognized revenue.
2. Exact same upstream event repost, followed by a same-period correction:
   no false independent confirmation; preserve original chronology.
3. Earnings strength followed by contradictory working-capital/CapEx/FCF
   evidence: classify contradiction and explain economic transmission.
4. Archived AI claim or injected instruction without a primary source, followed
   by an independently attributed new event: abstain on unsupported claims,
   retain AI non-independence and retrieve prior saved Analysis on the next event.

Each pair uses one temporary issuer and its existing canonical Timeline. Return
source/claim citations, fact-versus-hypothesis labels, relation classification,
causal explanation, counter-evidence, exact relevant links and a provisional
Analysis draft with source binding. Keep original-source qualification explicit.
No protected investment notes or real Vault are inputs or outputs.

| Dimension | Measurable acceptance for this small run |
| --- | --- |
| Retrieval | All required issuer/period anchors and available contradictory notes retrieved or an explicit omission hold; zero wrong-issuer anchors |
| Attribution | Every material factual/numeric claim cites supplied source text; zero invented facts or AI-to-primary promotions |
| Event classification | All gold duplicate/correction/contradiction cases correct; zero unsafe false duplicates or false independent confirmations |
| Causal reasoning | Human rubric: evidence, mechanism, timing/bottleneck and uncertainty each scored 0–2; at least 6/8 per supported case, no unsupported FCF/valuation jump |
| Counter-evidence | Identify the seeded contrary evidence and at least one testable alternative; abstain when essential evidence is absent |
| Links | Every chosen full path resolves to an allowed existing target; zero unrelated links; explain relevance |
| Write preparation | Complete metadata/hash binding passes the existing preflight; no mutation on stale input or missing permission |
| Next-event reuse | All four second events retrieve the first saved analysis as archived_ai/non-independent; same-event replay creates zero duplicates |

All safety criteria are mandatory. Human semantic review is separate from
schema/link validity; a pass on eight artificial cases is not production model
validation or proof of issuer authenticity. Record model snapshot, prompt/input
digests, expected/observed classifications, human scores, omissions, latency,
input/output/reasoning token counts, actual cost and all failures. Fail closed
on timeout, refusal, incomplete output or budget exhaustion; no automatic retry.

### Planning costs (USD; assumptions, not a verified current quote)

Use formula `(input_tokens × input_rate + output_tokens × output_rate)/1e6`.
Previously published planning rates: mini $0.25/$2 per million input/output
tokens; GPT-5 $1.25/$10. Verify current official rates before spending.

| Run | Conservative token envelope | Mini estimate | GPT-5 estimate |
| --- | --- | --- | --- |
| Existing eight-case smoke | 4,000 input + 8,000 output total | $0.017 | $0.085 (requires model-selection change) |
| Eight integrated items | 48,000 input + 32,000 output total | $0.076 | $0.38 |

These exclude tool charges (none planned), retries (disabled), taxes and any
tokenization/schema overhead beyond the envelope. A proposed first approval
would cap a smoke run at $0.10; a separately approved two-model integrated run
at $1.00. The existing runner does not enforce a dollar budget, so implement
usage/budget admission and verify the rates before treating those caps as
executable guarantees. No such approval has been granted.

Environment prerequisites: HTTPS access only to api.openai.com, an explicitly
authorized test project/model, secure scoped credential configuration, supported
proxy transport, opt-in flag and CLI confirmation, writable synthetic results
location, validated model limits and a tested spend stop. Never paste keys into
chat/logs or reuse production credentials. Never put the execution command in
CI or a startup/install script. Paid evaluation remains PAUSED.

## Shortest path to a real staging pilot

After exact-SHA CI and stack/security review, approve one isolated staging
deployment/test Vault and publish the candidate actions there. Demonstrate one
real non-sensitive source with human/client-model reasoning, authorized graph
write, independent readback, then a second event and reverification of the first.
Source qualification, duplicate classification, OAuth host approval, idle
bidirectional Sync, single-writer gates and rollback backup must be evidenced.
Paid API evaluation is a separate decision and is not required to start the
runbook's human/client-model pilot. Production and device-delivery acceptance
remain separate gates.
