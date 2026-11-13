# Once-daily proposal — INACTIVE, E2/E3 not authorized

Implementation entry: built `node .output/server/price-job.mjs daily` or source
`node scripts/market-prices.ts daily`. Building locally is permitted; running with real
rights/credentials is not authorized by IOS-PRICES-001. Existing `refresh` stays separate.
Proposed daily trigger `23 3 * * *` UTC =10:23 Bangkok. No workflow, remote cron,
secret/config change or live OAuth is created by this task.

| Option | Wake / run / stop; credentials and lock | Reliability / costs / decision |
|---|---|---|
| GitHub hosted scheduled Actions | Runner boots ephemeral VM, launches pinned job, exits. Dedicated Drive secret via environment-protected store; workflow concurrency only serializes that repository/group. Ephemeral disk loses job receipt/lock. | Schedule may delay/miss; default-branch semantics and private minutes/account billing need review. NO selection until durable cross-host exclusion and safe persistent receipt state exist; current file lock is insufficient. |
| Bounded external job on dedicated authorized host | Scheduler starts pinned job on exactly one host and persistent DATA_DIR shared by all price entrypoints. OS/service mutex + durable CLI locks; no second writer or concurrent admin refresh. Supervisor limits wall-time, stops process, then stops billed compute if applicable and verifies stopped state. Secrets mounted from approved store; no Vault or production DB. | SELECTED DESIGN, activation HOLD until actual host/plan, mount, exclusion, stop semantics and independent monitoring evidenced. Existing code needs no new scheduler dependency. Persistent host vs spin-up host cost differs; do not call it free. |
| Sleeping Railway staging / in-process timer | Server must be awake for interval to run; an HTTP trigger might wake app and all startup workers. CLI/job persistent root must be same actual volume; changing restart/cron needs approval. | UNSUITABLE as reliable sleeping timer. No Railway query, wake or configuration in this task. Unknown billing and startup writers prevent using it as a trigger. |

Host-neutral INACTIVE supervisor specification (not an installed service):

```yaml
enabled: false
schedule: '23 3 * * *'
time_zone: UTC
candidate: EXACT_REVIEWED_CANDIDATE_SHA_REQUIRED
command: ['node', '.output/server/price-job.mjs', 'daily']
provider_request_cap_per_run: 24
collector_soft_deadline_seconds: 600
supervisor_hard_timeout_seconds: 720
automatic_retries: 0
mutex: single-authoritative-host-and-persistent-root
late_check: '04:53 UTC daily'
on_failure: retain-receipt-and-lock-if-uncertain; alert-owner-through-approved-channel
on_exit: stop-worker; verify-compute-stop-using-approved-host-adapter
```

This YAML is a specification, not a runnable provider configuration. Host-specific provisioning,
snapshot image distribution, mutex, stop verification and alert transport remain BLOCKED.
No cloud deployment webhook/HTTP app wake is implied. Select the host after billing review.

## Guard and recovery behavior

1. Require master+refresh=1, reviewed profile, external mode, Drive storage and explicit
   single writer. Prices remain OFF for future deploy until manual-pilot authorization.
2. Validate unexpired per-listing rights before provider access. All held means zero remote
   I/O and no local receipt write; CLI emits RIGHTS_HOLD JSON/nonzero. Capture stdout externally
   after redaction; a rights refusal is not a completed daily update.
3. Before03:23 UTC return NOT_DUE, no I/O. At/after cut-off O_EXCL/NOFOLLOW daily.lock is
   fsynced (and parent fsynced) before the collector. Collector also uses refresh-run.lock
   and existing writer fence. Same persistent root only; env assertion is not proof of isolation.
4. Persist immutable `market-prices/daily-jobs/YYYY-MM-DD.json` receipt, chmod0600, fsync;
   COMPLETE/PARTIAL/FAILED terminates that day's one automatic attempt. Normal terminal
   receipt releases own daily.lock; rerun returns prior receipt without fetching again.
   A replay of failed/partial remains non-success for CLI monitoring (must inspect prior status).
5. Crash, malformed receipt or persistence ambiguity retains the lock. No auto-expiry, lock
   deletion or retry; operator reconciles job ID, exact archive/catalogue generation and writes.
   Repeated supervisor delivery is safe only with the persistent root and intact state.
6. On 429 do not rotate endpoint/IP, widen quota or retry aggressively. Partial watchlist has
   per-symbol reason. On provider/Drive failure retain earlier discoverable history; orphan
   new snapshots are not removed. A persisted full-series rebase is never mixed silently.
7. By04:53 UTC the local status reports MISSING_OR_NOT_ACTIVATED if no receipt (90min late).
   This is detection logic, NOT an alert service. Separate approved monitor must read status,
   fail if late/failed/partial/RIGHTS_HOLD/busy, notify Owner, and retain evidence off-host.
   No Slack/email/notification was sent in this task. Schedule delays/misses are not hidden.
8. Do not delete/retry a crashed lock automatically. Recovery after inspection is a separate
   bounded action, especially when catalogue publish succeeded but job receipt did not.

## Minimum evidence before a separate manual staging pilot

Owner/Coordinator should supply these non-secret evidence groups; no credentials in chat:

1. Effective staging DATA_DIR/mount, DB paths and startup Git/sync/indexer/intake flags;
   prove no Production mount/credentials, no second writer, same persistent lock root.
2. Latest independent SQLite/WAL-consistent recovery test and backup receipt; explain
   that reverting image does not revert DB/schema. No restore against live DB in this task.
3. Pinned source/image SHA, auto-deploy/webhook/preview isolation, no unapproved CI/push.
4. Account plan/credits, chosen scheduler identity, max duration, billing, compute-stop proof,
   missing-run monitor and cost cap. Published free tiers are not account entitlements.
5. Dedicated private test Drive folder and owner/ACL, existing `drive.file` OAuth client,
   secure credential placement, approved watchlist, source terms and written internal/team
   archival permission. Current Yahoo warning does not satisfy this gate.

After these close: Coordinator requests explicit E2 authority for exact candidate, deploy prices
OFF, isolated Drive OAuth, one bounded MANUAL refresh, all per-symbol receipts, signed
upload/download/hash/catalogue readback, independent authorized consumer read, no Vault or
Production effects, and compute stop. Only a passed E2 and a new explicit approval can enable
E3 scheduling and observed24h run. IOS-PRICES-002 should first close rights/host/evidence
gates; it should not automatically deploy or activate automation.
