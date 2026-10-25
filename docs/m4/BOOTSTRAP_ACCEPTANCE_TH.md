# M4-BOOTSTRAP-01 — fixed synthetic bootstrap acceptance package

Baseline: `b951c78ede20dac7d858f673df9b62b426984f89`, Draft PR #113.
Candidate branch: `feat/m4-synthetic-bootstrap`; no changes to PR #113/main.
Owner's latest task authorizes development/tests/commit/push/Draft PR, overriding the attached historical handoff's earlier development HOLD. It does not authorize deployment, flag activation, real Test Vault writes or restore.

## Root cause and minimal correction

The private Test Vault has no Source/Company/Evolution anchors, per owner-side QA. Existing M4 validates indexed anchors before preview; its prior tests created those anchors directly in fixture setup. General Git Safe Edit only permits the fixed pilot note, the M4 graph adapter only creates Analysis/appends an existing Timeline, original-source byte archival does not create these Markdown anchors, and legacy intake uses another namespace/Obsidian guard. No existing authorized route can seed these four absent paths.

This patch extends the existing owner route `/api/staging-research-review` with a separate default-disabled bootstrap action. It accepts NO caller-defined note paths/content. Its four UTF-8/newline-preserving fixtures come verbatim from the owner handoff and are versioned in `src/server/safe-edit/synthetic-bootstrap-fixtures.ts`.

Existing Safe Edit preview/token/independent exact-hash approval/CAS/backup/journal/atomic no-clobber creation/indexer and the existing Git lock/clean-HEAD/exact-diff/pre-push CAS/remote-readback transaction are reused. The latter accepts four adds only when the bootstrap flag is on and every path/hash is the fixed manifest. Existing one-note/two-note paths remain bounded.

Missing folders are not created by Preview. Only after ALL FOUR active approvals/tokens/version checks pass and the durable applying journal is recorded does the Safe Edit engine create the approved parent directories. It walks directory descriptors with O_DIRECTORY/O_NOFOLLOW, fsyncs created parents, records creation events and preserves atomic link(2) no-overwrite publication. No shell seed, direct GitHub Vault write, generic mkdir, alternate note writer or OAuth actor spoofing is introduced. Like the existing engine, external filesystem writers must be absent; the staging gate still requires a genuine exclusive single replica.

## Fixed scope / expected bytes

These are proposed synthetic targets, not a claim they currently exist in live Staging. Source A/B have `source_type: user_supplied`, `verification: unverified`, `synthetic: true`; M4TEST is fictional. No Current Thesis/Evidence Register/Portfolio is created or changed.

| Fixed operation ID | New fixture path | Expected SHA-256 (NOT live receipt) |
| --- | --- | --- |
| `m4-bootstrap-20261025-source-a` | `10_Knowledge/M4TEST - Synthetic Source A.md` | `f3d18f737976ba6bcf15b43093f59ad70ab39695cbe446919c67392fecd20bae` |
| `m4-bootstrap-20261025-source-b` | `10_Knowledge/M4TEST - Synthetic Source B.md` | `956a17b2a795b22406ef7a0cc627f7ae7f5ff23e00bbca22100598dc86be908b` |
| `m4-bootstrap-20261025-hub` | `01_Companies/M4TEST.md` | `ffe4b1a990c58a3b5c235ef838fb153bf720faebc8310b3c52e8714d217b8eee` |
| `m4-bootstrap-20261025-timeline` | `08_Daily_Weekly/Research Indexes/Company Evolution - M4TEST.md` | `9984a447a21b7b29bb74744e0656719c7f87ea7cc32220a50b588f66e35c410b` |

## One consolidated owner approval package — NOT EXECUTED

Before approving live execution, owner-side readback must confirm the target is the existing isolated staging service/private Git Test Vault, not Production; exact candidate image/SHA; authenticated default-off guard; clean local/index/remote HEAD; no unresolved journal/hold/lock; one replica without overlap; existing staging credential scope; backup ID/time/retention/recoverability evidence; and usage within the existing infrastructure budget. Remote HEAD alone is insufficient. No backup mutation/restore or runtime-window extension is authorized by this document.

The prior handoff reports a 3000-second startup timeout, NEVER restart policy and application sleeping. This patch does not change them. Owner must approve/verify a fresh bounded operational window with time to review all diffs within the existing 30-minute approval TTL. Stop on unknown remaining runtime/budget or unresolved recovery state.

After the new SHA's CI/review, the single grouped request is:

1. Deploy ONLY the reviewed candidate to the existing Staging service; preserve volume/root/index, credentials, Auto-deploy OFF and Production. Existing writer/M4 gates and the new `GIT_RESEARCH_BOOTSTRAP_M4=1` need explicit configuration approval, not an assumption based on this code merge request. `INVESTMENT_GRAPH_BUNDLE_ENABLED=0`, `CLOUD_INTAKE=0`, single-writer controls and the fixed Git remote/branch restrictions remain unchanged.
2. Approve bootstrap scope only: the exact four paths/bytes above, fixed operation IDs and necessary parent directories. The scope approval does NOT replace four independent exact-afterHash admin approvals through the existing approval page.
3. Separately permit the returned synthetic Analysis A + existing Timeline append only after its own two previews/exact-hash approvals. Source B is READ-ONLY next-event retrieval; do not write Analysis B, protected notes or production data.
4. Define end-of-window flag shutdown/compute handling within the existing budget. If any attempted operation is partial/unknown, stop and preserve DB/WAL/.git/receipts/notes/hold/directories. No automatic retry, new IDs, lock removal, rollback or restore.

No new services, database stack, paid API/model, credentials, public endpoint, production operation or device-sync testing is part of this request.

## Exact owner procedure after approval

1. Open the existing authenticated owner route. Without the new bootstrap flag, there is no bootstrap button and POST `bootstrap-*` returns 403. Unauthenticated requests remain 401 and foreign/missing Origin POSTs remain 403.
2. Choose **Preview four synthetic fixtures** once. This creates journal/hold coordination and four previews only; it creates no folders, Markdown files, commit or push. Keep this tab/token set open.
3. Inspect all four FULL diffs/path/hash/expiry values. Open each existing admin approval link in a separate tab, approve that exact hash, then return and Check approvals. With fewer than four active approvals no Apply button is shown; forced POST is refused by the engine too.
4. Choose Apply once. All tokens/approvals/manifest/base/CAS are rechecked before the first filesystem write. Existing targets (even identical bytes) are never overwritten. Dirty/stale/symlink/conflicting scope stops rather than repairs state.
5. Require `synthetic_bootstrap_git_physical_fts_verified`, `bootstrap_verified` journal stages, exact four-file ADD commit whose parent is the approved Git base, remote blob/physical SHA-256 agreement and SQLite/FTS body/frontmatter/size agreement. Independently inspect GitHub Test Vault and NoteMesh reads. Do not report success from Preview or from a successful health response.
6. Copy the returned `researchPackage` only after this readback. Its Source A SHA is computed from actual physical bytes checked against FTS/remote, not copied from this document's proposed digest. Freeze the new remote/local HEAD and call existing read-only `prepare_investment_graph_review` to confirm canonical Source/Hub/Timeline and duplicate state.
7. Import the returned existing graph-bundle JSON through the normal M4 flow. Review/approve Analysis and Timeline independently, Apply once, then verify remote parent/two-file diff, Source unchanged, physical/FTS/Wikilinks/backlinks and receipt.
8. Call existing read-only preparation with issuer M4TEST, event `M4TEST-SYNTH-B-20261025`, period SYNTHETIC and Source B path. It must retrieve A as `archived_ai` / `declaredIndependentEvidence:false`. Do not promote it to verified source evidence or write Analysis B.
9. Read-only bootstrap receipt URL: `/api/staging-research-review?bootstrap=1`, authenticated as the same owner. It reports historical operation receipts; a later legitimate Timeline append can change that file beyond its initial bootstrap hash.

Preview tokens are never stored in plaintext. Lost/expired previews and partial states require manual reconciliation; this one-shot pilot does not automatically issue replacement IDs or clear journals. Existing note-create rollback does not delete created notes; created directories are also retained on failure.

## Reproducible synthetic verification

Tests extend existing `git-backend.test.ts` and owner-route tests, starting with NONE of the three required parent namespaces. They exercise real Safe Edit + directory creation + SQLite/FTS + local bare Git transaction, then the real M4 Analysis/Timeline write and Source B historical recall. Only platform identity/owner-session attestation is fixture-controlled; no live vault/service/credential is used.

Cases include absent/partial approval, disabled gate, wrong actor/path/bytes/ID/token/hash, dirty worktree, stale remote, existing target refusal, symlink planted during mkdir, partial second write, FTS corruption and accepted-but-unknown push with no replay/background publication. The graph package is generated only after verified bootstrap. Existing M4/Obsidian/security regression gates remain required.

Local/CI counts and exact candidate SHA must be reported from actual runs. Previous #396/b951c78 results do not certify this patch. Failed intermediate lint/type/test logs are retained outside Git. Source code is public; only these synthetic fixture bytes and code/evidence are committed. No live staging receipt is manufactured.

M1–M3 are not reopened or repeated live; M2 remains paused. Live Staging bootstrap/Analysis/next-event acceptance remains BLOCKED until the above owner gates and exact-hash approvals are completed.

## Candidate validation evidence — 2026-10-25

Executed against this branch's final runtime/test diff; the resulting source commit SHA is recorded by Git and the PR.

- `pnpm lint`, `pnpm typecheck`, `pnpm build`: PASS, including client/server boundary and runtime-exclusion scans.
- `pnpm exec vitest run --maxWorkers=4`: **1985 tests / 167 files PASS**, no failed/skipped tests. Includes the real empty-namespace bootstrap → four-add Git transaction → M4 Analysis/Timeline → Source B recall, plus failure/replay cases.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH=/usr/bin/chromium pnpm exec playwright test e2e/dashboard.spec.ts`: **32 PASS**. Existing system browser used locally; the initial attempt hit ENOSPC before execution, resolved by pruning disposable Docker build cache only. The four other static-demo E2E cases are left to the existing full browser CI; local dashboard success does not certify them.
- `pnpm audit --prod --audit-level=high`: PASS **under existing exceptions**, reports 3 low / 16 moderate / 1 high (1 ignored). No dependency, lockfile, ignore policy or security control changed. This is not a zero-advisory claim.
- Docker build: PASS, local image `sha256:2036254d210367b852edb34f6de28b2e5ff9513703e68ab8ed434d130900ee58`. Managed-cloud CA was supplied by temporary BuildKit secret and proxy-aware temporary build instructions outside Git, with TLS verification enabled; repository Dockerfile unchanged. CI independently builds the original Dockerfile.

- Disposable local Docker runtime: PASS — health, SQLite read-only quick_check=ok, tini PID 1, unprivileged data permissions, anonymous bootstrap GET/POST=401 and no bootstrap namespaces created. Writers/bootstrap disabled, no live resources used. Initial diagnostic command mistakes (module location and absent BASE_URL) were corrected outside source; the final invocation uses the actual bundled SQLite module and matching Origin.

Validation logs remain outside Git in `/tmp/bootstrap-*.log`. No remote Git Test Vault, live deployment or live writeback receipt is represented by these results. Existing paused evaluation ledger/identity and original worktrees are preserved.
