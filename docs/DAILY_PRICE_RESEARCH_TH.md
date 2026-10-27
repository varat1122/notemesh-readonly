# Daily OHLCV + historical Vault research — candidate acceptance

Baseline: `71cc4178607d717b403ffd143d3a01bff7c94758` (main, 27 October 2026).
Independent branch: `feat/daily-price-refresh-controls`. PR #128 remains Draft at
`1713d14b7e9553c5b37a10d20c5eb18aa29abdbf`; its Research Policy, M3 evaluation,
fixtures, scorer and semantic gate are not changed by this work.

This is code/configuration for owner review, not an activation receipt. No live
provider/Drive request, new resource, credential change, deployment, paid model
call or real Vault write is authorized or performed by this change.

## Proven functional gaps and reuse

Existing Yahoo daily adapter, bounded incremental Drive snapshots/catalogue,
SQLite query service, OAuth admin screen, refresh receipts and four read-only
price MCP tools are canonical. No new backend, provider or database stack.

Gaps corrected:

- Existing CLI accepted `batch_complete` as success after only five listings.
  The bounded runner drains due batches and reports nonzero/incomplete otherwise.
- A failed listing waiting for retry could be reported complete despite old data.
  Collection readiness now requires usable bars and successful current-cycle
  refresh for every configured listing, with no latest error. This still does
  not prove the latest official exchange session is present.
- Existing minute timer cannot run while its server is asleep/stopped. Explicit
  schedule modes and an image-contained one-shot command support an approved
  scheduler; merely deploying this code does not provision or activate one.
- A long-lived read server cached the Drive catalogue indefinitely. It now
  rechecks the signed catalogue on demand once per minute; bad/missing newer
  catalogues are not silently substituted with older ones.
- Existing administrator UI had OAuth setup but no one-click complete-watchlist
  refresh. Settings now links to the same screen with an opt-in update button.

All supported run entrypoints share a lock at
`DATA_DIR/market-prices/refresh-run.lock`. A real shared persistent filesystem
and one writer are required. Separate volumes cannot coordinate this way.
A crash/unknown writer leaves the lock for manual inspection; do not clear it
or retry automatically. Existing per-store lease, provider cooldown, signed
byte readback and single-writer checks are retained.

## Proposed runtime configuration — OWNER APPROVAL REQUIRED

Preserve existing DATA_DIR, ENCRYPTION_KEY, auth/Sync/Safe Edit flags and secrets.
Only an isolated authorized dataset may be used for first live acceptance.
Do not reuse Production credentials or a Production dataset in Staging.

Common proposed price settings, not applied:

```text
MARKET_PRICES_ENABLED=1
MARKET_PRICES_STORAGE=google-drive
MARKET_PRICES_DRIVE_SINGLE_WRITER=1
MARKET_PRICES_REFRESH_ENABLED=1
```

A dedicated existing Drive OAuth flow uses drive.file, private app-created files
and server-key-bound signatures. ChatGPT's Drive connector does not supply these
credentials. No OAuth/client/secret setup is done here. Review token lifetime,
quota, data rights and actual provider access before activation.

Choose ONE scheduled writer arrangement after checking existing infrastructure:

1. **Existing awake server:** `MARKET_PRICES_SCHEDULE=in-process` (default).
   Timer checks after 13:00 Asia/Bangkok / 06:00 UTC, one bounded batch per tick.
   Manual button can drain the queue under the same lock. No awake-server SLA is
   claimed for sleeping hosts. Keeping compute awake may cost more.
2. **Approved one-shot scheduler:** `MARKET_PRICES_SCHEDULE=external` on the web
   server AND the job. This disables its in-process timer. Run the exact image
   command below at `0 6 * * *` UTC. Ensure job/admin operations share the SAME
   persistent lock root or explicitly exclude the other writer. Do not assume a
   second Railway service can share a volume, credential namespace or lock.
   If existing infrastructure cannot provide this, obtain separate provisioning,
   credentials and cost approval first; do not create resources from this plan.
3. **Manual only:** `MARKET_PRICES_SCHEDULE=manual`. No automatic collector.
   Admin signs in, Settings → Daily Market Prices → อัปเดตราคา.

Exact bounded job command in the existing built image (no web server required):

```sh
node .output/server/price-job.mjs refresh
```

Repository equivalent: `pnpm prices:refresh`. Status: `pnpm prices:status` or
`node .output/server/price-job.mjs status`. No `--force`, caller paths or symbols.
The configured watchlist is the only collection scope.

Job budget: 10 minutes, maximum 204 batches, existing 25-second request timeout
capped by remaining job time. Manual budget: 5 minutes. A budget hit returns
pending/nonzero rather than complete. Do not kill a possibly publishing job and
immediately start another; inspect locks, signed catalogue and last errors.
Provider cooldowns are respected; no alternative IP/provider or paid fallback.

The existing eight example listings remain defaults, NOT the user's holdings.
Before live use owner specifies a small 10–20-listing watchlist and explicit
same-market benchmarks; do not silently import a portfolio or whole market.
The initial target is five years where available. Later overlap/weekly checks
preserve correction and corporate-action handling. Yahoo is an unofficial
personal-use pilot source, not an exchange-certified or guaranteed free feed.

## Storage and cost

Drive holds signed, compressed CLOSED per-listing SQLite snapshots + signed
catalogue. Query readers open requested partitions in RAM. No active SQLite
file is mounted from Drive or synced into Obsidian. No OHLCV rows are copied
into the Vault. Old generations accumulate; no automatic deletion is added.
Drive storage allowance, API quota and hosting compute cost are separate.
Fetching/calculating prices makes NO model/API inference call. Only the usual
ChatGPT analysis consumes model context; request narrow ranges and computed
windows rather than five years of raw rows for every question.

## Ready-to-use ChatGPT research instructions (proposed addendum)

Install only after owner confirms actual tool discovery and access. This text
adds price use to the trusted Research Policy; it does not replace M3 policy,
issue primary receipts or authorize Vault/deployment mutations.

> For investment news, first retrieve original sources and relevant historical
> Thesis/evidence/reviews with investment_context_pack and read the selected
> notes. When market context is relevant, call get_price_data_status, inspect
> lastPriceDate, refreshState, currency, listing and quality flags. Read a narrow
> relevant range with read_price_bars. For event returns, establish the original
> publication time and correct first affected exchange session, then call
> analyze_price_event with an explicit basis and same-market benchmark. Missing
> or stale prices are an explicit limitation, not a reason to fabricate values
> or block otherwise valid Source preservation. Separate observable price moves
> from economic interpretation; no causal/price-in claim from OHLCV alone.
> Archived AI analysis is historical interpretation, never independent evidence.
> Persist only an authorized compact Source/Review through existing Safe Edit;
> include data as-of, fetched time, dataset/sample hash, benchmark and method
> returned by the tools. Do not auto-edit Current Thesis, Evidence Register,
> Evolution Timeline, Portfolio or trades. Report save only from real receipts.

No new model backend, MCP write tool, JSON investment schema or semantic
validator is introduced. Backend integration does not prove ChatGPT frontend
invocation or installation of these instructions.

## Acceptance (actual results recorded in candidate/CI evidence)

Offline tests reuse existing suites and synthetic provider/archive fixtures:
multiple Drive batches → signed publish/readback → restart → no same-day
refetch/duplicate; next-cycle catchup; failed listing retained as pending;
manual/job exclusion and persistent crash lock; bounded timeout; provider
cooldown with old data retained; cross-Origin/anonymous/disabled/oversize form
rejection; cold/warm catalogue changes; actual read-only MCP retrieval of both
historical Vault context and SQLite prices with zero note/provider mutation.

Live acceptance, NOT EXECUTED:

1. Owner approves isolated dataset, Watchlist, provider rights, OAuth scope,
   exact image/SHA, sole writer/shared-root proof, scheduler arrangement and
   infrastructure cost cap. No evaluation budget is used for hosting.
2. Refresh from Admin; require full watchlist completeness, actual Drive upload
   and independent download/hash validation, correct listing/dates and errors.
3. Restart/read-only server sees same catalogue; next scheduled cycle appears
   without opening ChatGPT. Confirm provider holidays/delays are disclosed.
4. In actual ChatGPT send a real news item and observe both Vault and price tool
   invocations. Only then approve a concrete Source/Review write separately.
   Source B retrieves that historical Review without promoting AI to fact.

Rollback: disable MARKET_PRICES_REFRESH_ENABLED for manual/job entrypoints;
set schedule manual (or MARKET_PRICES_ENABLED=0 to disable price tools too),
stop the approved scheduler, preserve archives/keys/receipts. Never change
Production/Sync flags or restore/delete data to make this pilot pass.

## Historical security release gate — initial price candidate 548b5f6

`pnpm audit --prod --audit-level=high` reports 29 advisories: 4 low, 19 moderate,
6 high (1 high covered by the pre-existing build-only exception). The five
unignored high findings affect follow-redirects (two advisories), Vite 6, Zod 3
and body-parser 2. Both pnpm-lock.yaml and pnpm-workspace.yaml are byte-identical
to baseline main. No ignore entry, dependency upgrade or semantic gate has been
changed to turn CI green. This candidate must NOT be deployed until the relevant
security patches/compatibility review pass; a Zod-major migration is not silently
folded into this independent price task. Audit failure is a release blocker, not
a successful security result. Exact remote CI status is recorded separately.

## Initial price candidate 548b5f6 evidence — 27 October 2026

- Frozen pnpm install, lint, typecheck and build PASS; client/server import boundary
  and runtime exclusion scans PASS. No dependency/lockfile/ignore changes.
- Final Vitest: **1482 tests / 107 files PASS**, no skipped tests. Command:
  `TMPDIR=/workspace/.price-validation-tmp pnpm exec vitest run --maxWorkers=2`.
  Initial runs exposed a pre-existing test assumption that temp files share the
  root filesystem, then CPU-contention auth timeout during parallel Docker work.
  Final run uses a root-filesystem temp directory and fewer workers; no test
  assertion/timeout was weakened. Earlier failure logs are retained outside Git.
- Final Playwright: **32 PASS**, including real browser Settings discovery,
  authenticated price setup, anonymous rejection and refresh default-OFF denial.
  System Chromium selected locally; CI retains its pinned browser by default.
- Final Docker build PASS. Image:
  `sha256:94b20b454ca4e2a1d1e1441d2c8c50376389334abac885025d5bfe968a17b726`.
  Managed-cloud proxy CA used via temporary BuildKit secret, TLS verified;
  temporary proxy-aware build instructions are outside source. CI builds the
  unchanged repository Dockerfile. Included Docker price/security regressions PASS.
- Final disposable Docker runtime PASS: headless job is packaged and refuses
  disabled refresh before creating an auth DB; web health, SQLite quick_check,
  tini PID1 and unprivileged permissions PASS; anonymous price GET/refresh POST
  return 401; no price database is created. No live provider/Drive was used.
- Code review includes the delayed-catalogue-response race: a stale async reload
  cannot replace a newer signed generation published while it waited.
- Production dependency audit **FAIL** as detailed above. Live scheduler,
  Drive consent/upload, actual ChatGPT frontend use and real Source/Review save
  are **NOT TESTED / NOT ACTIVATED**. No live acceptance receipt is implied.

Exact source SHA, remote CI and Draft PR status are reported from actual GitHub
readback. Local logs: `/tmp/prices-daily-*.log`; original worktrees, P0 staged
files and paused evaluation ledger/identity are preserved.

## Security follow-up — dependency alignment with PR #128

Owner authorized continuing the security remediation after the initial price
candidate. The dependency graph is reused byte-for-byte from PR #128 at
`1713d14b7e9553c5b37a10d20c5eb18aa29abdbf`: pnpm-lock.yaml and
pnpm-workspace.yaml match that commit. Resolved fixes are Zod 4.6.7,
follow-redirects 1.16.2, Vite 6.4.5 and body-parser 2.4.0. The only runtime source
adaptation is the existing PR #128 Yahoo dividend/split record key schema,
retaining this branch's request-budget handling. No M3 quality-gate/policy,
corpus, judgment, source receipt, permission or actor changes are imported.

Production audit now PASSES the existing threshold: 3 low, 16 moderate and
1 high (the same previously ignored build-only finding). No audit exceptions
are added or expanded. Runtime-exclusion scans still enforce absence of the
excepted build packages. This supersedes the initial candidate's audit HOLD;
it is not a zero-advisory or Production acceptance claim.

Compatibility verification reuses six existing M3/Research Policy schema,
reference and scorer unit-test files from the frozen PR #128 in a detached
inspection worktree: **35 tests PASS** with this exact dependency graph. These
are offline software regressions over controlled fixtures, NOT new blind model
trials, NOT independent economic adjudication and NOT scoring the operator's
actual submissions. No paid provider call, evaluation record or production
Vault write is performed; M3 trial counts and policy hashes are not changed.

The final candidate's complete tests/build/browser/Docker and exact GitHub CI
results are reported in the accompanying acceptance evidence. Deployment,
Drive/Scheduler activation and live write permissions remain separate approvals.

Docker build regressions use at most two workers after a local default-parallel
run timed out while loading modules under concurrent build load. All tests and
their original timeouts/assertions remain unchanged; no test is skipped. This
keeps the image check reproducible on small runners.

Security follow-up local verification: audit/lint/typecheck/build PASS, complete
1482-test / 107-file suite PASS, browser E2E 32 PASS, frozen M3 compatibility
35 PASS. A subsequent local image assembly exhausted the managed 32 GiB root
filesystem after its regression tests passed. Only disposable build cache and
this task's superseded local test image were cleared; source, staged P0 files
and ledger/identity were preserved. This failed local image is NOT a PASS.
Final image acceptance is delegated to the existing exact-commit GitHub image
job, now also checking the actual packaged price command refuses refresh while
disabled without creating an auth database or requiring a model/API secret.
No image is published or deployed by these tests.
