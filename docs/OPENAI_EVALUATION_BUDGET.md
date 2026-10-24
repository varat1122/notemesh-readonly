# OpenAI evaluation: one USD 10 campaign

Prepared 2026-10-21. The owner subsequently approved starting the bounded paid campaign in this conversation ("ไม่ๆ ทำได้เลย"). **Paid execution remains technically blocked pending credentials, network access, verified pricing/Project evidence and ledger durability.** This approval is for the existing cumulative USD10 campaign, not a new budget, production deployment or real Vault/protected-note change. This advances the actual model/context handoff in the Investment OS North Star, using the existing adapter, corpus and temporary MCP Vault.

## Accounting contract

- Campaign: `investment-os-openai-evaluation-20261021`. Total USD **10.00**, automatic cutoff **8.50**, untouched buffer **1.50**. Constants cannot be supplied per request or changed by a model.
- ONE ledger: `/workspace/.investment-os-evaluation/campaign.sqlite`, outside the Vault and repository. All live entrypoints, models, cases and rounds use it. A restart opens existing accounting; it never initializes or resets it. Deploying/cloning another ledger authority is forbidden.
- Explicit offline initialization creates a private SQLite database and separate campaign identity sentinel. Either missing later, a symlink, loose permissions, wrong identity/policy, broken sequence/hash chain or damaged accounting causes a hold. No reset, timeout release or uncertain-charge refund command exists.
- SQLite `BEGIN IMMEDIATE`, `synchronous=FULL`, rollback journal and zero busy timeout serialize reservations across processes. A reservation commits **before** dispatch. Only one unsettled request may exist across the whole campaign. Network requests do not hold a DB transaction open.
- Audit events contain timestamps, immutable campaign policy, request key/body SHA, exact snapshot model, reviewed pricing-evidence SHA, token caps, maximum reservation, actual token counts, cached/reasoning counts, provider response ID and conservative charge. Prompts, keys, raw response bodies and Vault contents are absent from the financial ledger.
- Integer nano-USD arithmetic rounds fractional rates **up**. Before every request:

  `maximum = full_verified_context_window × highest_applicable_input_rate + configured_max_output_tokens × output_rate`

  `charged + outstanding_reservations + maximum <= USD 8.50`

  Full context reservation intentionally includes tokenization/schema/protocol overhead, avoiding unsafe chars/4 estimates. Reviewed rates must cover long-context tiers. This may reserve more than actual usage, but does not impose a tiny output or request cap. Choose 16,384–32,768 output tokens initially; a larger supported cap is permitted if its maximum exposure fits.
- Valid terminal Responses usage replaces the reservation with **full-rate input + all output**. Cached input gets no discount in our conservative accounting. Reasoning tokens are already part of output, checked against output, and never incorrectly added twice. This can exceed actual invoiced cost because discounts are ignored.
- Missing/invalid usage, model/tier mismatch, unknown billable usage, HTTP errors including 401/429, timeout, interruption or uncertain billing retain the **entire reservation** and freeze the campaign. A process killed after reservation leaves an outstanding reservation that blocks the next process. No assumption that an abort means the provider stopped billing.
- Even if reported usage exceeds the reviewed limits, record the actual liability and freeze; never hide an overage by clipping usage. Such a provider-contract violation is outside the proof below.
- Raw fetch has **one dispatch**, no SDK retries, redirects, streaming, background work, tools/search/audio/images, auto model changes or recursive requests. Reentry is refused. Completed request body + explicit round cannot run twice; an intentional repeat requires a deliberately new round ID. Different rounds still share all cumulative charges.
- Unknown bills require explicit operator/provider reconciliation and review before any future recovery implementation. Deleting/recreating the ledger is not reconciliation.

## Pricing, model and provider controls: fail closed

This environment could NOT retrieve current official OpenAI pricing or Projects documentation: HTTPS CONNECT was refused with 403. **No current price, supported snapshot, project limit, key, account balance or Organization/Project control has been verified.** No provider API was called and no settings were changed. Historical prices below are illustrative only.

Before paid execution, a trusted operator must separately receive owner authorization and create a private readiness file at `campaign.sqlite.readiness.json`. It is not a credential file. The schema in `openai-evaluation-readiness.ts` requires:

1. Campaign, explicit authorization reference, reviewer and review time within 24 hours.
2. Dedicated Project/Organization IDs; exclusive project/key use; a single durable ledger authority, reviewed persistence and no alternate paid consumer.
3. Exact dated model snapshot, verified context/output limits, Responses/strict JSON/reasoning support, standard-tier upper input/output rates across every applicable tier, reasoning within output, and no other billables for the restricted text request shape.
4. Three reviewed official HTTPS documents, separately for pricing, model and project controls, with SHA-256 of the exact reviewed document content. Enabling execution re-fetches each allowlisted official URL without redirects and demands unchanged hashes, then checks that exact snapshot using the non-inference `/v1/models/{id}` endpoint with explicit Project/Organization headers. Changed, inaccessible or stale evidence holds. A document hash proves unchanged content; **a trusted human must still verify that its prices/limits were transcribed correctly**.
5. Actual Project/Organization dashboard review evidence digest and a truthful control classification: `verified_hard_limit`, `alerts_only` or `not_supported`. Unknown/unreviewed controls are not accepted. Only an actually enforced, verified USD10 cap may be called a hard limit. Alerts, prepaid credit, delayed enforcement and monthly budget notifications are **not** guaranteed per-campaign hard stops. For a verified hard limit record `configuredLimitUsd: "10.00"`; otherwise record null. Do not configure controls without separate authorization. Do not invent a project-budget API or request an admin secret in chat.

Use official references for the future review, following redirects manually to record final URLs:

- <https://developers.openai.com/api/docs/pricing>
- <https://developers.openai.com/api/docs/models>
- <https://help.openai.com/en/articles/9186755-managing-your-work-in-the-api-platform-with-projects>

These are review starting points, **not verified current pricing evidence**. No readiness file with approval or dummy prices is committed/generated by this task. Metadata lookups are also gated by the separate live opt-in; tests inject responses and never contact OpenAI.

Cloud setup requires a proxy-backed secret named `NM_EVAL_API_KEY`, scoped only to `api.openai.com`; `OPENAI_*` secret target names are reserved by the platform. The adapter accepts opaque proxy placeholders and preserves `OPENAI_API_KEY` for local clients. It never logs or copies the binding into files, and authenticates via the model availability lookup before inference. Enable Node's supported `NODE_USE_ENV_PROXY=1` / `--use-env-proxy` so requests use the configured proxy. The environment draft adds only `api.openai.com`, `openai.com`, `developers.openai.com`, `platform.openai.com` and `help.openai.com`, preserving package-manager presets. Non-secret `NM_EVAL_PROJECT_ID` and `NM_EVAL_ORGANIZATION_ID` let the operator supply the IDs used when preparing reviewed readiness evidence. Saving a draft does not inject credentials or apply/publish network access; those runtime prerequisites must be rechecked after the owner saves and publishes the settings. An owner approval is already present for this campaign; do not ask for it again merely because configuration is missing.

## Worst-case exposure and limitations

With truthful verified rates/model limits, standard text-only provider billing, an exclusive Project and ONE persistent unmodified ledger, **cumulative reconciled charges + conservative unresolved exposure cannot exceed USD8.50**. At most one request is unresolved. For a hypothetical 400,000-token context at USD1.25/1M input and USD10/1M output, reservation is USD0.66384 at 16,384 output or USD0.82768 at 32,768 output. These examples are arithmetic tests, not a live price quote. The absolute allowed maximum for any request is the remaining portion of USD8.50. USD1.50 is never deliberately spent by the controller.

This is a local admission guarantee under explicit assumptions, **not a guaranteed provider invoice cap**. An operator can tamper with code, delete both files, roll back a filesystem snapshot, clone the environment/ledger or spend with another consumer. Hash chaining detects accidental edits, not a privileged attacker or tail rollback. Cloud workspace persistence is not demonstrated by ordinary process restart tests. Provider price/usage violations, taxes/currency/fees outside token billing and charges external to this campaign can also defeat a USD10 final-invoice claim. Review invoice currency/taxes and the external restriction, where supported, before approval. If these assumptions cannot be established, leave execution disabled. Do not claim the USD1.50 buffer eliminates an unbounded external risk.

## Evaluation quality and scope

Reuse two complementary paths, with the **same** ledger:

| Path | What is actually tested | Pass/fail |
| --- | --- | --- |
| Existing eight-case triage adapter/corpus | Exact reimport; conflicting number; added timing; archived-AI-only; undated no-match; thesis challenge; injection; different period | Zero unsafe false duplicates, missed critical escalations, invalid citations or unsupported approvals; all known fixture expectations matched. This is developer-labeled, not held out. |
| Prepared graph adapter + actual MCP temporary Vault | Real indexed preparation/excerpts, source SHA and exact canonical anchors → structured reasoning and model draft → separately test-authorized existing bundle → independent bytes/FTS/backlinks → different event retrieves prior `archived_ai` and supplies it back to the adapter | Source binding and citations match; no invented link; guarded bundle/readback/replay succeed; prior analysis remains non-independent; protected notes unchanged. Mock provider proves integration only. |
| Human reasoning review of structured graph response | Fact/hypothesis attribution; duplicate vs explicit correction vs contradiction; Demand → Conversion → Earnings → FCF/ROIC and missing bridges; bottleneck/thesis delta; counter-evidence; unsupported claims; selective link rationale | Grade each category 0–2. Require at least 14/16 and **no** critical error: invented fact/financial magnitude, wrong period/source, AI promoted to independent evidence, hidden thesis approval, ungrounded price-in, forbidden write or fabricated path. A structurally valid response is not semantic truth. |

The existing MCP regression now passes the actual preparation output through a budgeted **mock** Responses transport, writes that returned fixture Markdown using existing Safe Edit gates, independently verifies it, and sends the next retrieved context back through the same seam. Only the test mocks Sync daemon control. No production authorization/Sync bypass was added.

`runOptInRealOpenAISyntheticEvaluation` is the bounded live eight-case entrypoint. `runOptInRealOpenAIPreparedSyntheticGraphEvaluation` accepts a trusted temporary SYNTH preparation result for the full reasoning task, through identical consent/readiness/budget gates. It returns a proposed draft and never writes. A trusted harness/analyst must use existing host-authorized MCP bundle/readback, then supply the next preparation to it; there is deliberately no unattended writer or recursively calling model. Neither entrypoint is an HTTP/MCP API. No raw real-source/private-Vault reader was added.

Recommended campaign after approval: eight mini-model baseline triage cases; eight capable reasoning-model comparisons; eight prepared graph evaluations spanning normal event/next-event reuse, explicit issuer correction, contradiction, missing FCF bridge and malicious historical text. Prefer the best currently supported reasoning model for causal analysis and hard disagreements; mini is a comparison baseline. The legacy `gpt-5-mini` family and a capable GPT-5 reasoning family are **tentative candidates**, not verified current offerings; select exact supported snapshots only after official review. Do not silently fall back if unavailable.

Illustrative estimate, **NOT verified prices**: at mini USD0.25/1M input + USD2/1M output, 5k input + 8k total output costs USD0.01725/case. At reasoning USD1.25 + USD10, 5k input + 12k total output costs USD0.12625/case. Eight baseline + sixteen deeper cases ≈ **USD2.16**; 40 total cases with thirty-two deeper cases ≈ **USD4.18**. All reasoning is included in those output counts. Allow extra output for difficult cases rather than truncating prematurely. Actual rates/usage may be higher; the controller decides before every request. If every request consumes its entire context reservation, fewer calls fit. These are scope estimates, not promised request counts or pre-approved spending. Stop/review quality failures rather than automatically rerun.

## Offline operations and later execution

Safe offline commands (no key or network):

```sh
node --experimental-strip-types scripts/run-synthetic-openai-eval.mjs --initialize-budget
node --experimental-strip-types scripts/run-synthetic-openai-eval.mjs --status
```

Initialization runs once, only after confirming no earlier campaign liability is missing. Mount/back up the campaign state privately and durably **before** paid authorization; an ephemeral cloud directory is insufficient. Never put it in a Vault, public artifact or Git. Backups must not be restored as a way to reclaim spent budget. Inspect the SQLite audit/status after any failed run. Recorded mock costs in test temporary ledgers are not provider spending.

Only after explicit paid approval, verified readiness evidence, scoped secrets installed outside chat and a durable exclusive authority, the existing CLI requires `--execute-synthetic-only ROUND_ID MAX_OUTPUT_TOKENS low|medium|high`, plus the existing explicit opt-in. No execution command is included in CI/setup/start scripts. Model selection is the reviewed manifest, not a note or provider fallback. Graph cases use the prepared-graph entrypoint in the trusted temporary-Vault harness; collect its untrusted structured review for human grading, not production publication.

Regression coverage includes exact cutoff, expensive request refusal before transport, larger affordable outputs, cumulative models/restarts, reasoning/cache accounting, missing/invalid usage, HTTP errors/interruption, wrong model/unknown billables, provider over-limit usage, recursion/concurrent processes, SIGKILL after durable reservation, runaway sequential calls, duplicate rounds, damaged/missing/linked ledger, stale/blocked/untrusted pricing evidence and unavailable model. Existing adapter and actual MCP loop are exercised with accounting. **Actual provider spend by this task: USD0; actual inference calls: zero.**

**Readiness decision: owner-authorized campaign, offline implementation prepared; paid evaluation is NO-GO until credentials/network, current pricing/model/Project controls and durable exclusive ledger setup are verified.** Staging/Production acceptance and real-source investment judgment remain separate gates.
