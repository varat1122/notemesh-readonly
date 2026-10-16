# Safe Edit implementation and acceptance report

Checked: 2026-10-16. This is an implementation report, not a production success receipt.

## Status

| Acceptance stage | Status | Evidence / limitation |
|---|---|---|
| CODE_READY | Implemented | Separate resource, seven tools, scope checks, preview/hash/backup/atomic write/readback/index/receipt and guarded rollback |
| TESTED | Local automated gates passed | 1,218 tests / 81 files; lint/typecheck/build pass; Docker/browser gates require CI |
| DEPLOYED | No | Production is unchanged; fresh production backup must be confirmed first |
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

## Remaining operational checks

- Docker runtime/image build: no local Docker daemon; use the repository CI image
  job, then inspect its result before approving production rollout.
- Browser suite: local Playwright Chromium download returned an invalid/truncated
  archive. Approval-page auth/escaping/CSRF tests pass at handler level, but that
  does not substitute for browser UI verification. CI must run browser tests.
- Railway connector exposes deployment/configuration tools but no volume-backup
  creation/verification or SSH command execution. A fresh backup needs the
  Railway dashboard or another authorized administrative path before rollout.
  Railway documentation says manual backups are limited to 50% of volume capacity;
  current usage is above that fraction. Check the Backups panel and available
  scheduled backups; do not silently resize a volume or claim a snapshot exists.
- Production canary needs explicit approval for the named synthetic note in the
  runbook. It is separate from permission to develop/deploy source code.
- Fresh OAuth consent, ordinary Chat tool discovery/apply/readback and actual
  remote/mobile arrival remain unverified. A successful Work/Inspector/API test
  does not establish the user's requested ordinary-Chat outcome.
