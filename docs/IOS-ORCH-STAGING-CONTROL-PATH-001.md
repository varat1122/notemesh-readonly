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
A live external/unknown process blocks recovery. Descendants are counted separately, but unregistered children remain HOLD.
Recovery lifecycle availability must be assessed separately before CORE-OPS arming.

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
its nonce; retry is `NO_REEXECUTION`. No result cache is served. A restart appends a terminal HOLD for interrupted admissions with outcome
explicitly unknown; it never replays or erases the RUNNING event. A stale runner
lock still blocks startup until separately authorized operator recovery.
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
| inspect | Build/deployment identity; existing root/DB; integrity/FK; writing/receipt counts; locks; bounded Git HEAD/worktree/upstream-tracking comparison; writer state; FTS path parity; bounded auth/count/receipt evidence and tracked-Vault Git equivalence (no full-content hash). |
| writer_status | Live owned lifecycle/active count/PID/transition and external-process fence. Unknown remains UNKNOWN/HOLD. |
| reconcile_preview_status | Exact m000038 plan/operation/path/after-hash/actor/preview/receipt checks, physical files, FTS, links and competing operation detection. No preview writes. |
| auth_cleanup_wave3 | Resolve IDs from DB using accepted hashes/name, shared owner and zero access+refresh tokens. Refuse ambiguity/mismatch. Fixed parameterized DELETE of exact session/client, transactional integrity/FK and all non-target-row fingerprint checks. Idempotent absent result; no broad cleanup. |
| writer_start | Start only the Foundation Git sync backend (not normal application HTTP startup)/config after quiescent/exclusive checks. No shell/command/config argument. |
| writer_drain | Close admission, await actual in-flight terminal completion, leave gate closed. |
| writer_stop | Require completed controlled drain and safe boundary before stopped-controlled. |

Inspect and preview execute in a dedicated read-only child with an 8-second
budget, a 256 KiB output cap, no inherited credentials, and no shell or dynamic
command. Expiry SIGKILLs its process group, including fixed Git read subprocesses;
the parent waits for close before recording terminal HOLD and releasing admission.
DB <=256 MiB; note <=100 KB; preview rows <=20; auth <=10,000 rows/table; note/FTS
paths <=10,000; receipts <=1,000; Git cumulative budget <=3 seconds/output <=2 MB.
FTS parity compares bounded path sets instead of quadratic correlated queries.
No full-Vault content hashing occurs on the live inspect path.

Process classification derives ancestors from proc stat parent/start-time data.
Only verified init ancestors (tini/dumb-init/railway-init/docker-init) can use
matching stat+comm when exe is unreadable. An unrelated init name is not trusted.
Unknown processes, incomplete lineage, unreadable FD inventories and other
processes' writable FDs in the checkpoint remain HOLD. Responses contain only
PIDs, classification and fixed reasons, never command lines, paths or environment.

Git witness includes clean/untracked/ignored state, hidden index flags, HEAD,
upstream ref/relationship and a fresh read of the accepted local bare remote ref
at wave1-local-git/vault.git, branch ios-p3-remainder-wave1. No fetch or arbitrary
remote transport is executed. Protected proof is explicitly TRACKED_VAULT_GIT_EQUIVALENCE
only at accepted HEAD b69de8c57bafdbd3c75a32c0b056b47103ed87c4 with a clean tree,
no hidden index flags and no ignored entries. The tracked manifest/tree and
historical reference are returned; hash equality is null, not fabricated. This
covers the tracked Vault, not external state or an unknown historical scope.

Read-only auth resolves client/session IDs internally, compares accepted hashes,
name and shared ownership, and counts linked access+refresh tokens. No raw auth
ID or token is returned. Receipt evidence separates all receipts from Wave 3
receipts scoped by the accepted client fingerprint; validates written/readback/
reindex fields, content hash and FTS presence without canonical writes. OS SQLite
locks are observed from proc before opening the read transaction; unknown is not 0.

HTTP disconnect does not cancel admitted work or its terminal audit.
Shutdown closes admission and waits for pending executions, including disconnected
clients, before closing the journal or releasing ownership. Responses
include the committed terminal anchor (sequence/previous/digest/body hash) and a
bounded projection of the last 16 events. This is not a full audit export. A disk
failure cannot be guaranteed away: terminal append failure poisons admission and
remains explicit HOLD. No historical verified/batch/comparator ledger is invented.

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

The observability patch follows e4e584649690cd346f94db308ed983cffebcf62e on the
same engineering branch. Preserve all previous tests and add ancestry/unreadable/
FD cases, realistic 3955-note/64007-link budget tests, auth/receipt/Git/preview
fixtures, child timeout, disconnect terminal audit and interrupted-admission
recovery tests. Full CI and the exact-head staging image workflow are required.

Build after committing: `node scripts/build-staging-control.mjs` creates
`dist/staging-control/{main.mjs,read-worker.mjs,identity.json,acceptance.mjs}`.
The pre-activation assertion validates both bundle hashes and SQLite dependencies.
Root branch-only railway.json continues selecting Dockerfile.staging-control,
start `node control/main.mjs`, and pre-deploy `node control/verify-artifact.mjs --canary`.
Keep recovery mode 0, recovery key absent, existing reader key, volume and DATA_DIR.
Production/default branch and Foundation PR #146 are not modified.

The acceptance client needs IOS_CONTROL_READER_KEY, IOS_CONTROL_EXPECTED_COMMIT,
and IOS_CONTROL_EXPECTED_DEPLOYMENT through the environment. It starts with writer
status, validates bounded witnesses, five fresh executions and audit anchors,
then ten negative cases plus four reader-key recovery rejections. It does not
by itself certify the complete Wave 3 historical boundary or declare recovery READY.
No fixture result substitutes for live runtime acceptance.

Current live canary before this patch: d22a2429-82c8-4ad4-92fd-1669a3897d8e,
commit e4e584649690cd346f94db308ed983cffebcf62e. Prior acceptance HOLD:
writer unknown/unreadable=1 and inspect client timeout/HTTP 499, terminal outcome
unobserved. Do not infer the unknown process is infrastructure without fresh
classification. Do not roll back unless a new mutation/safety risk is established.
Stage only the exact reviewed new commit for the existing staging service after
CI/artifact gates. If Apply requires Owner confirmation, return the staged patch
ID and diff first. Do not apply the entire environment patch without reviewing it.

The accepted Wave 3 checkpoint, auth and Protected reference remain expectations
until fresh runtime evidence passes every gate after deployment. No Wave 3
resume, auth cleanup, recovery mutation, Production deploy, merge main or
Protected mutation is authorized by this engineering acceptance.
