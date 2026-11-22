# IOS-ORCH-RI-001 — Full L1 remediation status (Security HOLD unchanged)

Candidate branch `ccr-eca3beae-c1-usability` (base `2a8845dd`). PR #184 and its frozen oracles
are unchanged. ADR-D1-GIT-01 is still open. Baseline evidence is in
`ccr-eca3beae-yfvpej:docs/evidence/ios-ri001-l1-handoff-20261122/`:
63 local failures, made of the 37 CODEX failures plus 26 extra.

## Fixed in this candidate (no security-contract change)

| Cluster | n | Change |
|---|---|---|
| C1 cold link | 1 | `indexer.ts` `indexFile` keeps the existing `links` rows (and their resolution) for unchanged targets. Before, every watcher re-index reset them to NULL until the 1 s debounced pass. Regression test: `links-watcher.test.ts`, which observed the NULL window deterministically before the fix. |
| git-lfs merge probe HOLD | 21 | The merge probe accepts only the exact `git lfs install` filter values, and only while `merge.renormalize` is off. Any other filter, a merge driver, renormalize, promisor or partial clone still HOLDs before launch. Test: `git-merge-lfs.test.ts` (2 positive, 4 negative). |
| R3 test seam (`db.prepare` spy) | 7 | The spies delegate to the native `Database.prototype.prepare` instead of re-entering the guarded facade. That re-entry nested the D1 interlock. Assertions are unchanged. |
| R7 disk teardown | 1 | The fixture recreates an empty `DATA_DIR` before the guarded close. The missing-instance assertion is unchanged. |
| C1 isolation gap | — | Code-level denial of the price writer, the collector timer and all Drive/OAuth egress in C1 (`c1-price-drive-guard.test.ts`). |

## Security-dependent: design only (needs Owner/Security approval first)

- **R1 — D1 physical write (ADR-D1-GIT-01):**
  - The recommendation stands: B1-kernel (delegated cgroup v2 or equivalent) for Git, its
    escaped descendants and `ob sync --continuous`, on both the isolated runner and the target
    runtime.
  - Required in the same package:
    - `-c gc.autoDetach=false -c maintenance.autoDetach=false` on every app Git launch. The probe
      showed `git gc --auto` + `repack` escaping in a new session after a successful
      `git commit`.
    - Pre-publication settlement.
    - pgid and start time recorded in the writer lock.
    - Boot-time orphan recovery.
  - Not implemented here.
- **R2 — Git nonzero exit becomes global maintenance (18):**
  - **Proposal.** Keep fail-closed behaviour, but scope it, using per-command outcome proofs:
    - Read probes: `ls-remote --exit-code` exit 2, plus the existing rev-parse/rev-list/show/cat-file set.
    - `fetch` nonzero with refs unchanged (compare HEAD, `packed-refs` and `refs/` before and
      after) puts the Git backend into `backoff`, not maintenance.
    - `push` rejected with local refs unchanged: same treatment.
    - `commit` exit 1 with a clean tree: same treatment.
  - Anything with an unproven effect still retains the writer lock and holds.
  - **Needs** a security delta review because it narrows what triggers global maintenance.
- **D1 per-statement IO (CI and image 5 s timeouts, R6, 3 × 30 s timeouts):**
  - Every SQLite `run/get/all` currently performs about 3 fsyncs plus mkdir/rmdir/unlink.
  - **Option A:** one durable witness per owned transaction, with statements inside it covered.
  - **Option B:** exempt statements proven read-only: better-sqlite3 `readonly`, not a PRAGMA,
    no side-effecting UDF.
  - **Required invariant tests:**
    - mutating statements are still witnessed;
    - PRAGMA writes are still fenced;
    - a crash mid-transaction leaves the witness;
    - `COMMIT_UNKNOWN` keeps its quarantine.
  - No timeout increases.

## Remaining harness/contract items (not product defects; owner input where noted)

| Item | n | Next step |
|---|---|---|
| R4 DB read after maintenance ACTIVE | 2 | Observe through a read-only native connection, or a baseline taken before maintenance. Fixture teardown must close through a supported lifecycle rather than `db()` under maintenance. |
| R5 G04/G05 legacy fixture | 2 | **Owner/CODEX:** supply the original frozen `b1c2a416` maintenance.ts/env.ts and the G05 v1 witness module, with hashes. The commit is absent from every remote ref. Do not recreate it. |
| R6 FS call counts | 2 | Re-measure after the D1 IO redesign, splitting business-file IO from control IO. Thresholds are unchanged. |
| R7 WAL / Auth lifecycle | 2 | WAL: stop Auth and Research through the supported shutdown and checkpoint before the offline cleanup. Auth: assert the single-admin guard in a fresh child process. |
| R8 index depth | 1 | Contract decision. The code fails closed on incomplete depth while the old test expects success. Keep fail-closed; change the oracle only with owner approval. |
| R9 WP2 scope blob | 1 | Reconcile against the exact accepted WP2 scope version (owner). Do not delete the protected-authority assertion. |
| Thai search | — | FTS `unicode61` does not segment unspaced Thai. A future trigram FTS (index rebuild) needs its own review. The pilot works around it with ticker/IN-id search and `investment_context_pack`. |
