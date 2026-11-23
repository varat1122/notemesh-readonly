# IOS-ORCH-RI-001: Safe Edit sync gate patch (review artifact)

This folder is a review artifact only. The code commit is **not** on any remote
branch. Nothing here has been merged or deployed, and no Production, OAuth,
Secrets or Vault data was touched. Safe Edit operation
`ICW-848d80bf6a78fd1daa861379a8c8c24e` was not retried.

## Exact base and target

| | |
|---|---|
| BASE (main) | `71cc4178607d717b403ffd143d3a01bff7c94758` |
| TARGET commit | `f3da535429f31bb6de80db197c23bf2735c242ec` (parent is BASE) |
| TARGET tree | `631a4ee9a3017a992f1711f20adafa69b40d9cda` |

Blob hashes in TARGET:

| File | Blob |
|---|---|
| `src/server/ob/supervisor.ts` | `3efebd2c7c9d58519a66ae3d95decd6761ccc20f` |
| `src/server/safe-edit/sync.ts` | `36becdc6cbba65a38c0d6acd94b5727a46a701e3` |
| `src/server/safe-edit/sync.test.ts` | `bd45e1e8aa41090330853097de2a307a028e1cda` |
| `src/server/ob/supervisor-sync-proof.test.ts` (new) | `3461d8ad06896dd06e67962341d78ae5e6d2bf0d` |

Fetch the exact commit:

```sh
git fetch docs/evidence/ios-ri001-safe-edit-sync-gate-20261123/safe-edit-sync-gate.bundle \
  claude/safe-edit-sync-gate-71cc417
git rev-parse FETCH_HEAD FETCH_HEAD^{tree}   # f3da535…, 631a4ee…
```

Or apply the patch on BASE with `git am 0001-safe-edit-sync-proof.patch`. The
commit SHA will differ because the committer date changes, but the tree hash
matches.

## Root cause

`withPausedSync` re-derived its proof on every apply. It scanned the
500-line in-memory log (`MAX_LOG_LINES`) for
`[sync-policy] Verified bidirectional sync.`. `scripts/ob-readonly.mjs`
prints that line once per daemon launch. Once it rotated out, the same healthy,
verified, idle daemon was held.

There was a second problem in the same check: it accepted the line from
anywhere in the log, including `note()`, stdout and later `ob` output (synced
filenames), so the proof could be forged.

## Change

- **When proof is recorded.** The supervisor records it only when the head of
  the current child's own stderr is exactly that line. At most Node runtime
  warnings (`(node:PID) …` or `` (Use `node --trace-… ``) may come first. The
  wrapper prints the line before it spawns `ob`, so everything `ob` prints comes
  after it.
- **How long it lasts.** Proof is held per child (`verifiedChild`). It is
  dropped on `stop()` and on `resetAndStart()` (re-auth or relink), even while
  the same child keeps running. It is also dropped on child exit, backoff,
  needs-reauth and any new spawn.
- **What the gate reads.** The gate now calls `supervisor().bidirectionalVerified()`
  instead of scanning the log.
- **What did not change.** `withPausedForEdit` (child-exit confirmation,
  10-second fail-closed, single restart), `assertEnabled` (single writer), and
  the CAS, permission and receipt code in the engine are untouched.

## Regression (run in an isolated dev container, fake `ob`, no real data)

| Case | Result |
|---|---|
| Same verified idle daemon, log rotated past 500 lines (marker gone), Safe Edit applies | PASS |
| New daemon not yet verified is held | PASS |
| Stopped, active, re-auth (`resetAndStart` while running, and needs-reauth) or backoff is held | PASS |
| Forged or invalid evidence is held: none, pull-only, marker on stdout, marker after another line, marker with trailing space, marker via `note()` | PASS |
| Pause Sync failure means `run` is never called | PASS |
| Normal verified sync passes, and the daemon restarted after an edit proves itself again | PASS |
| Marker head split across chunks, or preceded by a Node warning, is accepted | PASS |

- **Negative control.** The same new tests run against BASE `sync.ts` fail in
  7 cases: rotation, none, pull, stdout, late, padded and restart.
- **Clean worktree (BASE + patch).** Targeted suites pass with 17 files and
  246 tests (BASE has 16 files and 230 tests). `tsc` and `eslint` both exit 0.
- **Full suite on TARGET.** 108 files and 1483 tests pass (`full-vitest.log`).
  `pnpm typecheck`, `pnpm lint` and `pnpm build` all exit 0.

## Residual risks

1. **Trust depends on stream order.** The proof relies on the wrapper writing
   the marker before it spawns `ob`; pipe writes on Linux are synchronous.
   Running without the wrapper (`OB_BIN` unset) is held, as before.
2. **Unknown Node startup lines.** If Node prints a startup line on stderr that
   is not one of the two accepted warning forms, Safe Edit fails closed (HOLD).
   The Production Node 24 patch level is unknown because the base image tag
   floats. Node 24.22.3 prints no warning for `node:sqlite`.
3. **Cloud Intake is unchanged.** It is not affected by this defect because it
   caches `verifiedStart`. Its own existing problems remain, and need a separate
   ticket if parity is wanted:
   - it accepts the marker from any log line;
   - it skips the check when `startedAt` is falsy;
   - it has a small window where the marker can rotate out before its first
     5-second tick.
4. **The proof means the same thing as before.** It says the wrapper verified
   the mode at launch. A config change made outside `resetAndStart` while the
   same child runs does not drop it, which is also true of BASE.
5. **The PR #184 lineage (`2a8845d` / `f06175c`) has the same log-scan gate.**
   It also has different versions of `supervisor.ts`, `sync.ts`,
   `cloud-intake.ts` and `ob-readonly.mjs`, so the patch targets main only and
   needs a forward-port if #184 lands. That lineage's wrapper only adds a
   maintenance refusal (stderr, then exit), so the head-of-stream rule still
   holds there.
6. **Not exercised against real systems.** It was not tested against real `ob`,
   Obsidian Sync or Production; that was out of scope by instruction. Staging
   verification by the owner is required.

## Status

READY_FOR_MAIN_REVIEW. Main decides the target branch and whether to open a
Draft PR.
