# Safe Edit implementation and acceptance report

Checked: 2026-10-16. This is an implementation report, not a production success receipt.

## Status

| Acceptance stage | Status | Evidence / limitation |
|---|---|---|
| CODE_READY | Implemented | Separate resource, seven tools, scope checks, preview/hash/backup/atomic write/readback/index/receipt and guarded rollback |
| TESTED | Functional gates passed; final CI pending | 1,218 tests / 81 files; CI Docker and 31 Chromium tests pass on the earlier commit; final dependency/artifact guards need CI |
| DEPLOYED | No | Final CI and deployment pending; user explicitly waived Production Backup in chat on 2026-10-16 |
| CONNECTED | No Safe Edit connection | Existing read-only and save plugins retained; fresh Safe Edit OAuth consent still required |
| WRITE_VERIFIED | Synthetic only | Real filesystem/SQLite/MCP HTTP tests pass; no production canary authorized or run |
| REMOTE_SYNC_VERIFIED | No | Running Sync is not proof that a particular edit arrived on another device |
| MOBILE_VERIFIED | No | Actual phone not inspected |

## Production inspection

Railway service: NoteMesh. Running successful deployment:
`791caece-7cd2-4414-b42c-d4a4fc8e1bff`, source commit
`801d241b21356c1e01435cc855df10c857ad7c06`, branch main.
Railway live deployment metadata confirms this commit; the serialized source
configuration still contains an older source commit field, so it is not used as
proof of the running image. One replica in iad; persistent notemesh-volume
mounted at `/data`, configured size 500 MB. No staged changes when inspected.
Variable names inspected without requesting secret values. The existing health
endpoint returns ok/configured. Existing live NoteMesh reports OAuth read-only
scope, no existing-note edits and a running Obsidian daemon.

The latest live vault inspection showed 3,302 notes and approximately 126.5 MB
available. Re-check current headroom before a backup or rollout. No production
note, credential, grant, environment variable, volume or deployment was changed
by this development session.

## Automated verification

Commands:

- `pnpm lint`
- `pnpm typecheck`
- `pnpm build`
- `pnpm exec vitest run --maxWorkers=4`

Result: 81 files, 1,218 tests passed. The built HTTP server is tested, including
OAuth registration/consent/PKCE/refresh, auth challenges, scopes, read-only/API-key
isolation, intake backward compatibility, and exact Safe Edit metadata. The
synthetic Safe Edit HTTP test stubs only the external daemon pause boundary;
separate supervisor tests verify waiting for child exit and restart behavior.
No live Obsidian/production daemon is stopped during automated tests.

NVDA synthetic pilot: append evidence to Evidence Register, append review to
Change Log, verify both event-key links, require exact human approval, update
Current Thesis, read/hash/index verification, then approved version-guarded
rollback. No production thesis was used as a fixture.

Security/integrity cases cover path traversal, final/ancestor symlinks, hardlinks,
unsupported file types, invalid UTF-8/YAML, metadata allowlist, wrong actor/token/
hash, conflicts between prepared edits, expiry, idempotent append, no-clobber
create, disk reserve, backup checksum/version guards, interrupted-write receipts,
protected folders, false verification upgrades, source/claim deduplication,
contradictions, untrusted note text, escaped approval HTML and CSRF protection.

## Existing-suite corrections

The unmodified baseline commit was independently built/tested in a separate
checkout: 41 failures / 1,158 tests, mostly inherited expectations that the
read-only fork could create/edit/delete notes or grant legacy vault:write.
Those tests now assert the actual read-only resource contract. Underlying vault
operation tests remain. Fencing fixtures are seeded directly instead of through
a forbidden create tool, preserving hostile-content read coverage. The real
DELETE export-alias routing defect (compiled route returned 500) was corrected
in research/save/Safe Edit routes. Tool docs and catalog expectations now describe
the deployed surface, retaining upstream legacy descriptions as references.

The git noninteractive-child test now verifies real child environment using a
local executable shim rather than relying on unreachable external DNS. The
200 MB attachment test verifies complete streaming. In this managed host the
server PID is not visible through /proc/ps, so its optional RSS measurement is
reported unavailable; standard CI hosts still run that memory assertion.

## Continuation review: 2026-10-16

CI run [38840878843](https://github.com/varat1122/notemesh-readonly/actions/runs/38840878843)
on `cc412c3089048aa0b7c9c464cf475707452b45d2` completed the actual Docker build,
health check, nonroot ownership, persistent-volume preservation and PID 1 orphan
reaping checks. Lint, typecheck, build, 1,218 automated tests and all 31 Chromium
browser tests passed. These browser tests cover the existing dashboard; Safe Edit
approval auth, escaping and CSRF additionally have HTTP/handler coverage.

Review found a Docker install-order defect: the new root postinstall needed its
OAuth patch script before `pnpm install`. The script is now copied into that
layer; the CI image gate verified the fix.

The security audit failed on nine high/critical advisories. Updated MCP SDK to
1.32.1 and overrides for seroval 1.6.9, brace-expansion >=2.1.6,
source-map-js >=1.2.2 and proxy-addr >=2.0.8. After these dependency updates,
local lint/typecheck/build and all 1,218 tests pass again. Before applicability
review, re-audit reported zero critical, two high and eleven moderate
vulnerabilities. Two advisories have no published patched version:

| Dependency | Advisory | Decision |
|---|---|---|
| node-forge 1.4.0 | [GHSA-86w9-cpqp-85rv](https://github.com/advisories/GHSA-86w9-cpqp-85rv) | Scoped exception for build-only development TLS; runtime exclusion gate |
| braces 3.0.3 | [GHSA-vfj7-8cjw-p6xm](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm) | Scoped exception for build-time glob patterns; runtime exclusion gate |

Applicability review: both enter through the Vinxi/build-tool graph. Listhen
uses node-forge for developer certificate creation/loading; the runtime starts
the Nitro output directly, with Railway terminating public TLS. Braces receives
trusted repository build patterns through micromatch/globby, not vault text or
request patterns. Neither package/import is present in the built output. Two
exact CVEs are excepted in pnpm-workspace.yaml; the high/critical threshold stays
enabled for every other advisory. This is not a claim that these libraries are
fixed. Remove exceptions when fixes publish, and review again if the build,
entrypoint or use of user-provided patterns changes.

`check-runtime-exclusions.mjs` fails the build if either package manifest or
external import appears in the emitted server/client artifacts. Docker also
scans the separately installed global ob CLI dependency tree. The guard checks
packages/imports; it is not a general proof against arbitrary future inlining.
Do not switch Production to `vinxi dev`/`vinxi start`. Keep builds limited to the
reviewed repository/configuration, without user-provided build/glob/TLS inputs.

The authenticated Railway Production Backups panel was inspected: **No Backups**.
It explicitly requires upgrading to Pro to create new backups or schedules.
The user subsequently explicitly instructed in chat to skip Production Backup
and continue. Record the waiver; do not claim a backup or restore test exists.
No plan upgrade, volume resize, grant change or canary was performed.
The Production service auto-deploys main and **Wait for CI is off**, so merging
would itself initiate deployment. Keep the PR Draft until the remaining CI and
review gates pass. Per-edit checksum backups remain part of the Safe Edit
protocol; the waiver concerns the pre-deployment Production volume backup.

## Remaining operational checks

- Re-run the CI image/browser gates on the final dependency-update commit. The
  earlier Docker/browser run passed; it does not certify a later lockfile.
- Verify the two documented build-only exceptions and exclusion guard in CI.
- Railway connector exposes deployment/configuration tools but no volume-backup
  creation/verification or SSH command execution. A fresh backup needs the
  Railway dashboard or another authorized administrative path before rollout.
  The Backups panel currently has no backups and the plan cannot create them.
  User waived this pre-deployment backup explicitly; no backup is certified.
  Do not upgrade billing or resize the volume.
- Production canary needs explicit approval for the named synthetic note in the
  runbook. It is separate from permission to develop/deploy source code.
- Fresh OAuth consent, ordinary Chat tool discovery/apply/readback and actual
  remote/mobile arrival remain unverified. A successful Work/Inspector/API test
  does not establish the user's requested ordinary-Chat outcome.
