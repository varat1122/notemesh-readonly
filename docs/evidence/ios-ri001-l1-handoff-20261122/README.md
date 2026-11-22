# IOS-ORCH-RI-001 — L1 technical handoff return (evidence only)

Subject: PR #184 commit `2a8845dd92661edafee8c3d834b9cedc8c955685`, tree
`6ec053c8f295164e369cf09cdadb42df2b8dad7b` (verified with `git cat-file`). Evidence ZIP
`4e9fa5369b9fc7bd7f80f5ba3e4d334d776b2e17b6b971efbfafa2a41be94961` re-downloaded and
verified, 65/65 internal checksums OK. This directory is evidence only: no application
source, test, config, CI or policy file is changed. Not a release candidate.

Runner: Linux, Node 24.22.3, git 2.43.0 with a system `filter.lfs.*` config (same as the
runtime image's `git lfs install --system` and GitHub `ubuntu-latest`). This container runs as root with
broad capabilities, so it is NOT representative of the target runtime. No cgroup, namespace or
privilege facility was used by any probe.

## 1. D1 root cause (reproduced)

`git-exec-d1.test.ts` on the exact tree: 6 pass / 1 fail; `late-business` is present.

- `admittedGit()` holds `withD1NativeInterlock` only for the synchronous `execa()` spawn;
  `await child` runs outside it.
- execa `killDescendants: true` already starts Git as its own process-group leader
  (`detached`), but `beginMaintenance()` only publishes the durable `draining` record. Nothing
  signals or settles the running tree before or after publication.
- Git does not currently follow the graceful model in `docs/maintenance-barrier.md` either:
  after `draining`, the next launch is refused (`assertNoMaintenance` under the interlock), and the
  running child's exit is classified `partial_or_unknown`, which means `heldClosed` plus a retained
  writer lock, so the drain ends `drain_failed`. The API outcome is already "abort + HOLD". The
  physical child keeps running.

New findings (probes in this directory):

| Probe | Result |
|---|---|
| `d1-settlement-probe.mjs` A: current order (publish, then release child) | same-pgid child, background descendant and setsid daemon all write after the barrier |
| B: user-space settlement before publication (SIGSTOP pgid and live ppid tree, SIGKILL, verify via /proc) | child and background descendant: 0 late writes. **setsid+double-fork daemon still writes, and the verifier reports `verified:true`** (a false settlement proof) |
| `gc-probe.cjs`: plain `git commit` exit 0, with `gc.auto` lowered so auto-gc triggers | survivors after the root exits: `git gc --auto --quiet` (ppid 1, own sid/pgid) plus `git repack`, which writes `.git/objects/pack` after the root exit |
| same with `-c gc.autoDetach=false -c maintenance.autoDetach=false` | no survivors; the pack is written inside the root's lifetime |

Consequences:

- **Git's own auto-gc escapes pgid tracking with default config.** With default `gc.autoDetach=true`,
  the drain can observe `gitQuiescent` and settle `active` while `repack` is still mutating `.git`.
  This breaks B1 and B2 alike. A config-only mitigation (two `-c` flags) exists and needs no
  entitlement.
- The Obsidian daemon (`ob sync --continuous`) runs without the D1 interlock and without its own
  process group. It is stopped by SIGTERM to the wrapper only after `draining`, so it belongs to the
  same physical class. No strict test covers it.
- Full B1 (strict, including non-cooperative descendants) is **not achievable** without a kernel
  facility, because user space cannot find a setsid+double-fork orphan. Options are a delegated
  cgroup v2 subtree (`cgroup.kill`/`cgroup.freeze`), a PID namespace, or a privileged supervisor.
  All of these are OS entitlements, which are a stop gate.

### ADR-D1-GIT-01 (one decision)

What process-containment tier applies, before durable DRAINING, to Git (and to `ob`, if in scope)?

- **(1) B1-kernel:** strict, enforced by a kernel facility in the isolated runner and the target
  runtime. This requires an entitlement grant and security review. It is the only option that meets
  the frozen oracle against non-cooperative descendants.
- **(2) B1-cooperative:** strict ordering in user space with no entitlement:
  - an in-process admission freeze;
  - SIGSTOP, then SIGKILL, then /proc verification of the tracked pgid and ppid tree, all before the
    record is written;
  - Git self-detach disabled;
  - the pgid and start time recorded in the writer lock, with boot-time recovery of orphans.

  At the barrier, Git changes from "finish, then HOLD" to "kill, then HOLD". The residual
  (non-cooperative setsid+double-fork code inside a Git child) is formally accepted as out of
  model, in the same class as "manually launched git/ob" in `maintenance-barrier.md`. The frozen
  tests stay unchanged and are expected to pass. A new documented negative probe records the
  residual.
- **(3) B2:** a versioned graceful contract. This requires changing the frozen strict oracle, which
  is not allowed without an Owner/Security version. It still needs the auto-detach fix and a
  root-exit pgid-empty check before `active`.

## 2. Full suite (same overlay as CODEX via CLI flags: `--maxWorkers=2 --testTimeout=30000 --hookTimeout=120000`; no file changed)

3355 tests: 3286 pass / **63 fail** / 6 skip (`full-suite-summary.json`, `full-suite-failure-map.json`).
All 37 CODEX failures reproduced (0 not reproduced). The extra 26 failures:

| Cluster | n | Root cause / status |
|---|---|---|
| git-lfs system filter → `git_merge_probe_external_driver_hold` | 21 (conflict 18, git-backend 2, git-safe-edit 1) | **Proven:** all pass with `GIT_CONFIG_NOSYSTEM=1`. The runtime image runs `git lfs install --system`, so **every divergent sync merge probe HOLDs in production**. This is a real functional defect, not only CI. It also explains most of the CI-only conflict failures. |
| >30 s timeouts | 3 (macro-source-history, source-review-reuse, standalone-source-history) | D1 per-statement durable IO (§3) on a slower runner |
| perf wall-clock | 1 (vault-ops index 57.8 s > 30 s) | same IO class plus runner speed |
| C1 HTTP cold readback | 1 (`tests/http/c1-pilot.test.ts:124`) | Fails 2/2 here and passed for CODEX. The `links` rows exist with `resolved_path NULL` for both existing targets, but the receipt says `reindex: verified`. Hypothesis, NOT proven: a watcher re-index after Safe Edit `reindexPath` resets links, and the debounced 1 s resolve does not run before stop. |

Root-cause grouping of the 37 (one blocker plus grouped follow-ups, not 37 independent bugs):

- **R1** D1 physical write (1) — needs ADR-D1-GIT-01.
- **R2** `admittedGit` classifies every non-probe nonzero exit as `partial_or_unknown` and calls
  `beginMaintenance()` (18: conformance 12 incl. 7 obsidian cascades from the latched registry,
  git 3, git-safe-edit 3).
  - Production effect: a transient `fetch` failure (exit 128) puts the server into maintenance with
    `heldClosed`.
  - Fix: command-specific outcome proof. Needs security review and goes in the same candidate.
- **R3** test spies that wrap guarded `db.prepare`, which re-enters the D1 interlock (7).
- **R4** DB observations made after the fence is up (2).
- **R5** G04/G05 legacy fixture missing (2): `b1c2a416` is absent from every remote ref after a
  full unshallow fetch. It must come from the original evidence.
- **R6** FS call-count assertions inflated by D1 control IO (2).
- **R7** test lifecycle (3): WAL precondition, Auth process-global state, disk teardown order.
- **R8** index depth fail-closed vs. an old success oracle (1).
- **R9** WP2 historical scope blob (1).

## 3. CI #718 timeouts, including the 2 image timeouts

- The image failures are `investment-context.test.ts:265` and `:373`. Run alone they take 4.2 s
  and 4.9 s here, which is deterministic and just under 5 s, not flaky.
- `strace` on the `:373` test (`image-timeout-strace.txt`) shows 11,148 `fsync`, 3,739 `mkdir`,
  3,701 `rmdir` and 3,741 `unlink` calls. Every SQLite `run/get/all` goes through
  `withD1NativeInterlock`, which creates a lock dir, writes and fsyncs a witness, fsyncs the
  directory, then removes both and fsyncs again.
- Microbench under load: 1.37 ms per native call (fsync about 0.2 ms here). CI disks have higher
  fsync latency, so the cost grows proportionally.
- The retrieved CI test-job log tail (truncated by the provider) shows at least 103 `5000ms`
  timeouts across Judge, received-claims, source-event and context suites. Same cause.
- Raising timeouts or skipping tests would hide the cost. The real fix is a D1 design change, for
  example a witness per owned transaction, or exempting statements proven read-only (not PRAGMA, no
  side-effect UDF). That is a security-review item for the same candidate.

## 4. Negative and positive controls (this run)

- **Post-DRAIN physical write:** FAIL on the current code (reproduced). Probe B closes the
  cooperative cases. The daemon still escapes.
- **False HOLD on normal Source/Review:** none observed. research-judge 146/146,
  c1-pilot-admission 32/32, risk-draft-admission 45/45, source-event-admission 36/36,
  received-claims 29/29, canonical-writeback-workflow 40/40. source-review-reuse is 18/19 (the one
  failure is a timeout).
- **False HOLD on normal Git:** PRESENT (R2 and the git-lfs cluster).
- **Restart/replay:** maintenance suites 35+16+17+10 and HTTP maintenance 5 all pass. d1-offline-recovery
  passes 25/25 and d1-uncertain-outcome 10/10. d1-recovery-closure is 18/20 (R5).
- **Protected notes:** wp2-protected-boundary 13/13, protected-aliases 65/65 and the HTTP WP2
  boundary 2/2 pass. wp2-admission-authority is 8/9 (R9).

## 5. C1 Git-disabled pilot — static feasibility (design only; nothing started)

Code-enforced writer denials in the exact tree:

| Area | Guard sites |
|---|---|
| Git | not started: `sync/index.ts:35`, `sync/git.ts:265`; refused before launch: `git-exec.ts` `runGit`/`runGitBuffer`, `sync/conflict.ts:94` |
| Obsidian | `ob/supervisor.ts:165`, `ob/cli.ts:54` |
| Intake | `cloud-intake.ts:30,65`, `intake.ts:27` |
| Raw Vault writes | `vault/notes.ts:298,911,930`, `vault/folders.ts:52,101`, `vault/disk.ts:203` |
| Remote setup | `setup.ts:116` |
| Safe Edit | review/bundle/revision holds at `safe-edit/engine.ts:215,303,394`; quiescence at `safe-edit/sync.ts:12`; approvals at `routes/api/safe-edit-approval.ts:22,39` |

Gaps and blockers:

- **Gaps:**
  - The price collector and Drive have no C1 guard. They are gated only by env
    (`MARKET_PRICES_ENABLED`), so their absence is an operational precondition until a guard
    is added.
  - The identity check refuses any Railway env and requires `DATA_DIR` under the OS tmpdir with an
    `ios-c1-pilot-` prefix, so Railway hosting is impossible by design.
  - Directory identity is not OS isolation.
- **Actor and OAuth:**
  - Only the existing `vault:read`/`vault:edit` scopes are used.
  - The dashboard reviewer is recorded as `admin:<id>` with `humanPresence` and
    `criticIndependence` both `not_verified` by design.
  - RISK-1.1 admits only grounded non-quantitative routine `added_detail` Drafts. Material
    items stay Source-only/HOLD.
- **Fresh ChatGPT room:**
  - Tools `prepare_research_judge_packet` and `research_judge_result_contract` exist on
    the safe-edit MCP server (`safe-edit-server.ts:62,66`, OAuth `vault:read`/`vault:edit`), but the
    currently connected descriptors lack them.
  - A fresh room therefore needs a separately authorized public HTTPS origin, a matching OAuth
    issuer/audience/resource, and a new connector registration.
- **Permission blockers:**
  - host or instance creation;
  - public endpoint;
  - OAuth client/connector;
  - a real reviewer identity;
  - any Source/Review write grant (MA01 is Source-only and not reusable).

D1 does not apply inside C1 because Git is refused before any child launch and `ob` is not
started. The pilot is not a substitute for full L1 security PASS.
