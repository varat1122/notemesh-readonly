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

## Separate processes

The record (or `NOTEMESH_MAINTENANCE=1`) is read by every process: the price CLI
(`refreshPrices`, writable `PriceStore`) refuses before any store, lease, Drive
refresh or file; the `ob` wrapper (`ob-readonly.mjs`) refuses to launch (exit
75); `account-issuer-cleanup.mjs --apply` requires
`NOTEMESH_MAINTENANCE_OPERATOR_ID=<id>` (`forced` for env-only maintenance) as
an explicit operator acknowledgement. One replica only (single volume).

## Resume (owner, out of band, at boot)

Never an HTTP action. Rules, in order: `NOTEMESH_MAINTENANCE=1` always wins;
only an exact `NOTEMESH_MAINTENANCE_RESUME=<id>` on a valid record; a record
that is not `active` also needs `NOTEMESH_MAINTENANCE_RESUME_UNDRAINED=<id>`; an
id already in `maintenance-history/` is a replay and is refused. The history
entry is written (O_EXCL) and fsynced before the record is unlinked; a failure
in between leaves maintenance active (and the next attempt is a replay that
needs manual review). A stale resume value with no record does nothing.

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
- CI uses isolated fixtures and the built server; it is not runtime evidence on
  staging.
