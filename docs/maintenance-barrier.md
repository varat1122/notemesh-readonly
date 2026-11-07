# Restart-persistent maintenance barrier

Task IOS-ORCH-RI-001, blocker `NO_RESTART_PERSISTENT_MAINTENANCE_BARRIER`.
Code: `src/server/maintenance.ts` (registry, state, fence, resume),
`src/server/maintenance-drain.ts` (gate, drain), `src/server/mcp/maintenance-tools.ts`
(MCP tool tracking), API route wrappers (`tracked`), `docker-entrypoint.sh`.

## Contract (strict)

While maintenance is active no request, worker, helper or operator script may
mutate the DB, the Vault, Git/Obsidian sync, the index, intake or prices. A
process that boots in maintenance never opens `app.sqlite` (no auth/app
migrations), starts no sync, index, timer or `ob`/`git` process, and the
entrypoint creates and re-owns nothing on the volume. The only answer is
`GET /api/health` → `200 {ok:true, serving:"maintenance_only", maintenance:{…}}`,
served without the DB; every other path → `503`, `Retry-After: 300`.

Both categories are covered: durable business data (Source/Claim/Review, Vault
files, receipts/authority state, Git commit/push/pull, protected records) and
derived/operational DB writes (index, metadata, sessions, migrations).

## One process-wide registry

The built server evaluates every server module once per vinxi router (`/` and
`/_server`): two copies of this code, two DB connections. Latch, pending work,
DB connections and the intake/price timers therefore live in one registry on
`globalThis` (`Symbol.for("notemesh.maintenance.registry.v1")`). Git, Obsidian
and the indexer were already process-wide singletons.

## What a drain waits for

Admin RPC `enterMaintenance` writes `draining` durably and verifies it (else
nothing is entered), starts a 30 s deadline, then stops Git, Obsidian, intake,
prices and the index watcher — each stop raced against the deadline; a stop
that throws or hangs ends the drain as `drain_failed`. It then waits until all
of this is observed:

- every admitted request's **handler has settled** (returned or thrown) — not
  its socket: route wrappers (`tracked`) release on settle; the middleware
  releases when it answers itself; `onBeforeResponse` releases unwrapped
  handlers (pages, `/_server`). MCP POST is also held until its stream closes;
- every MCP **tool execution** has settled (tracked inside the SDK's
  `executeToolHandler`, independent of the HTTP stream; a client disconnect does
  not end it);
- Git cycle/timers/pause; Obsidian daemon, one-shot, restart timer,
  **settings-sync helper** and auth probe; index rebuild and link pass; intake
  and price ticks; no `safe-edit.lock`, `git-mutation.lock` or `writing` row.

Admin entry requests are excluded **by identity**. Unfollowable requests count
as untracked forever (no false quiescence).

## The fence

When the drain settles, every app DB connection in the process is switched to
`PRAGMA query_only` (verified), `db()` refuses to open a new one, and `git`,
`ob`, source-archive, attachment, Safe Edit pause, index rebuild and writable
price stores refuse. A late continuation of a disconnected request therefore
cannot write after quiescence: it fails. `active` is reported only on observed
quiescence **and** a verified record on disk; otherwise `drain_failed`
(`persistFailed` when the record could not be verified). `drain_failed` means
"not proven quiescent": work still running at the deadline may complete a Vault
write or an `ob`/remote step it had already started; restart, then review.

## Separate processes: one enforcement mechanism

The record, an unfinished resume marker (`maintenance-resume.json`) or
`NOTEMESH_MAINTENANCE=1` is maintenance for every process. Writers outside the
server's own request/tool tracking (price stores in any process, the price
CLI, Drive calls, operator scripts) all go through the same three rules:

1. **Durable openness.** A writer treats the system as closed unless there is
   no record, no marker AND that absence is durable: it fsyncs `DATA_DIR`
   before every write and refuses if that fails. The server does the same once
   at boot (`resolveServerBoot`) and stays closed until restart if it fails.
2. **Announced writers, integrity-checked inventory.** A writer publishes a
   lock in `DATA_DIR/maintenance-writers/` (atomic tmp+link, fsync) BEFORE it
   checks maintenance; a drain records maintenance BEFORE reading the
   inventory. A writable on-disk `PriceStore` is a writer for its whole life
   (constructor to `close()`), however it was opened. The inventory has a
   sentinel id; the server remembers it and the directory identity when it
   registers (before admitting its first request). A missing, replaced,
   corrupt or unreadable inventory is `uncertain` — the drain ends
   `drain_failed` at once (`writerInventoryIntact: false`), never "zero
   writers". A writer whose own lock or inventory vanished stops writing.
   Stale locks (dead pid/start) still block a drain; the next normal server
   start clears locks whose process is verifiably dead.
3. **Checks under the target's lock.** Every `PriceStore` write (lease,
   instrument, bars, failure records, schema) runs in `BEGIN IMMEDIATE` and
   re-verifies rules 1–2 inside the transaction; statements that can write are
   refused outside that path (`unfenced_price_write`), including via
   `store.db`. After quiescence the drain takes and releases the write lock of
   `app.sqlite` and `prices.sqlite` (`appDbBarrier`, `priceDbBarrier`): a
   transaction already open is waited for (a non-empty rollback journal is
   never touched; at the deadline it is `drain_failed`). Remote Drive
   mutations (folder creation, upload) are registered as in-flight work and
   checked at one HTTP choke point (`drive-http.ts`) synchronously before
   `fetch()` — no await between check and initiation.

`drain_failed` is not a strict no-mutation window: work still in flight at the
deadline may complete. A Drive request already sent cannot be recalled; the
drain waits for it (`pendingRemote`; in the CLI, the writer lock) and its 25 s
timeout is below the 30 s drain deadline.

The `ob` wrapper (`ob-readonly.mjs`) refuses to launch (exit 75), also when
`DATA_DIR` cannot be fsynced. `account-issuer-cleanup.mjs --apply` is a
privileged operator mutation and is **not** part of the strict window: it is
refused during maintenance with no override (an operator id or variable grants
no write authority), requires a durable open state, and re-checks inside its
`BEGIN IMMEDIATE`. One replica only (single volume).

## Resume (owner, out of band, server boot only)

Never an HTTP action, and never performed by a CLI or any other process,
whatever its environment: only the server's boot step (its first request gate)
resumes. Rules, in order: `NOTEMESH_MAINTENANCE=1` always wins; only an exact
`NOTEMESH_MAINTENANCE_RESUME=<id>`; an id already committed to
`maintenance-history/` is a replay; another live server registered on the
volume (e.g. an adopter whose record write failed) refuses, even with an
acknowledgement; a record whose owner process (pid + start time) is still
alive refuses. Quiescence counts as proven only for a settled `active` written
by a known owner that has exited, with an intact inventory; anything else — not
`active`, no owner (records from before ownership), missing/unreadable
inventory — also needs `NOTEMESH_MAINTENANCE_RESUME_UNDRAINED=<id>`. A stale
value with no record does nothing.

Intent, completion and permission to reopen are separate: (1) publish the
intent marker `maintenance-resume.json` (atomic, fsync); (2) remove
`maintenance.json`, fsync; (3) publish `maintenance-history/<id>.json`
(verified completion), fsync; (4) remove the marker, fsync. Permission to
reopen is not step 4 itself: every process verifies durable openness (rule 1)
before it writes. So any failure — including the double failure "marker
removed, directory fsync fails, marker cannot be restored" — keeps this
process closed until restart and every other process closed until the
filesystem confirms the state; a crash leaves the marker (or a durable,
committed resume). Only the same exact id completes an interrupted resume.

## Health

`/api/health` in maintenance reports this process first: `process.phase`
(`draining`, `settled`, `booted_in_maintenance_started_nothing`), live
`pendingWork`/`untrackedRequests`, `persistUncertain`, `heldClosed`
(`resume_incomplete`, `open_state_not_durably_verified`,
`writer_inventory_unavailable`). `drainedByThisProcess`/`quiescenceProven` are
true only after this process settled `active` with a verified record.
`recordOwner` says whose drain the record describes (`this_process`,
`other_live_process`, `earlier_process`, `unknown`). A record adopted from an
earlier process is rewritten `draining` with this process as owner before
anything is answered; a saved report is labelled `earlierProcessDrain`, never
as this process's evidence.

## First cutover (not performed, not authorized here)

The current staging runtime `f9841ed3` has **no** barrier and cannot drain
itself: its process will receive SIGTERM without a drain. Preconditions for a
future, separately authorized cutover:

1. Independent review accepted for the exact candidate; Owner decision on the
   resume variables and on the undrained first stop.
2. Owner-verified backup/snapshot of the volume taken before the stop.
3. `NOTEMESH_MAINTENANCE=1` staged together with the deploy, so the first boot
   of the new code is already in maintenance.
4. After boot: `/api/health` shows `serving: maintenance_only`, `source: env`;
   DB/Vault byte hashes equal the snapshot; logs show no `[git]`, `[indexer]`,
   `[supervisor]`, `[market-prices]` activity; entrypoint printed no ownership
   repair.

Abort (stay in maintenance, roll back per the existing documented procedure):
any 2xx other than health, any DB/Vault hash change, an entrypoint HOLD
message, `drain_failed`, `persistFailed`, or a missing/unreadable record when
one is expected.

## Not covered

- A deploy or restart **without** maintenance first (SIGTERM mid-write) behaves
  as before.
- Derived-index recovery while business writers stay disabled ("Phase 2").
- A handler that throws in an unwrapped router (pages, `/_server`) leaves its
  request pending: the drain then fails closed (`drain_failed`), never falsely
  `active`.
- Writers outside the protocol: a raw SQLite client (e.g. the `sqlite3` CLI)
  or any code that opens `app.sqlite`/`prices.sqlite` without `PriceStore`/
  `db()`, a manually launched `ob`/`git` that bypasses the wrappers, or a
  process in another PID namespace sharing the volume. The barrier waits for
  their already-open transactions, but cannot stop a new unchecked one; they
  are an operational limitation (single replica, no shell writers during
  maintenance).
- Process liveness is pid + start time in this PID namespace; without
  `/proc` an existing pid counts as alive (fail closed).
- The entrypoint's ownership decision reads the visible (not fsync-verified)
  state; it only re-owns `DATA_DIR` when it is not writable.
- CI uses isolated fixtures and the built server; it is not runtime evidence on
  staging.
