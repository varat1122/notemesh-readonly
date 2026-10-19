# Investment OS — NoteMesh Disaster Recovery (P1, NOT ACTIVE)

## Offline coordinated cut — explicit interprocess gate, independent fixture restore (2026-10-19)

This Draft adds `withCoordinatedOfflineFixtureCut()` beside (not in place of) the earlier `withOfflineFixtureCut()`. It composes **the existing process-local Writer Fence → awaited Sync pause → existing crash-sticky interprocess exclusion → external halt attestation → pre/post source fingerprint → capture**, keeping all protections active across asynchronous work. It is **offline fixture-only** and rejects every Railway environment.

The lock is an explicit **sibling scratch directory**, not a file inside the snapshot source: `/tmp/nm-dr-snapshot-fixture-<id>` pairs only with the pre-created `/tmp/nm-dr-ipc-fixture-<id>`. Missing/unsafe gate roots fail closed; no automatic lock-root creation or stale-owner reaping. Lock owner bytes are never included in restored Vault or SQLite data. `assertNoExternalWriters() === true` remains necessary but is **not sufficient**; the coordinator also has to acquire real interprocess exclusion. It cannot prevent unregistered writers from bypassing the lock, even when a cooperating writer is blocked.

Additional Vitest integration tests use a **separate real Node process with better-sqlite3 WAL**, hold its writer lock, and prove that a snapshot is rejected without capture despite a misleading true Boolean. They also test lock persistence on SIGKILL, missing gate, Railway refusal, a deliberately unregistered writer changing bytes, and a full synthetic encrypted `.nmb` creation/verify/restore with SQLite `integrity_check` and exact Markdown readback.

**Status remains `NO_GO`:** fixture lock cooperation cannot establish service-wide writer coverage, real Obsidian client quiescence, app.sqlite cross-process leases, multi-DB temporal consistency, real Google Drive production backup or off-server restore. Do not turn this into a Production snapshot endpoint/scheduler or deploy it based on tests alone. No actual source archives, original investment notes, credentials or portfolio data are operated on.


## Runtime writer-admission observations (development only, 2026-10-19)

A new `SnapshotWriterFence.getAdmissionEvidence()` returns **read-only process-local observations**: current `activeWriters`, `frozen`, and `activeByClass` for named tickets. It explicitly reports `scope: "this_node_process_only"`, `completeRuntimeWriterCoverageVerified: false`, `externalWriterQuiescenceVerified: false` and `productionSnapshotReady: false`.

Existing writer entry points can now provide a typed, optional class label without changing admission policy or the original `fence.status` compatibility shape. This Draft labels selected actual paths: app SQLite bootstrap, writable market-price SQLite connection lifetime, original-source archive, user attachments, Vault atomic writes, protected Safe Edit, Better Auth HTTP handler, Git command children, bounded Obsidian CLI commands, market-price collector and direct Drive price refresh. Anonymous/untagged calls remain `unclassified`. Named nested calls are recorded under their admitted parent; **nested class counts must not be summed to infer distinct writers**.

Unit and integration tests verify active labels while actual async Better Auth requests and writable PriceStore connections hold their tickets, nested admission, freeze refusal, timeout, exception cleanup and double-release. The observer opens **no new HTTP/MCP endpoint**, performs no Vault scan and writes no persistent audit data.

**Critical limits:** these are in-memory labels supplied by selected call sites, not independently measured I/O. A direct `db()` handle may be mutated outside a tagged helper; not all Better Auth entry points, external subprocess lifetimes, background jobs, other Node replicas, CLI processes, SQLite WAL/checkpoint writers or remote device activity are proven included. An empty map, green test or `frozen: true` **cannot** authorize a Production snapshot. The existing writer-coverage register and all Production DR NO-GO/approval gates remain authoritative.


## Writer-class coverage register — read-only release blockers (2026-10-19)

`node scripts/backup/nm-writer-coverage-register.mjs` emits a machine-readable, **source-only** writer-risk register. It **does not inspect the live Vault, Google Drive or device state** and is **not** wired into the Production create, restore or scheduling paths. It builds on the earlier source-heuristic inventory, rather than competing with it.

- The register explicitly names **13 mandatory risk classes**: Vault writes, protected Safe Edit, user attachments, original-source archive, app SQLite/WAL, Better Auth, market price SQLite, Drive price publish, Git Sync, Obsidian Sync, background price collection, other processes/replicas and external devices.
- Each locally inspectable class has exact source witnesses (path + literal token); if a known witness moves or disappears, `assertSourceWitnessRegisterStable` fails closed in the existing DR fixture CI test suite. Source mutation is a **review trigger**, never a conclusion that the writer has gone away.
- The report separately counts write candidates outside registered witness files and lists those paths for next human investigation. These are **unclassified source candidates**, not definitive mutating operations.
- External replica/device classes have no meaningful source-only witness. They require independent runtime quiescence evidence that a source scan cannot supply.
- The report deliberately retains `runtimeCoverage: "not_verified"` for **every class**, `productionSnapshotReady: false`, `approvalStatus: "NO_GO"`, `independentRestoreVerified: false`. No user input, environment flag or green static test can promote them.

**Known limitations:** literal witnesses may be moved into comments, or dynamic reflection/indirect libraries may hide writes; the scanner does not detect every external writer. This is an inventory stability check, **not comprehensive coverage, a production admission gate, an owner approval or a restore certificate**.

**Next development milestone:** assign testable, runtime-evidence requirements for each writer class; instrument actual writer admission/drain across every relevant process and SQLite handle; independently prove Obsidian/Git subprocess exit and off-server snapshot restoration. Keep all Production backup creation guards and approval boundaries unchanged.


## Resource-lifetime interprocess ticket — offline fixture only (2026-10-19)

Development extension of the existing `nm-interprocess-fixture-gate.mjs` — **not a replacement lock service, not a Production gate**.

- `acquireFixtureInterprocessTicket(root, purpose)` holds the shared atomic-mkdir gate for the **full lifetime of a fixture writer resource**, including an open SQLite handle or async task, until explicit `release()`. Existing `withFixtureInterprocessExclusion` delegates to the same ticket API to avoid competing lock implementations.
- Gate acquisition and release refuse unknown purpose, Railway env, non-scratch path, concurrent holder, tampered inode or token, and double release. On process death a lock remains sticky; no PID/age-based automatic lock stealing.
- Child-process regression tests prove **writer→snapshot** and **snapshot→cooperating writer** exclusion, owner tampering and successful release/re-admission. A separate adversarial fixture shows that **noncooperating** writes are not blocked at all; this is a hard Production release blocker, not a passed consistency check.
- The snapshot and writer sides must BOTH enroll, and each long-lived write resource must hold its ticket until *all* filesystem/SQLite/remote mutations finish. This fixture gate currently serializes all participants; it is neither a scalable read/write lease nor cross-host/distributed coordination.

**Remaining P0:** inventory all true Production writer owners; design proven admission/quiescence across NoteMesh replicas, Better Auth, SQLite open handles/WAL/checkpoint, Git/Obsidian Sync subprocesses, price/Google Drive I/O, background jobs and external producers. Require crash/timeout recovery, independent verification and isolated restore. No Railway backup or auto-scheduler may use this fixture API; NO GO remains.

## Writer-surface inventory blind-spot review — development only (2026-10-19)

On top of Draft PR #51, the read-only `nm-writer-source-inventory.mjs` now flags additional potential writer entry points previously missed by its synchronous `fs.*Sync` matcher:

- `fs.promises.*`, common `fsp`/`fsPromises` aliases, explicit named `node:fs` / `node:fs/promises` imports and aliases, `createWriteStream`, and asynchronous file-handle mutation calls.
- `open` without flag analysis is a **candidate**, not necessarily a mutator; `fenceReferencedSomewhereInFile` is NEVER proof that the detected call is covered by the fence.
- New isolated regression fixture checks candidate capture and keeps `productionSnapshotReady: false`, `externalWriterQuiescenceVerified: false` and `verified: false`. The scanner remains incomplete: dynamic imports, custom wrappers, HTTP/API writes, subprocess writes, raw SQLite extensions, Better Auth/background writers, cross-process Git/Obsidian Sync and writes outside `src/server` / `src/routes` require separate explicit review.

**Fail-closed gate remains:** no coordinator on this branch attests every writer class, no global process/device freeze exists, and this inventory improvement is NOT a Production consistent snapshot or permission to run `nm-backup.mjs create` on Railway. Next engineer must inventory and test each external/process write admission, SQLite WAL checkpoint policy and quiescence evidence *before* lifting any Railway guard.


**2026-10-18.** This branch is a *pre-deployment, offline/fixture* implementation. The current production Vault has **not** been backed up by this code. Do not merge, schedule or deploy until the gates below pass.


## Integrated DR offline recovery acceptance chain — development-only (2026-10-19)

The existing `nm-cloud-dr-drill.test.mjs` has been expanded to call **both real DR transport modules** in sequence: a synthetic NoteMesh dataset (Vault note, original-source file, Obsidian home fixture, app SQLite WAL, market-price SQLite WAL) → genuine AES-GCM `.nmb` builder → local authenticated verify → `nm-drive-upload.mjs` using **mocked Google HTTP** → upload receipt plus complete remote ciphertext readback → **independent `nm-drive-recover.mjs` invocation** using its verified receipt, metadata checks and full local SHA-256 download → local authenticated verify → restore into fresh isolated directory → exact synthetic notes/originals/home and SQLite schema/data integrity checks.

Previously, that end-to-end test bypassed the recovery module by copying the original mock-upload buffer directly to the offline restore folder. The new test passes through the actual offline downloader instead.

A second negative-path test simulates a Drive object that becomes corrupted **after** a successful upload/readback receipt. The recovery attempt must reject the changed remote bytes, delete its partial downloaded file, and leave no restoration artifact. This prevents an old upload success from being mistaken for evidence of subsequent retrieval success.

**Boundary and no-go:** Google transport remains mocked, fixture writers are synthetic, and the tests run in GitHub Actions (not live Staging OAuth, not Production). They do NOT prove a global Production writer cut, a real Google Drive `.nmb` upload/download, a full off-server Production backup, key escrow or a restore of current Investment OS data. All Deployment and protected Vault write gates remain intact.

## Direct Market Prices Drive refresh writer admission — development-only (2026-10-19)

Previously, the high-level `refreshPrices()` function entered the DR process-local Writer Fence, but a caller could directly invoke `DrivePriceCache.refresh()`. The direct method is a separate write-capable entry point that can publish remote Google Drive price archive and catalogue generations after asynchronous network I/O without acquiring admission itself.

This Draft now wraps the entire direct `DrivePriceCache.refresh()` lifecycle in `inProcessDrWriterFence.withWrite(async ...)`: an already-running refresh must drain before a fixture snapshot proceeds; any refresh initiated after a freeze begins fails before attempting a Drive publish or loading a catalogue; nested calls already admitted by `refreshPrices()` reuse their existing AsyncLocalStorage scope. Regression tests exercise refusal before remote work and draining an in-flight asynchronous refresh.

**Strict boundary:** This covers **one NoteMesh process** only. Google Drive writes from other replicas, independent worker processes, external tools or credentials cannot be frozen by a local Writer Fence. It also does not prove that read/write access to the on-disk Vault/SQLite, Obsidian continuous Sync, or device-synced Markdown files is globally coordinated. No Production snapshot coordinator, schedule, remote Backup or Restore is activated.

## Nonstandard SQLite file gate — development-only (2026-10-19)

The offline snapshot builder now refuses `*.db`, `*.sqlite3`, `*.db3` and their `-wal`/`-shm`/`-journal` sidecars. It also reads the first 16 bytes of other regular files and refuses a raw SQLite database with the standard `SQLite format 3\\0` magic under an unrecognized extension.

**Why:** the encrypted snapshot previously copied unrecognized SQLite files as ordinary files. A live journal/WAL database can be torn or missing committed data if copied without SQLite's online backup protocol. Explicit fail-closed refusal avoids a deceptively successful recovery receipt. Supported `*.sqlite` files still use the online SQLite backup API followed by integrity checks.

**Residual gaps:** encrypted SQLite containers, databases using an unusual header, arbitrary binary databases, SQLite snapshots that are each individually valid but taken at different instants, unknown database writers and uncoordinated Obsidian Sync are **not** proven safe. The schema/filename check is not a globally consistent production snapshot. Production create remains disabled on Railway and all DR PRs remain Draft.

## Offline Drive recovery readback — development-only (2026-10-19)

The new `scripts/backup/nm-drive-recover.mjs` can recover a **previously uploaded, immutable encrypted NMDR1 bundle** from Google Drive **into a new local offline directory**. It does not create a snapshot, change Railway configuration, update Vault notes, or start a restore in Production.

- Prerequisites: existing **verified** `nm-drive-upload.mjs` receipt (`fileId`, `folderId`, byte count and SHA-256), dedicated `drive.file` OAuth credential sealed with the original `ENCRYPTION_KEY`, **separately retained** `NOTEMESH_BACKUP_PASSPHRASE`, Node 24, GNU tar, and writable **existing absolute** offline destination.
- The CLI validates the Drive file's ID, name, parent folder, byte size, appProperties hash, downloads the entire encrypted object and recomputes SHA-256 locally. It opens the destination with `O_EXCL | O_NOFOLLOW` and never overwrites an existing file. A partial/mismatched download is deleted.
- After transport readback it additionally calls the existing `nm-backup.mjs verify` to authenticate AES-GCM, validate manifest entries and check SQLite integrity. An unverified bundle is removed.
- The tool refuses Railway runtime markers, deployed `/data` and configured `DATA_DIR`, symlinked output directories and receipts not marked verified. It does **not** automatically run `restore`: the operator must separately initiate an offline isolated restore.
- Preserve the two private recovery secrets **outside the uploaded Drive bundle**: the bundle passphrase and the original application encryption key. A downloaded bundle without them may be unrecoverable.
- Synthetic/mock Drive tests and CI do **not** establish that an actual Production snapshot exists, that Google credentials remain usable later, that Drive retains the file, or that a real Production dataset restores correctly.

```bash
# OFFLINE, explicitly authorized operator workflow ONLY — never execute on Railway.
# Provide secrets through a private mechanism. Do not paste them in chat or commit.
node scripts/backup/nm-drive-recover.mjs \
  --authorize-recovery \
  --receipt /private/receipts/notemesh-predeploy-....nmb.receipt.json \
  --out-dir /offline/empty-existing-folder

# Only after verify succeeds, do a separate isolated offline restore:
node scripts/backup/nm-backup.mjs restore \
  --bundle /offline/empty-existing-folder/notemesh-predeploy-....nmb \
  --dest /offline/new-nonexisting-restore-folder
```

**P0 release blockers remain unchanged:** no proven globally consistent Production writer pause, durable cross-process lease, true off-server Production .nmb receipt, isolated Production restore, or recovery key escrow. This feature alone does not authorize Merge/Deploy of PR #36 or #47.

## Phase 1.4 — verified Staging cloud test and complete offline fixture chain (18 October 2026)

This section supersedes the initial PRE-TEST status further below; earlier notes remain preserved as historical development records. Never treat a staging fixture as a real production recovery.

### Observed evidence

- Google DR OAuth and Refresh Token: Staging OAuth callback returned HTTP 303. The one-time encrypted credential was created, stored privately and confirmed in a subsequent user-triggered token refresh. The staging credential-check POST returned HTTP 200 at 17:33:58 Bangkok (2026-10-18 10:33:58 UTC), independently observed in Railway HTTP logs. No Google Drive file was accessed for this check.
- Real Google Drive fixture: user manually initiated POST /api/backup-drive/fixture-upload, HTTP 200 at 17:54:55 Bangkok (2026-10-18 10:54:55 UTC), confirmed in Railway logs and by the user reporting PASS. The handler returns HTTP 200 only after creating a new app-owned folder, uploading random AES-GCM-encrypted NMDRFIX1 bytes, downloading Drive ciphertext, verifying SHA-256 and decrypting the original random payload. This was NOT a real encrypted .nmb backup. The test folder and object intentionally remain in Drive.
- The one-time Staging Drive upload gate NOTEMESH_DRIVE_FIXTURE_TEST_ENABLED was immediately reset to 0 after the successful test. Replacement Railway deployment returned SUCCESS. There is no automatic upload or recurring schedule.
- Complete REAL-FORMAT .nmb OFFLINE test: scripts/backup/nm-cloud-dr-drill.test.mjs creates an isolated synthetic NoteMesh directory, generates a genuine NMDR1 encrypted .nmb archive, verifies it, passes ciphertext through a MOCKED Google Drive resumable upload/download transport, creates a separate downloaded bundle, cryptographically verifies it, restores into a new sandbox, and compares synthetic Markdown notes, source-archive, fake Obsidian home state and both app and market-price SQLite tables and integrity. The deliberately corrupted readback must fail without a verified receipt. Passing this mock-transport integration test proves the archive/transport/recovery integration boundary only; it does not prove a live Google-Drive .nmb restore.
- GitHub Draft PR #36 remains unmerged; only a separate, disposable Railway Staging service was deployed for testing. Production remains on main, unchanged.

### Phase 2.1 — offline-only coordinated snapshot lifecycle (Draft, 18 October 2026)

The Draft adds `src/server/backup/offline-snapshot-cut.ts` as an **isolated test helper only**. It is not mounted on any API, job, cron, or Railway production service. It rejects Railway service/environment markers and deployed DATA_DIR roots outright.

The tested operation order is: (1) freeze in-process writer admissions, (2) wait for registered in-flight writes to drain within a deadline, (3) request Obsidian Sync pause and await confirmed daemon exit, (4) require positive fixture-only external-writer halt assertion, (5) run asynchronous isolated snapshot, (6) resume Sync and release admissions after success or failure. If any step fails, capture must not run and existing writers must be unblocked after cleanup. Tests cover concurrent writes, timer expiry, missing external halt, snapshot failure and Railway restrictions.

**Not a production-ready consistent snapshot:** external halt in this helper is a **mock fixture assertion**, not verified proof of disabled desktop/mobile sync or another process. Neither the in-process fence nor this orchestrator catches arbitrary direct SQLite writers. Before any live coordinator is implemented, define a durable distributed/exclusive writer lease with known fencing behavior; enumerate and enroll all mutate-capable pathways; freeze SQL/auth/background queue operations; verify one active deployment/replica and no external sync writer; enforce immutable source/volume boundaries; calculate bounded scratch space; and test actual .nmb Drive recovery through a separate, authenticated restore environment.

### Phase 2.3 — Vault indexer SQLite writer fencing (Draft, 18 October 2026)

The background Vault Indexer previously wrote to app.sqlite through its own direct transactions while rebuilding note/FTS/link/attachment indexes or responding to Chokidar events. Draft PR #36 now enrolls the indexer's in-process SQLite mutations (note/FTS upsert and deletion, link resolution, attachments and full-index wipe) through `inProcessDrWriterFence.withWriteSync`. Rejected watcher writes and interrupted full rebuilds schedule a post-thaw reconciliation rebuild instead of silently losing index changes or crashing on a freeze exception. Temporary fixture regression tests assert unchanged SQLite rows during freeze and recovery after thaw.

This does **not** stop Obsidian Sync, out-of-process indexers, direct writes on the shared SQLite connection from other application modules, or all server endpoint writers. Existing reconstruction of the search index on boot remains the disaster-recovery safety net. A green CI does not establish whole-volume atomicity, restore safety or production readiness.

### Phase 2.4 — Git History and Git Sync writer fencing (Draft, 18 October 2026)

Git-backed NoteMesh also mutates the Vault and app.sqlite. This Draft adds process-local write admission for `applyGitHistory()` (SQLite note/attachment timestamps and its in-memory time caches), for each asynchronous `GitBackend.cycle()` from fetch through merge, conflict-file resolution, metadata refresh and push, and for the setup `cloneVault()` operation until checkout completes. A refused Git cycle while a fixture freeze is active does not incorrectly mark the sync backend as failed or put it into persistent backoff. Regression fixtures check that frozen Git metadata changes leave SQLite/cache unchanged, clone cannot create files, and a frozen sync attempt cannot start Git writers.

A long-running Git network operation **may keep the drain waiting**; timeout must fail closed and leave the existing Vault untouched by any backup capture. A process-local admission gate is NOT cross-process fencing. No live coordinated Backup, scheduled sync pause, Git/Obsidian external writer verification, or Production deployment is enabled.

### Phase 2.4 (continued) — Obsidian CLI child-process coverage

`runOb()` now holds an in-process DR Writer Ticket for each complete external Obsidian CLI child-process lifetime, including login/credential-home side effects, sync setup, manual sync and settings-sync commands. Freeze admission is rejected **before** `ensureDataDirs()` or process spawn. A long-running command blocks snapshot drain until it exits, and a timeout rejects capture. Added isolated fake-CLI tests for refusal-before-spawn and drain-until-exit.

**Boundary still open:** the continuously running `ob sync --continuous` daemon is launched directly by `SyncSupervisor` rather than `runOb()`, so it is *not* covered by these tickets. Offline fixture `withPausedForEdit()` separately waits for the daemon to exit before capture, but this has not been proven against Production's actual processes or any external devices. Other raw CLI, filesystem and SQLite writers and cross-process exclusivity remain unverified.

### Phase 2.5 — writer coverage hardening and outstanding inventory (Draft, 18 October 2026)

This phase addresses previously unregistered **in-process** mutators, NOT end-to-end production snapshot consistency:

- **Vault content:** `writeVaultFile()` enters a process-local writer scope before any temp file creation/rename. `createNote()`, `moveNote()`, `deleteNote()`, `moveFolder()`, and `deleteFolder()` enter before directory creation, rename, removal and cascading link rewrites. Synthetic test fixtures exercise rejection during freeze, intact data/paths and resumption afterward.
- **Administration:** OAuth client revocation deletes its consent, access, refresh tokens and client row in one fenced SQLite transaction. Admin password reset holds one async admission ticket through Better Auth password update and session invalidation; neither is permitted to begin after freeze.
- **Reentrancy:** An operation admitted *before* freeze may call other fenced helpers across awaited I/O without failing midway solely because the freeze began. Context is scoped to its live operation and expires on its return; snapshot callbacks run outside write scope and all new unrelated admissions are rejected. Tests exercise nested writer completion, snapshot drain, self-freeze refusal and denial of writes during capture.

This is NOT a cross-process lease or general SQL transaction coordinator. Remaining explicit **NO-GO** findings and required evidence:

| Path/class | Current boundary | Gate to production |
| --- | --- | --- |
| `app.sqlite` shared `db()` handle | Individual known writers fenced; other direct `prepare().run()`, `exec()`, ORM or auth plugin pathways may bypass admission | Enumerate all write statements/routes and instrument every mutator, including asynchronous state transitions |
| Better Auth sessions/OAuth/API keys | HTTP handlers fenced, admin revoke/reset now fenced; internal background refresh and other direct adapter entry points not proven | Exercise realistic auth background operations and freeze race with SQLite writes |
| Obsidian continuous daemon, desktop/mobile | Offline fixture helper can stop and await local child only; desktop/mobile clients and out-of-process writers unverified | Positive evidence of daemon and external writer quiescence before capture |
| Git and market prices | Process-local Git cycles, CLI calls and PriceStore disk handles enrolled; other processes, manual CLI and external Drive price backend not coordinated | Verify backend selection, process count, leases and all other write surfaces |
| Full Vault, source archive, home, SQLite | No verified globally consistent cut of every data class | Real-format, isolated, synthetic `.nmb` restore through a verified live Drive transport, followed by integrity/lineage validation |
| Backup scheduler/retention/credentials | No automated Production backup; no proven recovery escrow, durable retries or alert policy | Document RPO/RTO, recovery runbook, monitored schedule, private key escrow, failure rollback |

**Never infer consistency from a green CI, process-local ticket counts, mocked Google Drive transport or isolated fixture snapshots.** PR #36 remains Draft and Production remains out of scope.

### Phase 2.6 — isolated interprocess exclusion rehearsal (Draft, 18 October 2026)

**Purpose:** prove that two distinct Node.js processes can refuse a conflicting synthetic write/snapshot on a shared local filesystem. This is NOT an active server lock, a durable distributed fencing system, or a production backup coordinator.

- Added `scripts/backup/nm-interprocess-fixture-gate.mjs`: a separate **opt-in** exclusive directory lock (atomic `mkdir`) for both fixture writer and fixture snapshot callbacks. It accepts only freshly created `nm-dr-ipc-fixture-*` directories directly beneath the resolved OS temporary directory, refuses Railway identifiers and any deployed data root, rejects symlink aliases, and never accesses Production volumes.
- Only **cooperating fixture processes** using the gate are serialized. Unregistered HTTP/ORM operations, other containers/replicas, external Obsidian desktop/mobile sync, CLI commands and non-cooperating writers continue unaffected. This helper is intentionally **not wired to NoteMesh runtime or the live Snapshot Coordinator**.
- Stale locks remain sticky after a crash or SIGKILL. No PID-age expiration, TTL guess, forced unlock or automatic stale-lock cleanup. A lock ownership mismatch forbids deletion. An operator must prove process quiescence before manually clearing a fixture lock; the helper must never auto-delete production data.
- Added `scripts/backup/nm-interprocess-fixture-gate.test.mjs`: launches a real second Node.js process that owns the writer lock, verifies capture is refused while it is alive, succeeds only after it exits normally, and verifies crash-sticky and tampered-owner fail-closed behavior. This exercises a real local OS process boundary, **not** actual distributed deployment behavior.

**Production NO-GO remains:** no live writer has enrolled in an interprocess protocol. Before enabling any production snapshot, prove that *every* writer class obeys a shared, durable coordination mechanism; that lock acquisition is atomic on the actual Railway volume/filesystem; that a losing or stale owner cannot write after a lease changes hands; that sync/SQLite writers are quiescent across all processes; and that takeover, network partition, crash, retry and restart do not violate consistency. A single-instance process-local freeze or an optional fixture lock cannot establish these facts.

**Restoration evidence still outstanding:** the real-format `.nmb` archive was verified and restored with a mock Google transport; the previous real Drive Staging test used a different synthetic envelope. A complete real-Drive `.nmb` upload → independent download → isolated restore, using *synthetic data only*, needs a separately approved, protected Staging session and user OAuth consent. No Production activation, Merge, new billable Railway resources or expanded Drive permissions are authorized.

### Phase 2.7 — SQLite bootstrap race, OAuth purge and source-level writer inventory (Draft, 18 October 2026)

- `db()` now obtains a process-local writer ticket **before** creating directories or opening app.sqlite, and holds it through WAL setup and all app-owned migrations. The connection is published only after successful setup; a failed migration closes its handle. Previously checking `frozen` once had a race between the check and SQLite opening. Synthetic tests verify that an unopened SQLite file cannot be created while frozen and that normal read-only queries remain available once initialization completed.
- The Better Auth anonymous OAuth-registration cleanup is now independently fenced, and freeze refusal is **re-thrown**, not swallowed by the client-cap exception handler. This only covers that specific direct SQL path; it does not establish that all Better Auth and third-party adapters are enrolled.
- `withOfflineFixtureCut()` now rejects any `DATA_DIR` that is missing, deployed, not a **real canonical directory directly inside OS scratch** named `nm-dr-snapshot-fixture-*`, or a symlink alias. Fixture tests cover path spoofing, missing directories and pre-capture refusal. This is not sufficient against deliberately malicious out-of-process filesystem swaps and does not authorize a live snapshot.
- `scripts/backup/nm-writer-source-inventory.mjs` is a **read-only, conservative code inventory**. It enumerates likely SQL mutators, direct filesystem writes and external process starts by source filename/line only, without printing contents or opening a Vault. A file-wide reference to `inProcessDrWriterFence` is marked *reference only*, **never proof that each write is guarded**. The report is permanently classified `source_heuristic_human_review_required` and `productionSnapshotReady:false`. It is an audit aid, NOT a static formal proof; indirect/native/vendor mutations can be missed.

**Unresolved blockers:** all Better Auth/internal adapters and direct SQLite calls must be covered with positive runtime evidence; a durable, enforced cross-process protocol must enroll every production writer (the isolated Phase 2.6 lock is NOT wired to NoteMesh); the sync daemon, external devices, additional processes and Volume consistency must be proven quiet; a real-format synthetic `.nmb` must be independently downloaded and restored after authenticated **real Google Drive** transport; encryption-key escrow, RPO/RTO, costs, scheduler and alerts remain unapproved. Until then: NO Production backup activation, Merge, Production Volume change or Production restore.

### Phase 2.8 — direct Git and Better Auth adapter writer admission (Draft, 18 October 2026)

This change set strengthens **process-local**, not cross-process, coverage on existing runtime call paths:

- `runGit()` and `runGitBuffer()` now hold writer admission across the full lifetime of **each** Git subprocess. The freeze check occurs **before** process creation. This also covers direct Git invocations outside `GitBackend.cycle()`; nested calls made by a pre-admitted cycle reuse its active scope without deadlocking. Git commands that seem read-only can still mutate Git metadata or the object database.
- `resolveConflict()` now holds one outer writer scope through Git reset, conflict-file creation and the final commit. Refusal occurs before any Git or filesystem mutation. Tests cover direct unadmitted Git text/binary entry points, long-running Git subprocess drain, and direct conflict handling refusal during a fixture cut.
- Direct Better Auth adapter call sites now explicitly enroll: Dashboard API-key creation/revocation, admin `getSession` calls, MCP API-key validation and intake-worker API-key validation. These are separate from the already-fenced `/api/auth/*` route and protect asynchronous adapter work even when invoked from other server functions. MCP key validation propagates `backup_writer_freeze_active`, rather than silently interpreting it as a bad credential; intake worker fails without invoking its adapter. Synthetic tests verify admission refusal, adapter call suppression and asynchronous drain.
- `nm-writer-source-inventory.mjs` now also flags direct `auth.api.*` call sites. This tool remains source-heuristic and emits `verified:false` for every candidate. Referencing a fence in a file does **not** certify that each candidate is covered.

**Production NO-GO remains:** Better Auth and other third-party internals are not exhaustively instrumented; direct SQLite connections, filesystem utilities, worker processes, Obsidian continuous Sync, mobile/desktop clients and any external writers need independently verified runtime closure. Phase 2.6's opt-in interprocess lock is **only** an isolated fixture primitive and does not govern NoteMesh runtime. Green CI is not snapshot-consistency evidence. Real encrypted `.nmb` Drive upload/readback and isolated restore with synthetic data requires a separately authorized protected Staging session. PR #36 remains Draft with no Production deployment, automatic schedule, Volume changes or restore.

### Phase 2.9 — synthetic-source stability verification (Draft, 18 October 2026)

The offline-only `withOfflineFixtureCut()` now makes a **bounded before/after source-tree fingerprint** while the process-local Writer Fence is frozen and the fixture Sync Pauser holds its pause. The fingerprint visits every file/directory in the canonical `nm-dr-snapshot-fixture-*` scratch tree, hashes file bytes plus selected file identity/metadata and paths, refuses symbolic links/hardlinks/special files, and caps inspection to **4,096 files and 256 MiB**. If a non-cooperating writer changes the source between the two inspections, the capture result is rejected with `dr_fixture_source_changed_during_cut`. Regression tests deliberately invoke a **separate real Node.js process** to edit a synthetic note while the mock external-halt callback erroneously claims success, plus create/delete/replace, unsafe symlink and oversized fixture cases.

An additional integration regression runs a genuine encrypted `.nmb` create, cryptographic verify and isolated SQLite/Markdown restore **inside the fixture Coordinator** with an explicit mock Sync pause. The subprocess does **not** inherit `DATA_DIR` from the coordinator because `nm-backup.mjs --fixture-only` correctly refuses backing up its own live directory. All bytes are synthetic, and the archive/restore destination lives outside the source fixture. This checks archive-format and coordinator integration without using Google Drive, deployed Railway, real keys or Production Data.

**Important limitations:** comparing two scans is not an atomic snapshot; a rapid write-and-revert, modification inside a single scan that evades available stat metadata, or an unregistered process writing after the second scan can remain undetected. A capture callback may already have produced an isolated artifact by the time the consistency check fails: callers must quarantine/delete any failed or unverified fixture artifacts and must **never** publish a successful receipt. The source-directory traversal is read-only; it is not integrated into any Production or Railway workflow. The `assertNoExternalWriters` callback is still only a simulated fixture assertion and is not evidence that Obsidian desktop/mobile or another container has stopped writing.

**Production remains NO-GO:** require a real source-consistent storage cut with all Vault, home, source-archive and SQLite writers enrolled or positively quiescent, with durable cross-process fencing and crash tests. No change in this phase activates live backup, changes the Production volume, uploads data to Drive or removes the requirement for protected Staging end-to-end `.nmb` recovery with synthetic data.

### Phase 2.10 — direct Git metadata cache admission (Draft, 19 October 2026)

The exported `recordLocalModification()` and `forgetModification()` helpers previously changed the process-local Git timestamp and birth-time maps directly. Although Vault file operations and `applyGitHistory()` had outer admission, a direct caller could change those caches during a fixture Writer Freeze without entering the fence. Both helpers now acquire `inProcessDrWriterFence.withWriteSync()` independently; nested calls by already admitted Vault/Git writers continue normally. New tests verify direct calls are rejected *before* modifying either cache during Freeze, restore normal write/evict behavior after thaw, and allow nested metadata updates from an in-flight admitted writer to drain before capture.

This is **metadata-cache consistency only**, not disk or cross-process writer closure. A green regression does not establish that the shared SQLite handle, Better Auth internals, Obsidian continuous daemon, external devices, Git subprocesses in another process or Production volume are frozen. No active Snapshot Coordinator, Backup Schedule, Drive upload, live Production change, staging service or Restore has been enabled by this change.

### Production safety blockers: hard NO-GO

1. PROVE COMPLETE WRITE FREEZE: Obsidian Sync must be stopped and awaited, and EVERY writer class must enroll in the same admission and drain mechanism. The shared in-process SnapshotWriterFence has only PARTIAL wiring in this Draft branch, not comprehensive coverage.
2. PARTIAL WRITER COVERAGE: The Draft now admits Safe Edit preview/approval/apply/status, Cloud Intake batches, market-price refreshPrices, storeUserAttachment, captureOriginalDocumentBytes, intake enqueue/acknowledge, app setSetting/deleteSetting, the full Better Auth GET/POST HTTP handlers, Better Auth schema migrations, and RPC POST requests through a process-local fence. Disk-backed writable PriceStore connections now retain an admission ticket until close, guarding direct PriceStore.db mutations during the open lifetime. Regression tests check refusal during freeze and draining existing handles. This is **NOT complete coverage**: other MCP/REST write endpoints, alternate app SQLite/direct DB calls, admin writes, unfenced background jobs, SQLite connections outside the shared fence, out-of-process indexers/writers and external Obsidian devices remain unaudited. There is still NO approved consistent production snapshot.
3. MARKET/EXTERNAL COVERAGE: The main refreshPrices entry point holds an asynchronous ticket over fetch, persistence and cleanup; *open writable disk-backed* PriceStore handles independently retain tickets for their lifetime, but constructors or writes in other processes do not. Obsidian clients on other devices, third-party CLI writers, direct database access outside this connection wrapper and multiple Railway replicas must be positively coordinated. A process-local fence cannot stop another process.
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
