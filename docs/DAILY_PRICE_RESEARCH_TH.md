# Daily prices on the existing M4 Staging line

Candidate branch: `feat/staging-daily-price-integration`.
PR base: `feat/m4-synthetic-bootstrap` at
`dd7d0b17a32e9da66d99836f0752c24c9c723ae5` (27 October 2026).
Owner-reported deployed SHA: `7fafe2607f7f5e218ba1dd8b01d23f34f584de2f`.
The base is its direct fast-forward successor, adding only the existing three-file
Railway backup/release evidence gate. No deployed service or protected branch changed.

## Why this integration is necessary

PR #129 (`7456c5f96b1331f30aa6edc340873e92507eb6af`) is based on main, not the
currently deployed M4 line. Replacing Staging with it would omit owner-review,
Backup and recovery modules and the staging NEVER restart-policy override.
This branch ports only its daily-price change and tested dependency patches onto
the Staging line. PR #129 remains untouched; it is not a Staging deployment artifact.
Do not merge this integration into main as a shortcut: review against the Staging
base. Separate ongoing M3/M5 branches are not silently imported or deployed.

The existing collector, Google Drive snapshots/catalogue, SQLite price queries,
admin OAuth page and four read-only price MCP tools remain canonical. No backend,
model, new database stack, scheduler service or alternative Vault writer is added.

## Integration guarantees

- M4 owner review, Safe Edit, Git transactions, journal, protected paths, app DB,
  Backup modules, MCP registration and railway.json retain the base implementation.
- Direct collector, Drive cache and writable PriceStore retain their DR admissions.
  Their fence imports explicitly name `.ts` so the existing native Node CLI loads
  without bypassing Backup admission (the prior extensionless imports failed).
  The bounded runner now holds the existing process-local writer admission from
  before lock creation through all batches and lock removal. Freeze refuses a new
  run; an in-flight run drains before the snapshot callback begins.
- Authenticated same-origin manual refresh uses the existing administrator page.
  No arbitrary symbols/paths/force input or MCP mutation tool is accepted.
- Full-watchlist success requires usable bars and successful current-cycle refresh
  for each listing. Batch completion is not full completion. Provider cooldown,
  signed archive download/readback and no-silent-fallback rules are retained.
- Supported job/admin/timer entrypoints share DATA_DIR/market-prices/refresh-run.lock.
  Crash locks are retained for operator review. The filesystem lock is not
  distributed; the DR fence coordinates THIS Node process only. External jobs must
  be excluded during coordinated backup and cannot prove cross-process quiescence.
- Reuse the exact dependency lock graph tested in the price candidate/PR #128:
  Zod 4.6.7, follow-redirects 1.16.2, Vite 6.4.5, body-parser 2.4.0.
  Staging already uses Zod 4. No new audit exceptions or semantic policy changes.

## User experience and storage

After separate activation approval: Settings → Daily Market Prices → อัปเดตราคา.
A manual run is bounded to five minutes; incomplete/error results remain explicit.
Drive holds private signed compressed CLOSED per-listing SQLite snapshots and a
signed catalogue, never a live mounted database. Readers hydrate bounded RAM.
No raw OHLCV rows, holdings or credentials are written into Obsidian. No automatic
archive deletion is introduced. Price collection/calculation calls no model API.

ChatGPT should retrieve original source and historical Thesis/evidence first,
then get_price_data_status and a narrow read_price_bars/analyze_price_event range
when market context matters. Inspect currency, listing, lastPriceDate, freshness,
adjustment basis and comparator. Price moves do not establish causality or price-in.
Archived AI remains historical interpretation, never independent verified evidence.
Saving a compact Review uses the existing separately authorized Safe Edit path;
include returned data as-of, hash/reference, benchmark and method. No protected
Thesis, Evidence Register, Portfolio or Timeline mutation is authorized by this task.

## Activation package — HOLD until separately approved

Owner-side readback reports SLEEPING, sleepApplication=true, NEVER restart,
3000-second process timeout, one replica and no cron. These are infrastructure
observations supplied by the Owner, not independently read by this Codex session.
This service cannot be assumed to run a reliable 24-hour in-process timer.
Start with one manual refresh; scheduling remains off until runtime/cost proof.

Before any deployment: revalidate service identity/current SHA and auto-deploy,
DATA_DIR on its own persistent mount, Backup/recovery evidence, base flags, actual
start command and effective NEVER restart policy. Review billing/usage and an
explicit compute allowance; the earlier evaluation/provisioning budget is not a
new deployment or OAuth authorization. Masked blank variable cells mean UNKNOWN.

First proposed deployment uses the final reviewed SHA of THIS branch, with:

```text
MARKET_PRICES_ENABLED=0
MARKET_PRICES_REFRESH_ENABLED=0
MARKET_PRICES_SCHEDULE=manual
```

Keep the verified existing data root, credentials, Sync and Vault write settings;
any changed or unsafe writer setting needs a concrete diff and owner approval.
Do not enable dormant writers, production Sync or overwrite secrets. Preserve the
Staging restart/timeout controls; do not replace its custom start command blindly.
No domain/resource creation or configuration has been performed by development.

After approved admin-login/HTTPS checks, a dedicated staging-only Google OAuth
client uses `drive.file` and the existing path `/api/market-prices-drive/callback`
on the verified Staging origin. Do not use the production URL in older docs.
ChatGPT Drive connector access is not server OAuth. Store secrets directly through
the authorized host UI, never chat/Git/logs. Do not rotate the existing ENCRYPTION_KEY;
it binds credential encryption and archive signatures. Google Testing-mode refresh
tokens may expire after seven days; long-running access needs appropriate setup.

After owner approves the isolated Drive dataset, provider access/rights, one writer
and explicit pilot watchlist (defaults are connectivity examples, not holdings):

```text
MARKET_PRICES_ENABLED=1
MARKET_PRICES_STORAGE=google-drive
MARKET_PRICES_REFRESH_ENABLED=1
MARKET_PRICES_SCHEDULE=manual
MARKET_PRICES_DRIVE_SINGLE_WRITER=1
```

Verify manual completeness, actual last price dates, signed upload/download hashes,
restart/readback, and actual ChatGPT calls retrieving both prices and Vault context.
Only then consider daily collection at 06:00 UTC / 13:00 Bangkok. In-process needs
an awake server; external requires a proven scheduler, shared lock/exclusive writer
and backup coordination. The existing packaged command is
`node .output/server/price-job.mjs refresh` (requires external mode, max ten minutes).
Do not create another service or assume independent volumes coordinate.

Rollback must stop scheduled collection, disable refresh and use manual mode (or
MARKET_PRICES_ENABLED=0). Preserve archives, keys and receipts. The exact prior
image/configuration and DB compatibility must be reviewed before rollback; an image
rollback is not a volume restore. No reset/restore or production action is authorized.

## Evidence and limitations

Existing tests are reused; three focused regressions cover bounded runner freeze
refusal, actual two-batch Drive publication before snapshot, and native CLI imports.
The image smoke checks packaged job default-OFF before auth DB initialization.
Exact local/CI results and SHA accompany the final handoff; tests never use actual
Drive, Yahoo, Railway, Vault credentials or paid inference.

Synthetic/CI success is not live Google OAuth, Drive readback, ChatGPT frontend
acceptance, device Sync, backup availability or Production readiness. There is no
live acceptance receipt yet. Deployed branch compatibility is a separate gate from
PR #129 CI; the new integrated candidate must pass its own required checks.

## Local validation before CI submission

- Frozen install, lint, typecheck and final build PASS; client/server boundary and
  runtime exclusion checks PASS. Packaged CLI refuses disabled refresh with no
  auth/price files created.
- Focused integration + previously timed-out legacy suite: 102 tests PASS.
  Offline backup/recovery scripts: 19 PASS.
- Full Vitest intermediate runs each had 2022 PASS / 1 FAIL: first a synthetic Git
  clone checkout failure (isolated conformance rerun 14 PASS), then a legacy offline
  review's 5000ms timeout (targeted rerun PASS). No assertion/timeout was weakened;
  these runs are not claimed as a full-suite PASS. Final CI is required.
- System Chromium: 33 E2E PASS, four unchanged offline file:// demo tests BLOCKED
  by ERR_BLOCKED_BY_ADMINISTRATOR. Browser policy was not bypassed, tests were not
  skipped. CI retains the standard Playwright browser and all 37 E2E cases.
- Dependency audit passes the repository high threshold with 3 low, 16 moderate,
  one pre-existing ignored build-only high. No new ignore entries; this is not
  a zero-vulnerability claim.

Remote CI must be read on the submitted exact SHA, including its image job and
all existing M3 Git/recovery steps. Do not deploy on local focused tests alone.

## PR #130 security follow-up

The initial integrated commit `7ae97b5` passed full CI #500 (and final local
2024/2024 tests). After Draft PR #130 was created, CI #501 failed its fresh audit:
Better Auth 1.7.2 is covered by GHSA-965c-763c-88jm (critical OAuth-state login)
and GHSA-r4xp-prcw-77qf (high OAuth-proxy login). Prior green CI is historical.

Pin better-auth, @better-auth/api-key and @better-auth/oauth-provider together to
1.7.7, the advisory's patched version. Only their required dependency graph is
updated; no audit exceptions are added. The existing refresh-scope patch is
reviewed against 1.7.7 and remains version/layout guarded. It changes only stored
grant scopes; upstream rotation CAS/replay checks and access-token narrowing stay
intact. Existing consent, scope/resource, session and Safe Edit tests are reused;
one real synthetic OAuth regression rejects reuse of a rotated refresh token.
Better Auth 1.7.7 no longer creates the legacy account.issuer column. The existing
upgrade regression now explicitly seeds that legacy backfilled column, verifies
the account ID/password hash/issuer remain unchanged, and signs the same owner in
after reboot. The application migration and single-owner guards remain unchanged.

Local targeted auth tests: 69 PASS; legacy upgrade/rotation checks: 11 PASS.
Final local full suite: 2025/2025 PASS in 171 files; dashboard E2E: 33/33 PASS.
Frozen install, lint, typecheck and rebuilt server/runtime exclusions PASS.
Audit passes the high threshold with 3 low,
17 moderate and one previously ignored build-only high; no critical finding remains
in this audit. Exact-commit CI evidence is reported for the new SHA separately.
This is source development only. No live auth database, OAuth clients, secret,
consent, deployed instance or credentials were changed. Before a future approved
deployment, review the library's auth-schema migrations against the isolated
Staging database and its recovery evidence; do not assume image rollback reverses
database migrations or restores refresh-token state.
