# Investment OS — NoteMesh Disaster Recovery (P1, NOT ACTIVE)

**2026-10-18.** This branch is a *pre-deployment, offline/fixture* implementation. The current production Vault has **not** been backed up by this code. Do not merge, schedule or deploy until the gates below pass.

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
