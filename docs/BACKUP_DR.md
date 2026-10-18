# Investment OS — NoteMesh Disaster Recovery (P1, NOT ACTIVE)

**2026-10-18.** This branch is a *pre-deployment, offline/fixture* implementation. The current production Vault has **not** been backed up by this code. Do not merge, schedule or deploy until the gates below pass.


## Phase 1.4 — verified Staging cloud test and complete offline fixture chain (18 October 2026)

This section supersedes the initial PRE-TEST status further below; earlier notes remain preserved as historical development records. Never treat a staging fixture as a real production recovery.

### Observed evidence

- Google DR OAuth and Refresh Token: Staging OAuth callback returned HTTP 303. The one-time encrypted credential was created, stored privately and confirmed in a subsequent user-triggered token refresh. The staging credential-check POST returned HTTP 200 at 17:33:58 Bangkok (2026-10-18 10:33:58 UTC), independently observed in Railway HTTP logs. No Google Drive file was accessed for this check.
- Real Google Drive fixture: user manually initiated POST /api/backup-drive/fixture-upload, HTTP 200 at 17:54:55 Bangkok (2026-10-18 10:54:55 UTC), confirmed in Railway logs and by the user reporting PASS. The handler returns HTTP 200 only after creating a new app-owned folder, uploading random AES-GCM-encrypted NMDRFIX1 bytes, downloading Drive ciphertext, verifying SHA-256 and decrypting the original random payload. This was NOT a real encrypted .nmb backup. The test folder and object intentionally remain in Drive.
- The one-time Staging Drive upload gate NOTEMESH_DRIVE_FIXTURE_TEST_ENABLED was immediately reset to 0 after the successful test. Replacement Railway deployment returned SUCCESS. There is no automatic upload or recurring schedule.
- Complete REAL-FORMAT .nmb OFFLINE test: scripts/backup/nm-cloud-dr-drill.test.mjs creates an isolated synthetic NoteMesh directory, generates a genuine NMDR1 encrypted .nmb archive, verifies it, passes ciphertext through a MOCKED Google Drive resumable upload/download transport, creates a separate downloaded bundle, cryptographically verifies it, restores into a new sandbox, and compares synthetic Markdown notes, source-archive, fake Obsidian home state and both app and market-price SQLite tables and integrity. The deliberately corrupted readback must fail without a verified receipt. Passing this mock-transport integration test proves the archive/transport/recovery integration boundary only; it does not prove a live Google-Drive .nmb restore.
- GitHub Draft PR #36 remains unmerged; only a separate, disposable Railway Staging service was deployed for testing. Production remains on main, unchanged.

### Production safety blockers: hard NO-GO

1. PROVE COMPLETE WRITE FREEZE: Obsidian Sync must be stopped and awaited, and EVERY writer class must enroll in the same admission and drain mechanism. The existing SnapshotWriterFence is in-process and not yet connected to all mutators.
2. Vault Safe Edit, attachments, evidence/Thesis edits, source archives, independent Cloud Intake importer and application/authorization SQLite are not yet shown to share a single snapshot fence. A cloud-intake periodic busy flag is not sufficient.
3. Market-price SQLite collection, third-party out-of-process CLI writers, Obsidian clients on other devices and multiple Railway replicas must be positively coordinated. A single process in-memory fence cannot stop another process.
4. Safely snapshot all discovered SQLite databases using the online backup API while ensuring cross-component point-in-time coherence. Never raw-copy an active WAL SQLite file.
5. Independently recover the separate backup passphrase, original ENCRYPTION_KEY, OAuth/auth dependencies and Obsidian Sync identity. A sealed OAuth credential alone does not make recovery possible.
6. Bound on-host scratch capacity outside Production's small persistent volume; implement durable failed-upload records, alerts, retention and tested no-loss rollback before enabling a scheduler.
7. Prove an actual encrypted .nmb Google Drive upload, full ciphertext download, AND isolated restore from that downloaded artifact. The live Google test so far used synthetic NMDRFIX1 bytes, not a .nmb.

Do not merge Draft PR #36, modify Production credentials or volumes, automate production backups, restore over any deployed DATA_DIR, auto-delete Drive data, or treat --offline-confirmed as proof of a coordinated live writer pause. Await explicit operator approval and documented evidence for each gate.

## Evidence from main and Railway

- NoteMesh data root: `DATA_DIR=/data`, persistent Railway mount `/data` (1 GB).
- `/data/vault`: Markdown and attachments, including protected thesis/portfolio.
- `/data/home`: Obsidian Headless authentication/sync state. Treat as secret.
- `/data/app.sqlite`: application, authorization, settings, lineage, journals, safe-edit operations, indexes. `db.ts` uses WAL. **Never** make a raw copy of a running `app.sqlite`.
- Additional files under `/data` must be inventoried and covered by a validated policy; the fixture utility copies regular non-SQLite files and creates an online SQLite backup of **every discovered `*.sqlite` database under `/data`**, including `app.sqlite` and a nested `market-prices/prices.sqlite` when present. Non-`.sqlite` database formats require separate inventory.
- Existing `docs/GOOGLE_DRIVE_PRICES.md` is a *price-data* archive backend: it does **not** back up Vault, SQLite application DB or Obsidian Sync state; do not reuse its tokens or assume its signed (not encrypted) price snapshots are DR backups.
- Existing Drive folder: Investment_OS/Backups/NoteMesh with Daily, Weekly, Monthly, PreDeploy. On inspection 2026-10-18 those folders contained no verified DR bundles. Do not recreate or clear them.
- Railway production source follows `main`. PR #33 stays unmerged. No Railway variables, secrets, sync settings, volumes or deployment changed in this phase.

## Offline fixture bundle

Requires Node 24, GNU tar and a **separately generated**, high-entropy `NOTEMESH_BACKUP_PASSPHRASE` injected through a secure local/CI secret store. This is **not** `ENCRYPTION_KEY`; retain the original Railway `ENCRYPTION_KEY` separately for application credential recovery. Never store either in Git/notes/logs.

```bash
# On an isolated fixture ONLY; do not copy or run against the live production volume.
NOTEMESH_BACKUP_PASSPHRASE=... node scripts/backup/nm-backup.mjs create \
  --data-dir /path/to/offline-fixture --out /path/to/output \
  --kind fixture --fixture-only
NOTEMESH_BACKUP_PASSPHRASE=... node scripts/backup/nm-backup.mjs verify \
  --bundle /path/to/output/notemesh-fixture-....nmb
NOTEMESH_BACKUP_PASSPHRASE=... node scripts/backup/nm-backup.mjs restore \
  --bundle /path/to/output/notemesh-fixture-....nmb --dest /path/to/empty-sandbox
```

The utility refuses active/unacknowledged writers by requiring a **manual offline confirmation flag** for non-fixture use. The flag itself is not proof that Obsidian Sync is stopped. The bundle consists of a compressed tar encrypted via AES-256-GCM, random IV and salt, scrypt KDF; an encrypted internal manifest lists every regular file and its SHA-256. Each `*.sqlite` file is rebuilt via SQLite's online backup API, validated with `integrity_check`. Database WAL/SHM sidecars are excluded in favor of transactionally backed-up committed state. Restore checks AES-GCM authentication, manifest hashes, file counts and SQLite integrity, and refuses non-empty targets. It is intentionally **not** a production-safe synchronized Vault snapshot while Obsidian Sync is active.

For production, ensure copied live Vault contents and home state are coherent with database, and use an in-app coordinated quiescence point with safe-edit/Obsidian writer lifecycle. Require bounded staging/free-space, interruption handling and read-only production snapshot before enabling automated jobs. Do not run this offline CLI directly against an active Railway data mount.

## Drive upload: pending security/authorization gate

A ChatGPT-connected Google Drive OAuth grant cannot be copied into Railway. A separate Google OAuth client/refresh grant with minimal `drive.file` permissions, access to the selected existing backup folder (e.g. Google Picker selected/authorized item) and secure Railway secret handoff is needed. `drive.file` does **not** grant automatic access to arbitrary user-created folders. Alternatively authorize a separate app-created Drive folder explicitly without touching or deleting existing backups. No service-account key should enter the repository.

For production upload, the branch includes an **explicitly gated prototype** `scripts/backup/nm-drive-upload.mjs`: a bounded 8-MiB-chunk resumable encrypted-bundle uploader, Google metadata/parent check, full ciphertext download with SHA-256 readback, and local verified receipt. Tests mock HTTP only. **Google OAuth, real upload/readback, error retry/resume after ambiguous network failures, durable job scheduling and failure alerts remain unverified/unimplemented.** Do not operate it against production yet. A failed upload may leave an orphan Drive object; there is no auto-delete. Storage bucket and GitHub artifacts are not replacements for a Drive-verified backup. **Do not write unencrypted snapshot bundles to Drive.**

Proposed retention, applied only to backup objects after verified inventory and deletion authorization: Daily 7, Weekly 4, Monthly 3, PreDeploy hold until manually released. No automatic deletion until full restore is proven. Source archives remain separate from DR bundles.

## Safety gates before PR #33

1. Complete fixture tests/CI. Fix any failures; record commit and run ID.
2. Design production coordinated read-only snapshot: safe-edit writer mutex plus Obsidian Sync pause/restart; account for deletion and concurrent clients.
3. Complete minimal OAuth permission and verified Drive ciphertext upload/download; keep secrets out of Git.
4. Restore into an **isolated** target; validate notes/attachments, SQLite tables, receipt/lineage and source archives, plus Obsidian sync secret dependence. Never restore over a live Vault.
5. Verify daily/weekly/monthly/predeploy scheduling, budgets, low-disk handling, alerts and retention with dry runs first.
6. Only then review PR #33's merge auto-deploy and prepare Railway rollback and protected-thesis gates.

**Status notation:** implementation ≠ fixture tests passed ≠ Google upload/readback ≠ production snapshot ≠ complete disaster recovery.

## Drive uploader (development only)

Use a separate OAuth Web App grant restricted to `https://www.googleapis.com/auth/drive.file`. The existing manually created folder may require explicit Google Picker selection so the app may see it. Inject `NOTEMESH_DRIVE_CLIENT_ID`, `NOTEMESH_DRIVE_CLIENT_SECRET`, `NOTEMESH_DRIVE_REFRESH_TOKEN`, and the separate backup passphrase using a secure secret store. These are not the market-price OAuth variables.

```bash
# DEV ONLY — do not run without a properly approved isolated Drive fixture folder and keys
node scripts/backup/nm-drive-upload.mjs --bundle /path/to/notemesh-fixture-...nmb \
  --folder-id YOUR_AUTHORIZED_TEST_FOLDER_ID --receipt-dir /path/to/receipts --authorize-upload
```

The uploader first verifies the local encrypted bundle with the backup passphrase; then it uploads **without overwrite** and downloads the ciphertext for SHA-256 comparison. It does not delete or implement backup retention. No real user Drive grant was made or tested as part of PR #36. Before deployment, define recoverable token ownership, safe refresh, retries, alerting, and a one-writer coordinator inside the existing NoteMesh service. The `--authorize-upload` flag is a development gate, **not** a substitute for permission or safety review.

## Phase 1.1 — Source hardening and read-only preflight (not activated)

The offline snapshot now opens regular files using Linux O_NOFOLLOW and verifies the opened descriptor remains inside the resolved source root. Files are copied with inode/mtime/size checks. Unsafe symlinks and special files are refused; the source budget is capped at 100,000 files and 2,000,000,000 bytes. Both manifest and isolated restore retain empty folders.

scripts/backup/nm-dr-preflight.mjs provides read-only source inventory, coarse category counts, and an approximate scratch-space check without emitting filenames, notes, or credentials. It explicitly reports writerQuiescenceVerified=false and snapshotReady=false even if expected directories exist. Railway metadata alone cannot attest to the mounted volume's file-level state.

Run the preflight only on an isolated fixture or with explicit authorization for read-only on-host inspection:

    node scripts/backup/nm-dr-preflight.mjs --data-dir /path/to/data

SyncSupervisor.withPausedForEdit now awaits asynchronous callbacks while keeping the pause and mutual-exclusion flag active. A regression test checks that the daemon stays paused until the callback resolves. This is a building block, NOT an activated production backup coordinator.

Production remains gated: other Vault writers and the price collector need cross-component coordination. The system must restore sync on error, preserve secrets, verify disk staging capacity, and forbid any backup job that cannot establish writer quiescence. Do not invoke the offline CLI on the live Railway volume or assume a CLI confirmation flag proves safe quiescence.

Recovery hardening: restore now refuses any existing destination (including an empty directory), rejects symlink ancestors, and requires a new sandbox directory under an existing normal parent. Fixture-only mode checks the real path of its source so a symlink alias to a deployed data root is not accepted.

## Phase 1.2 development — writer admissions and full local DR drill (NOT DEPLOYED)

- `src/server/backup/writer-fence.ts` implements a fail-closed, in-process freeze primitive. It rejects new mutators while frozen, drains tracked writers before invoking an asynchronous snapshot, and unfreezes even if an operation throws or reaches the bounded drain timeout. The associated Vitest suite covers overlap, exclusion, timeout, mutation failure, and async snapshot lifecycle. **It is not integrated with all production writers, so it does not authorize any live snapshot.** Obsidian Sync must independently be stopped and awaited, and each Vault, attachment, original-source, application-SQLite, and market-price mutator must join a proven shared freeze boundary. Multiple replicas and out-of-process writers remain blockers.

- `scripts/backup/nm-dr-drill.mjs` provides a **self-cleaning, OFFLINE FIXTURE ONLY** recovery exercise: encrypted local create → decrypt/verify → isolated restore → compare source and recovered regular-file SHA-256, empty directory structure, SQLite schema, row content, and integrity across all discovered SQLite DBs. The report prints aggregate counts and digests only; raw notes, row values, filenames and tokens are not logged. The script refuses Railway and the configured deployed DATA_DIR.

```
NOTEMESH_BACKUP_PASSPHRASE="<secure 32+ byte fixture passphrase>" \
  node scripts/backup/nm-dr-drill.mjs --fixture-data /path/to/ISOLATED-fixture
```

This drill **does not** prove Google Drive readback, production consistency, restored OAuth usability, or end-to-end disaster recovery. A production recovery rehearsal needs dedicated OAuth authorization, an isolated environment, coordinated writer pause, off-production archive handling, and explicit review of credentials, retention and possible costs. No merge or production deployment is authorized by fixture success.

## Phase 1.3 (Draft, NOT deployed) — dedicated DR Google OAuth callback

- New signed-in administrator setup route: `/api/backup-drive`; callback: `/api/backup-drive/callback`. Separate from `/api/market-prices-drive`. OAuth consent uses Google `drive.file` **only**, PKCE S256, random one-use user-bound state (5 minute expiry), exact HTTPS redirect URI and strict same-origin form POST. No OAuth code, refresh token or client secret is logged. HTML is no-store, frame-denied and locked by CSP.
- The setup route cannot start OAuth until `NOTEMESH_DRIVE_SETUP_ENABLED=1` is **explicitly approved and securely configured on the deployed NoteMesh service**. It is off by default and has NO scheduling, no backup creation and no cloud writes. Creating the Google Cloud OAuth Client does not switch it on.
- OAuth Client type: **Web application** for Railway. The latest Railway domain observed on 2026-10-18 was `https://notemesh-production-a893.up.railway.app`. If Railway domain and `BASE_URL` remain unchanged, the exact Google Authorized Redirect URI will be `https://notemesh-production-a893.up.railway.app/api/backup-drive/callback`. Verify `BASE_URL` and the live setup page before relying on this URI; it does not exist on deployed `main` until approved deployment.
- Use Google Cloud [OAuth Clients](https://console.cloud.google.com/auth/clients) to add the exact redirect URI under the **separate** `Investment OS DR - Railway` OAuth Web client, and [Audience](https://console.cloud.google.com/auth/audience) to verify the operator's account is an authorized Test User. The operator enters `NOTEMESH_DRIVE_CLIENT_ID` and `NOTEMESH_DRIVE_CLIENT_SECRET` in **Railway private variables**, never in GitHub, Obsidian, source files or chat. No Railway variables are changed in this Draft PR.
- On successful consent, one-use admin screen exposes an **AES-256-GCM sealed** DR credential derived by HKDF from the existing `ENCRYPTION_KEY`, distinct from market-price OAuth credential. The operator may save this envelope in Railway private `NOTEMESH_DRIVE_CREDENTIAL` directly; the raw refresh token is never pasted into chat or stored plaintext in a Railway variable. The offline uploader now decrypts `NOTEMESH_DRIVE_CREDENTIAL` using `ENCRYPTION_KEY` rather than `NOTEMESH_DRIVE_REFRESH_TOKEN`. Keep the original encryption key securely recoverable as part of disaster recovery.
- **No encrypted production backup or verified Google Drive upload exists yet.** `drive.file` alone does not grant access to the existing manually created NoteMesh backup folder. Design app-created dedicated backup folder or Google Picker authorization separately; test upload, authenticated readback and isolated restore. Do not broaden the OAuth scope to unrestricted Drive just to access a preexisting folder.
- Google External + Testing grants (Drive scope) generally produce refresh tokens that expire after seven days: unattended backups require a suitable production OAuth publishing/verification decision and an independently observed long-lived credential. Do not assume Publishing status alone removes all other account/security risks or that creating a Client completes OAuth.
- **Outstanding live blockers:** production writer quiescence across all mutators, recovery of app secrets, safe snapshot staging outside the small volume, Google folder authorization, upload retry/resume, retention, alerts and a tested isolated production-data restore. No merge, deployment, Railway plan upgrade, credentials changes, or activation are authorized by adding Test Users or code in this branch.


## Railway staging admin claim hardening (Draft only — verify CI before use)

When `RAILWAY_ENVIRONMENT_ID` exists and `RAILWAY_ENVIRONMENT_NAME` is not
`production`, first-admin signup is additionally gated by
`NOTEMESH_STAGING_CLAIM_SECRET`, a *distinct* operator-created, high-entropy
secret at least 32 characters long, held only in staging's Railway private
variables. If missing or weak the signup endpoint fails closed even during
the 30-minute initial claim window. The browser setup form transmits the
proof over HTTPS as a request header; the server checks it before accepting
first-admin signup. Do not paste it in chat, GitHub, logs or Obsidian.

No first-admin proof is configured in the current DR staging service, so **do
not expose a public domain yet**. Before running browser OAuth, configure a
staging-only proof privately, ensure staging's BASE_URL and HTTPS callback are
correct, arrange a controlled claim window, create a separate test admin and
test only with synthetic data. A production Railway environment is unchanged
by this guard. The guard does not replace other app security controls or
supply an OAuth credential, backup key or volume persistence.
