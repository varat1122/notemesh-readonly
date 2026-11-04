# IOS-ORCH-STAGING-CONTROL-PATH-001 — CORE-ENG

Status: local implementation; **NOT_READY_FOR_RECOVERY_PHASE_2** until actual
staging activation and runtime acceptance. Loopback/fixture tests are not staging
acceptance. No new IOS task ID. Primary Product Master: v1.2.0, SHA-256
`25e6d9bf1059a080ac2da1ca9f9eb886d54bcdb784fa9f4b09525399229bd90e`.
Foundation parent: `b0aeed37b910efbd3a96a52d41b885621e7f25d7` (PR #146).

## Code reality and design

Normal middleware calls ensureSyncStarted, ensureIndexerStarted,
ensureCloudIntakeStarted and ensurePriceCollectorStarted on requests. Normal
DB initialization also migrates schema. It is unsuitable as a maintenance entrypoint.
The standalone `main.ts` imports neither middleware nor application bootstrap.
The bundle builder rejects auth, canonical engine, indexer and intake dependencies.
It listens only on port 8080, `POST /v1/maintenance`. No unauthenticated health or
inspection route, no generic exec, SQL, file or target selector. Railway must use
a TCP health check (clear the ordinary `/api/health` HTTP check).

Read-only inspection uses `node:sqlite` with readOnly and query_only; it never
imports the application DB initializer. No schema migrations, WAL checkpoints,
index rebuilds, Git fetch, auth cleanup or canonical writes on runner startup.
Startup writes only its control journal/ownership lock outside the checkpoint.
The accepted GitBackend is lazy-loaded only for explicit recovery lifecycle calls.
Its existing application DB initialization is used on writer recovery; CORE-OPS
must assess that existing initialization against the accepted runtime before arming.

Changes to Foundation are limited to explicit controlled Git lifecycle methods
and gates; existing normal stop semantics are preserved for existing consumers.
`drainControlled` synchronously closes all Git admissions (poll, manual, startup,
debounce and Safe Edit), waits for the tracked cycle, checks locks/writing state,
and leaves admission closed. Timeout/failure is UNKNOWN/HOLD, never idle.
`stopControlled` requires a proven drain; restart is not drain. No stale-lock theft.
A live external/unknown process blocks recovery. Runner-owned Git subprocesses
are counted separately so an actual in-flight Git cycle can drain.

## Request contract and security

Exactly these JSON fields: `request_id`, `nonce` (16–96 ASCII alphanumeric,
underscore or hyphen), `operation`, `target`, `issued_at` (UTC ISO timestamp).
Only inspect may additionally specify `diagnostic:"controlled_read_only_failure"`.
All unknown keys are rejected; recovery accepts no arguments.

Target must exactly equal the `TARGET` constant in `contract.ts`: project
`8ac4a414-9f0b-4a90-bcce-4995e5736d9d`, environment
`bce3bde4-29c1-44e5-8cfe-7400db9f7f51`, service
`0f673bc3-e433-4641-85a8-12b2678eb040`, volume
`b4115737-ff34-4912-92d7-7524d27c969b`, foundation SHA above,
`data_root=/pilot-001-data/p3-hist-batch-001-r2`, `tier=staging`.
The independently observed runtime variables must match; no missing identity,
Production fallback, extra `/data` mount, symlinked root, or replica count other
than exactly 1 is admitted. Build identity compares platform commit to the baked
commit and verifies the running bundle's SHA-256. Local build verifies Foundation
ancestry and clean Git tree. Railway source builds require the engineering branch;
operators MUST pin its reviewed commit and verify ancestry before deployment.

Headers: `x-ios-key-id: reader|recovery`; `x-ios-signature` is lowercase hex
HMAC-SHA256 over the exact string `POST\n/v1/maintenance\n` plus raw JSON body.
Use separate random 256-bit hex `IOS_CONTROL_READER_KEY` and optional
`IOS_CONTROL_RECOVERY_KEY` secrets outside Git. Authentication precedes parsing
and dispatch; timestamp tolerance is 60 seconds; request bound is 4096 bytes.
TLS terminates at the existing Railway HTTPS edge. Do not expose raw port 8080
via a TCP proxy. Neither auth headers, raw request payloads, credentials nor
exception messages are logged. Rotation uses Railway secret replacement and a
controlled restart; nonce history is independent of key rotation.

Recovery requires the recovery key AND `IOS_CONTROL_RECOVERY_ENABLED=1`.
**For CORE-ENG acceptance leave it unset/0 and do not provision a recovery key.**
Writer start additionally requires a reviewed JSON `IOS_CONTROL_RECOVERY_PACKET`
with exactly `task`, `writerRemote`, `writerBranch` and its SHA-256 in
`IOS_CONTROL_RECOVERY_PACKET_SHA256`; it must match existing DB settings and
SAFE_EDIT_GIT_REMOTE/BRANCH, with single writer acknowledgment. Values cannot be
provided by requests. No accepted writer remote/branch values have been recovered
from this task's OAuth-only control plane (variable names only).

Nonce and request ID are unique in a FULL-synchronous SQLite transaction before
operation dispatch. A failed, busy, interrupted or successful execution consumes
its nonce; retry is `NO_REEXECUTION`. No result cache is served. A process crash
leaves the RUNNING admission as UNKNOWN/HOLD operationally; do not replay it.
Recovery of an uncertain mutation needs a fresh inspected state and a new explicit
request. Terminal audit failure poisons admission in that process.

Journal: `/pilot-001-data/ios-staging-control-001/control.sqlite`; ownership lock
in the same directory. INSERT-only events, update/delete rejection triggers,
SHA-256 hash chain, fresh execution IDs, actor class, admitted target, nonce,
request ID, timestamps, terminal result/error, implementation identity and result
digest. Cleanup records verified before-counts durably before DELETE and after-
counts in its terminal result. This is auditable, not tamper-proof against root;
export chain anchors separately. Never delete nonce history to rotate credentials.
A stale runner lock is HOLD: inspect the prior process and uncertain admissions
before operator recovery; the endpoint cannot remove it.

## Operations

| Operation | Behavior |
| --- | --- |
| inspect | Build/deployment identity; existing root/DB; integrity/FK; writing/receipt counts; locks; bounded Git HEAD/worktree/upstream-tracking comparison; writer state; FTS path parity; conservative Vault content fingerprint. |
| writer_status | Live owned lifecycle/active count/PID/transition and external-process fence. Unknown remains UNKNOWN/HOLD. |
| reconcile_preview_status | Exact m000038 plan/operation/path/after-hash/actor/preview/receipt checks, physical files, FTS, links and competing operation detection. No preview writes. |
| auth_cleanup_wave3 | Resolve IDs from DB using accepted hashes/name, shared owner and zero access+refresh tokens. Refuse ambiguity/mismatch. Fixed parameterized DELETE of exact session/client, transactional integrity/FK and all non-target-row fingerprint checks. Idempotent absent result; no broad cleanup. |
| writer_start | Start only existing accepted Git backend/config after quiescent/exclusive checks. No shell/command/config argument. |
| writer_drain | Close admission, await actual in-flight terminal completion, leave gate closed. |
| writer_stop | Require completed controlled drain and safe boundary before stopped-controlled. |

Bounds: DB <=256 MiB; note <=100 KB; preview rows <=20; auth scan <=10,000
rows per auth table; cleanup preservation scan <=100,000 rows per table; Git
commands <=5 seconds and 512 KB output; drain <=10 seconds. Exceeding a bound is
HOLD. The Vault fingerprint covers <=20,000 entries/256 MiB and excludes `.git`;
it does not claim complete Protected-state coverage or an accepted baseline match.
Remote Git relationship uses existing tracking refs only, explicitly not a fresh
remote observation. No implementation-status/verified-batch ledger is invented.

## Accepted Wave 3 evidence

Owner-provided primary `IOS-ORCH-P3-HIST-REMAINDER-001-WAVE3-recovery-HOLD.json`,
supporting `IOS-ORCH-P3-HIST-REMAINDER-001-WAVE3-HOLD.json` (facts supplied in chat;
these files were not mounted locally). Ownership VERIFIED, cleanup NOT_EXECUTED,
client/session/access-token 1/1/0. Client name and ID hashes are compiled into
`recovery.ts`; raw IDs are resolved in the accepted DB and never emitted.
Marker absent; actor string alone never authorizes cleanup.

Preview exact IDs/paths/hashes are compiled into `inspect.ts` from Owner evidence.
Operator provenance journal remains untouched:
`/pilot-001-data/p3-hist-batch-001-r2/.operator-recovery/ios-p3-historical-remainder-wave3.journal.jsonl`.

Preserve: verified 2/90; receipts 3; accepted batches 0; m000018/m000029 never
replay; m000038 preview-only, canonical resume point; residual auth 1/1/0.
No CORE-ENG command has operated on this remote checkpoint. These remain accepted
Owner state, not newly measured live counts.

## Verification and activation gate

Local suites: staging-control, sync, safe-edit, M5.3/M5.4 canonical integration,
canonical workflow, investment router and Foundation comparator/context semantics.
Local runner/sync/canonical subset: 270 tests passed; typecheck and changed-file lint passed. Includes all 14 requested categories,
real SQLite/fixed filesystem fixtures, five fresh loopback HTTP requests, all eight
negative cases, durable replay across journal reopen/key change and crash-before-
completion, ownership mismatch and timeout/controlled-stop semantics. Fixture auth
cleanup is exercised only in disposable temporary directories.

Build locally after committing: `node scripts/build-staging-control.mjs`.
This creates `dist/staging-control/{main.mjs,identity.json,acceptance.mjs}`.
The acceptance client uses only reader credentials and the fixed HTTPS service URL:
`node dist/staging-control/acceptance.mjs`. It produces per-run JSON evidence,
checks fresh request/nonce/execution IDs and result digests, exact preview state,
then all eight negative cases. Loopback tests do NOT count as those live runs.

Activation is blocked in this executor:

1. HTTPS service endpoint `notemesh-pilot-001-staging.up.railway.app` returns
   proxy CONNECT 403 (2026-11-04 09:30 UTC). Control-plane backboard access alone
   cannot carry runner acceptance traffic. Add this exact domain to the published
   environment's restricted allowed hosts, preserving backboard access.
2. Connected Railway tooling can inspect config/logs but exposes no live process/
   filesystem command and no CLI credential here. Latest observed INSPECTION_COMPLETE
   log is 05:16:36 UTC, not a current writer/drain/checkpoint proof. Obtain a current
   read-only runtime process/lock/checkpoint and volume-permission witness via an
   authorized staging operator/control connection BEFORE replacing the deployment.
   Old success logs do not authorize stopping a possibly live Wave 3 writer.

No staging config/secret change or deployment has been made. Once the gates are
resolved, pin the reviewed candidate, use Dockerfile.staging-control, explicitly
replace the old inspection start command with `node control/main.mjs`, remove any
pre-deploy command and HTTP health check, retain one replica and the existing
volume/mount. Disable sleep/restarts during acceptance as appropriate without
booting the ordinary application. DATA_DIR must equal the exact checkpoint path.
Provision only the dedicated reader key; retain existing secrets without printing
or recreating them. Journal directory must be writable by node without recursive
chown of checkpoint. Verify no other staged changes before activation.

Observed prior deployment / rollback candidate:
`222bd2b6-82f1-4203-a5fe-ab368bb0c8a9` (Foundation #146), service
`notemesh-pilot-001`, exact staging IDs above. Its service command is the OPS008
inspection-only command, NOT normal application startup. Before actual activation
export the complete current config as a protected operator artifact, reconfirm
rollback availability (control plane reported canRollback=true on 2026-11-04) and preserve the volume; rollback restores that exact
inspection command/source/config without resetting the checkpoint. Do not roll
back through the default Docker CMD. No deploy or rollback has been executed.

No Production Deploy. No Merge Main. No Wave 3 Resume. No Protected Mutation.
