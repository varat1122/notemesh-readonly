# P3 S1 Scoped statement reuse in the rebuild note loop

Task: IOS-ORCH-RI-001, work package P3_S1_SCOPED_STATEMENT_REUSE. This is a
bounded trial stacked on PR #190 (`2350feed`). It changes no guard, schema,
configuration, durability setting or production path, and grants no merge or
deploy authority. D1/D2/D3 are retained unchanged.

## What changed

`indexFile` used to compile the same nine SQL statements for every note:
the notes upsert, the FTS delete and insert, and the delete and insert for
links, tags and tasks. Every compile is a guarded native launch, so in E0
each one paid a full D1 interlock cycle: a durable witness, its fsync, a
`DATA_DIR` fsync, the launch lock and its release.

Only `rebuild()` now passes `indexFile` a statement scope:

- A scope holds at most those nine statements, keyed by a fixed name. It is
  not a generic or global cache and is not exported.
- Each statement is still compiled through the guarded facade `db().prepare`,
  lazily, at the same point and in the same order as before.
- A scope is valid for one connection. If `db()` returns a different facade,
  for example after a closed connection was reopened, the scope is emptied
  before any reuse.
- A scope lives for one synchronous batch of at most 50 notes. The loop
  replaces it before every `await` (the existing `i % 50 === 49` yield),
  after any failed note, and empties it at the end of the loop. Nothing is
  held across an await or across rebuilds.
- Statements are used only through `run` and `get` with per-call arguments.
  There is no `bind`, `pluck`, `raw`, `expand`, iterator or mode change, so no
  per-call state carries between notes, and the facade's busy and iterator
  rules are untouched.

Everything else is unchanged:

- Each note is still one transaction.
- Every execution still goes through the guarded statement proxy, each with
  its own witness, lock, maintenance, owner and quarantine checks.
- SQL text, statement order and arguments are the same.
- The rebuild yield cadence is unchanged.
- `reindexPath`, the watcher handlers, `removeFile`, `indexAttachment` and
  link resolution pass no scope, so they behave byte-for-byte as before.

Expected effect: about 22 interlock cycles per note in a rebuild drop to
about 13. The nine prepares now happen once per batch of 50 notes instead of
once per note. The execution and transaction counts do not change.

## Invariants pinned by `src/server/vault/indexer-reuse.test.ts`

The tests patch the native better-sqlite3 prototypes that the guarded facade
itself calls into. They record counters and object identities only, never
SQL, source or row data. For every fixed prepare and execution they check:

- the D1 witness file exists, is version 2, and is a pending `business`
  record with operation `sqlite.step` (prepare) or `sqlite.statement` (run or
  get);
- the launch lock is held, with the device and inode the witness recorded;
- for executions, the native connection is inside a transaction.

| Test | Pins |
| --- | --- |
| Two batches against the unscoped per-note oracle | Exactly 2 prepares of each fixed statement for 60 notes (was 60). Per-key execution counts are equal to the parser-derived expectation and to the unscoped `reindexPath` path. BEGIN and COMMIT are N+2. No statement serves both sides of the yield. Tables are identical to a full unscoped re-index. A second rebuild compiles fresh statements. |
| Watcher path | `change` events still prepare all nine per event and never see a rebuild's statements. |
| Statement failure | Only that note rolls back (1 ROLLBACK, no rows), the next note recompiles, and a fresh rebuild recovers fully. |
| Prepare failure | Same as a statement failure, with the prepare failing at the first note of the second batch. |
| Connection replaced mid-batch | The scope recompiles on the new connection, and no statement of the closed connection is reused. |
| Maintenance before rebuild | Refused outright, with no wipe and nothing compiled. |
| Admission holds (6 cases) | Maintenance at the batch boundary. Maintenance mid-batch before a reused statement runs. Quarantine mid-batch before a reused statement runs. Another research owner between notes. The launch lock held at the batch boundary. A legacy pending witness mid-batch. In every case nothing fixed runs or compiles after the hold, no transaction is left open, the interlock is not poisoned, no witness or lock is left behind, an injected one is untouched, and a fresh rebuild recovers. |

Limits:

- The owner and quarantine cases set the test-only D1 state through its
  global symbol.
- The owner-busy hold is injected between notes, not inside a transaction.
  Injecting it inside a transaction would make the rollback itself refuse,
  which is existing quarantine behaviour that S1 does not touch.

## Validation and gate

Local, synthetic fixtures only, on the same disposable host. The full ledger
and the gate decision are in `P3_S1_SCOPED_STATEMENT_REUSE_RETURN` in the
coordination folder.

| Check | Baseline `2350feed` | S1 candidate |
| --- | --- | --- |
| New S1 suite | n/a | 12/12 pass |
| D1 uncertain/recovery/offline plus indexer storage/recovery | 68/72 | 69/72; the failures are a subset of the baseline's |
| F7 full index of 2,000 notes (30,000 ms bound) | 54,487 ms, then 53,947 ms (fail) | 33,536 ms, then 36,269 ms (fail): 38.5% and 32.8% lower |

The F7 bound still fails, so the F7 HOLD stays. The 20% materiality gate is
a trial criterion, not a release threshold.

## Rollback

S1 is one function-local change in `indexer.ts`. To roll it back, revert the
commit. Nothing is persisted: no schema, data or configuration depends on it.
