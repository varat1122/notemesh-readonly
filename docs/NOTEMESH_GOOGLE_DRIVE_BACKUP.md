# NoteMesh → Google Drive Backup (staged design / NOT ACTIVE)

**Implementation state:** Google Drive user folder created separately through the connected Drive account. This PR contains an **offline, encrypted, operator-invoked snapshot-and-restore-verification CLI**; a scheduled uploader and server credentials are NOT configured. Do not treat a folder or a local snapshot as a successful remote backup.

## Scope & release gates

The Railway production service currently uses one replica and a persistent **/data** volume. That data includes the Obsidian Vault, SQLite WAL-mode application database, archived original source bytes, journal, source snapshots, sync profile, and optional market-prices data. Copying only \`vault/\` or only \`app.sqlite\` is insufficient for disaster recovery.

The backup code must remain on a **separate branch** until it has been reviewed and tested. **Do not merge into main as an incidental change:** Railway currently tracks \`main\`, so merging can auto-deploy. Do not enable a cron, create a second Railway service, duplicate a live writer, touch current Vault data, or set new billable infrastructure without an explicit release decision.

## CLI foundation

Runs on Node **24+**, installed \`tar\`, and no model/API tokens:

\`\`\`sh
# Create a separate 32-byte random key. Store safely OUTSIDE Railway and Google Drive.
# Never use NoteMesh ENCRYPTION_KEY or a user-chosen passphrase.
openssl rand -hex 32

# Requires operator to have actually quiesced Obsidian Sync and all Vault/DB writers.
# Do NOT set NM_BACKUP_SOURCE_QUIESCED=1 as a permanent Railway variable.
NM_BACKUP_SOURCE_QUIESCED=1 \
NM_BACKUP_ENCRYPTION_KEY="<separately-stored-64-hex-character-key>" \
node /app/scripts/notemesh-backup.mjs create /data /tmp/notemesh-20261018T070000Z.nmbk

# Verify (decrypt in ephemeral temp, extract, verify file hashes + restored SQLite quick_check)
NM_BACKUP_ENCRYPTION_KEY="<same-private-key>" \
node /app/scripts/notemesh-backup.mjs verify /tmp/notemesh-20261018T070000Z.nmbk
\`\`\`

**Do not execute the above on live Railway yet** until there is an authorized, reliable way to pause/resume Obsidian Sync and other writers, a verified off-volume staging capacity, and a secure method to supply the key without including it in shell history or logs. A human-set \`NM_BACKUP_SOURCE_QUIESCED\` flag is only an operator assertion, **not** evidence that the service actually paused.

The encrypted format is \`NMBK1GCM | random 96-bit nonce | AES-256-GCM(ciphertext of tar.gz) | 128-bit tag\`. The encrypted tar includes a versioned JSON manifest and a staged copy of /data. Its file hashes are SHA-256; SQLite \`*.db\` / \`*.sqlite\` are snapshotted with Node's SQLite online backup API, not copied from live WAL sidecars. Non-SQLite \`.db\` files are preserved unmodified. The verification command authenticates the GCM tag **before extracting**, then validates individual stored hashes and SQLite \`PRAGMA quick_check\` on restored snapshots. No automatic restore overwrites production paths.

**Limitations:** The snapshot is not guaranteed cross-file atomic while Obsidian Sync or another writer is active. The tool rejects a detected changed file during copy, but a coordinated snapshot still requires a real writer/sync pause. Symlinks/devices are blocked; an unsupported existing Vault layout needs a reviewed exception rather than broad permission. Up to 800 MiB source data by default; encrypted staging and verification require temporary disk outside /data. File mtime is not sufficient to prove an external actor never wrote during the overall operation.

## Google Drive upload

The connected Google Drive account currently has the **private** folder tree:
\`Investment_OS / Backups / NoteMesh\`.

Keep this folder PRIVATE; the existing \`Primary_Source_Archive\` must not be altered or used as backup storage. This directory is presently **empty or not populated by a verified encrypted NoteMesh snapshot**; no remote readback or disaster-restore test has happened.

To automate Drive upload from Railway later, a separate authenticated uploader is needed, using user-granted OAuth with least-privilege access to the **exact selected backup folder**, never token text posted into GitHub or a Vault note. The ChatGPT Drive connector's consent is **NOT a reusable Railway server credential**; a \`drive.file\` credential created by another app may not see this folder without explicit Drive Picker authorization. Do not broaden to full Drive scope automatically. Upload unique, non-overwritten encrypted blobs, verify full server-side readback SHA-256, log receipts containing size/hash/folder ID/generation, and retain a manual offline copy of the encryption key. Do not delete old generations automatically before remote upload and restore have been tested.

## Proposed operational cadence (not activated)

- Daily: 7 latest verified generations
- Weekly: 4 latest verified generations
- Monthly: 3 latest verified generations
- PreDeploy: one pinned recovery generation before any production merge/migration
- Every backup: local manifest/hash + encryption auth + SQLite restore check, Drive upload and remote SHA readback
- Quarterly: perform one **non-production** recovery test to a clean isolated directory with the stored key; confirm users can open resulting Obsidian notes and SQLite content

**Missing to close rollout:** audited real pause/resume orchestration, upload OAuth setup/Google folder ACL, encryption-key escrow, safe bounded retention, scheduled trigger with no extra paid service, alerting on failure, an actual Drive upload/readback, and an actual recovery rehearsal.

## Google Drive folder / required setup

Folder IDs should be provided only as protected runtime configuration, not checked into a public repository. All Backup feature toggles must default OFF. The user must explicitly approve enabling recurring snapshots and daily uploads on the production container.

## Test gate

\`\`\`sh
node --test scripts/notemesh-backup.test.mjs
pnpm lint && pnpm typecheck && pnpm test && pnpm build
\`\`\`

Also verify Docker image test and runtime backup CLI packaging. Tests use a disposable fixture with a live SQLite WAL connection, a Thai Markdown note, and original source binary, and reject wrong-key/ciphertext tampering, existing destination, unquiesced input, and symlinks.
