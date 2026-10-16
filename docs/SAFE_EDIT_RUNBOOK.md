# Safe Edit rollout and recovery

## Preflight: do not merge/enable without these checks

2026-10-16 inspection: Production auto-deploys `main`, with **Wait for CI off**.
Merging is therefore a deployment action; do not merge before remaining gates.
The authenticated Backups panel reports **No Backups** and requires Pro to create
them. The user explicitly waived Production Backup in chat on 2026-10-16 and
instructed deployment to continue. No Production backup/restore test is certified.
No plan upgrade or volume resize is authorized by the development request.

1. Inspect Railway's currently running commit and image (not just GitHub HEAD or
   an old successful status). Confirm health `/api/health`, single replica,
   existing service/project/environment IDs and attached persistent `/data` volume.
2. Inspect variable **names and nonsecret settings only**. Keep credential values,
   encryption keys and OAuth/Sync tokens out of chat, PRs and logs. Confirm the
   existing BASE_URL/issuer, CLOUD_INTAKE=1 and volume paths. Do not create a new
   vault or change the old connectors' grants.
3. Normally pause queue processing and Sync under operator control, then take a consistent
   production vault + SQLite backup/snapshot (including journal/backup directory)
   and verify checksums and restore readability. Existing migration backups are
   useful historical evidence, not a fresh production backup. Check disk reserve
   on the real volume before copying anything. A Railway volume/snapshot backup
   must be confirmed through Railway, not inferred from local code. For this
   rollout the user waived that pre-deployment backup; retain the waiver in the
   release evidence. Per-edit backups required by the protocol still apply.
4. Run lint, typecheck, the complete unit/integration suite and the built-server
   HTTP tests. Build the actual Docker image and verify nonroot user, persistent
   volume and health. CI includes the existing container gate.
5. Review changed permissions, diff and backwards compatibility. Check no secrets
   in git diff/staged files. Record pre-deploy commit and rollback release.
6. Deploy the reviewed PR commit with SAFE_EDIT_ENABLED unset/0 initially. Keep
   Railway configuration, storage, credentials and old grants unchanged. Check
   `/api/mcp` and `/api/save-analysis`, OAuth issuer/metadata and readback.
7. After operator verification, set SAFE_EDIT_SINGLE_WRITER=1 and
   SAFE_EDIT_ENABLED=1. These are explicit operator acknowledgements, not proof of
   topology or backup. No code automatically enables them.

## Authorized canary: production synthetic note only

Request explicit permission for this concrete canary after the above gates pass.
Do not test on an actual NVDA thesis.

- Existing folder: `00_Inbox/ChatGPT/`.
- Proposed path: `00_Inbox/ChatGPT/Safe Edit Synthetic Canary 2026-10-16.md`.
- Content: clearly synthetic, no investment conclusion, no verified claims,
  `type: safe_edit_canary`, `status: synthetic`, heading `## Evidence`, body
  `Synthetic canary original. No investment meaning.`
- Create via preview/apply. Read through NoteMesh. Prepare exact replacement
  `Synthetic canary original.` → `Synthetic canary changed.`; apply and verify
  expected hashes, audit, receipt and search index.
- Repeat the apply to verify idempotency. Prepare a stale second edit and verify
  conflict refusal. Preview rollback and confirm it restores the previous hash.
- Read-only/inbox/API-key credentials must receive 401/403 and must never expose
  callable Safe Edit through old resources. Verify old submissions still work
  only with explicit inbox consent.
- Check remote arrival from a separate Obsidian client; record which device and
  observed content/hash. Only inspecting this server through NoteMesh proves
  server readback, not remote Sync. Verify mobile separately on the actual phone.
- Retain the canary as an audit artifact; no automatic deletion tool exists.

## Release rollback

Disable SAFE_EDIT_ENABLED first. Preserve all receipts and backups. Roll the app
image/commit back to the recorded previous release while keeping `/data` mounted.
Never restore a whole old volume over new user evidence as an app rollback.
Old code ignores Safe Edit's additive tables. Restore a note only through a
version-guarded reviewed rollback, with explicit thesis approval if applicable.

## Interrupted operation recovery (administrator only)

Do not automatically steal a lock or replay a `writing` operation. Disable Safe
Edit, pause intake/Sync and confirm no server writer remains before maintenance.
Back up SQLite and all involved files, then inspect operation payload, receipt,
backup manifest, backup SHA-256 and current note SHA-256.

- Current hash equals beforeHash: original note is intact. Mark the operation
  failed/recovered in a reviewed maintenance transaction, retaining its journal
  and backup. Record a recovery audit event. A new operation requires a new diff.
- Current hash equals afterHash: the rename happened. Verify full readback,
  metadata and index; complete the existing receipt/claim ledger in a reviewed
  transaction instead of applying again. Do not claim remote Sync verified.
- Neither hash matches: another version exists. Preserve it as evidence. Resolve
  in a new reviewed correction/merge; never blindly replace it from backup.

Only after this review remove a crash-held `/data/safe-edit.lock` and re-enable.
No MCP tool exposes arbitrary SQL, lock deletion or blind recovery. A proposed
maintenance change must be concretely reviewed; this runbook is not permission
to make an unreviewed SQL change in production.

## Release evidence checklist

Record these independently: CODE_READY, TESTED, DEPLOYED, CONNECTED,
WRITE_VERIFIED, REMOTE_SYNC_VERIFIED, MOBILE_VERIFIED. Include exact commit,
Docker deployment ID, test command/results, connection/surface used, operation
IDs, paths, before/after hashes and the evidence for each claimed Sync stage.
