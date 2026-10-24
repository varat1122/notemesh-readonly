# M4 acceptance — synthetic engineering evidence

Base: PR #112 `ec33c93d6c05c6738af81c92e83be30ed48cf74c`.
Development branch: `feat/m4-owner-reviewed-research-writeback`; PR #112 itself is not modified.

## Proven functional gap and implementation

The existing owner screen only creates a fixed operational marker. The existing graph bundle requires an explicitly authorized MCP action and guarded Obsidian Sync. Direct ChatGPT apply is owner-reported platform-blocked. Neither condition grants a Git research write.

This change adds a default-disabled, authenticated owner review transport for the existing graph-bundle contract. It reuses source/context preparation, graph validation, preview tokens, independent exact-hash admin approvals, atomic Safe Edit publication, persistent locks, Git push CAS, graph verification and indexed archived-AI retrieval. Both approvals/tokens and all reviewed source/anchor/version checks are validated before the first write. Package bytes and bindings persist privately in the existing Safe Edit receipt, not in a new database. Deployment logs omit imported research/context text.

Only a canonical new Analysis and an append to its existing Company Evolution are permitted. Thesis/Evidence Register are hashed references, never automatic targets. Owner actors remain `staging-owner-research:<session user>`; no OAuth actor spoofing or tool rename. The original Obsidian boundary and generic research-server write disable remain unchanged. Only the existing read-only preparation tool becomes available on the Git Safe Edit endpoint.

## Local results

- Full lint: PASS
- Typecheck: PASS
- Production build and client/runtime exclusion guards: PASS
- Full unit/integration/HTTP suite: **1975 passed, 167 files, 0 failed/skipped**
- Relevant acceptance includes missing approval (both notes), wrong actor/token/path/provenance/source SHA, stale/dirty state, duplicate event, partial second write, unknown push, held replay/restart, actual Git blobs/SQLite/FTS/links/backlinks, and Source B recalling A as archived/non-independent analysis.
- Browser E2E using existing system Chromium: **32 passed; 4 BLOCKED** by managed browser `file://` policy in the pre-existing offline demo. The new M4 authenticated/default-disabled route browser check passed. Pinned Playwright browser download was also network-blocked. No browser policy was relaxed and no failure was relabeled PASS.
- Dependency audit: PASS under the existing reviewed exception policy. Metadata: 3 low, 16 moderate, 1 high (1 ignored), 0 critical. No dependency/lockfile change or new ignore was introduced; audit-policy success does not mean no advisories.
- Docker build: PASS, including 399 existing runtime/security tests and typecheck inside the build.
- Docker runtime: PASS — local disposable volume readback, health, SQLite read-only quick_check, tini PID1, M4 anonymous 401 and unprivileged data access/immutable app. Image ID: `sha256:e4bf66fe70c2dadd5784b552cfd01e2698e11e877f72a6dfb5a77336c8822cfb`.

Docker used the repository Dockerfile with a temporary external validation wrapper mounting the session CA as a BuildKit secret and enabling Node's inherited proxy handling. The CA was not committed/copied into image layers; TLS verification stayed enabled. This is local source validation, not a Railway deployment.

Failed intermediate evidence is retained outside Git: early full-suite invocation preceded build completion, one old filesystem test assumed `/tmp` shares the root mount, and overlapping local builds produced incomplete artifacts. The test now explicitly models its filesystem case; final build/tests ran in order on the final runtime source. Source and production behavior were not relaxed to pass gates.

## GitHub and visibility evidence

Source repository is publicly readable without authentication; all additions use code and synthetic data only. PR #112 was independently observed DRAFT at the base SHA through public GitHub HTML. CI display run #394 maps to [40114280754](https://github.com/varat1122/notemesh-readonly/actions/runs/40114280754), observed SUCCESS; it is M3 evidence, not M4 CI.

The M4 branch is explicitly included in the existing CI push trigger to validate the candidate even if PR creation API is unavailable. GitHub API returns Forbidden in this cloud session; public web readback can independently inspect run state. Draft PR creation and exact candidate CI must be reported separately after push.

## Safety and remaining gates

Original workspace/staged P0 files and original evaluation ledger/identity are preserved. No paid inference, real Vault write, backup restore, credential/visibility change, merge, production or staging deployment was performed. M1 is not repeated live and M2 remains paused; no device test is requested.

Live Staging and live ChatGPT interaction: NOT VERIFIED. Owner deployment/write approval, actual single replica, staging-only credential/volume isolation, backup readiness, usage ceiling and frontend tool registration remain independent gates. Two local writes and a network push are not one distributed atomic transaction. Any attempted/partial/unknown operation remains held for manual reconciliation; no automatic retry/rollback. See [owner procedure](OWNER_REVIEW_WRITEBACK_TH.md).
