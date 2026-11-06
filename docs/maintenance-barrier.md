# Restart-persistent maintenance barrier

Task IOS-ORCH-RI-001, blocker `NO_RESTART_PERSISTENT_MAINTENANCE_BARRIER`.
Code: `src/server/maintenance.ts` (state, gate answer, resume) and
`src/server/maintenance-drain.ts` (gate, in-process drain).

## Contract (strict)

While maintenance is active the process admits **no request** that could
reach the DB, the Vault, Git/Obsidian sync, the index, intake or prices. The
middleware checks maintenance before any first-request hook, so a process that
boots in maintenance never opens `app.sqlite` (no auth/app migrations), never
starts sync, never rebuilds the index and starts no timer. The only answer is
`GET /api/health` → `200 {ok:true, serving:"maintenance_only", maintenance:{…}}`,
served without the DB; every other path → `503` with `Retry-After: 300`.

Both data categories are covered: durable business data (Source/Claim/Review,
Vault files, receipts and authority state, Git commit/push/pull, protected
records) and derived/operational DB writes (index rebuild, metadata, sessions,
migrations). The barrier does not relax the no-DB-mutation requirement.

## State

`DATA_DIR/maintenance.json` (volume, outside the Vault and the DB), written
atomically and fsynced, mode 0600:
`{version:1, id, state:"draining"|"active"|"drain_failed", requestedAt, settledAt, drain}`.
A present file that is unreadable, oversized, a symlink or malformed is
maintenance with state `unknown` (fail closed). `NOTEMESH_MAINTENANCE=1` forces
maintenance from boot without a file.

## Enter

- **Running server (drain):** admin RPC `enterMaintenance` (Status session,
  `POST /api/rpc/enterMaintenance`). It writes `draining` durably first, then
  stops Git and Obsidian sync, cloud intake, the price collector and the index
  watcher, and waits up to 30 s until each is observed quiescent: no admitted
  HTTP request still open (counted until the Node response closes), no Git
  cycle/timer/pause, no Obsidian daemon/one-shot/restart timer, no index rebuild
  or link pass, no intake/price tick, no `safe-edit.lock`, no
  `git-mutation.lock`, no `writing` Safe Edit row. Only then `active`; otherwise
  `drain_failed`. Both refuse every request and survive restart.
- **Boot:** set `NOTEMESH_MAINTENANCE=1` before the deploy/restart. Required for
  the first deploy from a version without this barrier (that process cannot
  drain itself; its SIGTERM behaviour is unchanged).
- A record written under a running process that has served requests is adopted
  and drained the same way.

Manual sync, Start/Restart Sync, Safe Edit pause, index rebuild and the Obsidian
restart after an edit are refused in maintenance, and a manual Git cycle is
refused even after Stop.

## Status

`GET /api/health` (no session, no DB): `source` (`process` = this process
drained its own workers; `file`/`env` = booted in maintenance, started nothing),
`state`, `id`, timestamps and the boolean/count drain report.

## Resume (owner, out of band)

Resume is never an HTTP action: authenticating would write sessions and run auth
migrations. The owner sets `NOTEMESH_MAINTENANCE_RESUME=<id>` (the exact id from
health) and restarts. At the first request of the new process an exact match on
a valid record moves it to `DATA_DIR/maintenance-history/` and normal startup
follows (sync, index rebuild, timers). A mismatch or unreadable record stays in
maintenance. The variable is consumed once per process and cannot clear a later
maintenance with a different id; `NOTEMESH_MAINTENANCE=1` still wins. A
`drain_failed`/`draining` record can be resumed only this way, after the owner
has reviewed it; existing Safe Edit/Git interruption guards still apply.

## Not covered

- A deploy or restart **without** entering maintenance first (SIGTERM mid-write)
  behaves as before.
- Derived-index recovery while business writers stay disabled ("Phase 2") is
  not implemented; resume returns to full normal startup.
- CI tests use isolated fixtures and the built server; they are not evidence of
  runtime safety on staging.
