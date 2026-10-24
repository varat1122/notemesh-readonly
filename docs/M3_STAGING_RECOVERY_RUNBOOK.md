# M3 — Staging Recovery Runbook (approval-required; NOT EXECUTED)

**Status:** planning artifact, not a live restore receipt.  
**Scope:** independently isolated Staging recovery only. Never Production.  
**Related:** Draft PR #112 (offline CI), existing Safe Edit/Git Pilot security controls.

## Evidence boundary

The M3 CI gate runs `src/server/sync/git-backend.test.ts` against local, disposable bare Git remotes and four `scripts/backup/nm-*.test.mjs` suites using synthetic data. CI success is **offline verification** only: it does not establish that a real Railway volume snapshot is retained or restorable, nor that Obsidian Desktop/Android has received a note. Do not classify M3 as full live-recovery PASS without separate evidence.

## Authorization gate (hard STOP)

1. Owner must separately approve **one exact backup ID**, **one fresh empty recovery target**, the allowed steps, cost ceiling, rollback and operator. Generic permission to improve CI/code is **not** permission to restore.
2. Verify project, environment, service, and volume IDs in authenticated Railway inventory immediately before action; use private operations records for exact resource IDs (do not publish identifiers, paths containing secrets, tokens, or backup contents here).
3. Confirm the recovery target is not Production, active Staging, an existing Obsidian device folder, or a reused volume. Disable all writers, Git auto-push, background Sync and mutation endpoints on the recovery target *before* any recovered data is mounted.
4. Stop if snapshot identity, isolation, key/permission, ledger continuity, or source/target integrity cannot be established. No credential changes or Paid OpenAI API.
5. Do not merge, deploy, force push, reset evaluation ledger, restore over a live volume, or write any real Vault during a dry-run/preflight.

## Read-only preflight inventory

Record in restricted audit evidence: snapshot ID/provider, captured timestamp and retention status; source project/environment/service/volume; encrypted size and access mechanism **without disclosing keys**; current Staging deployment ID/commit; Git Test Vault `main` remote HEAD; source Vault path/count/hash inventory and database identity, SQLite WAL state, version, timestamps and available restore targets. Unknown fields are **NOT VERIFIED**, not assumed.

A dashboard backup row is proof of backup listing only, **not** proof of recoverability. A Git commit is not proof of device synchronization.

## Separately approved restore procedure

1. Provision a new isolated, private, empty volume/service with explicit nonproduction scope and no scheduled/background writers. Record all new resource IDs and network restriction in the restricted log.
2. Restore **only** the approved snapshot using provider-supported semantics to the isolated target; never reuse live Staging/Production volume. Capture the provider operation receipt, duration, status, warnings, and backup identity.
3. On the quiescent recovered copy only, inventory files and compare relative paths, counts, ownership/modes, symlinks and SHA-256 digests against a consistent approved source/backup manifest.
4. Independently run `PRAGMA quick_check` and `PRAGMA integrity_check` on recovered SQLite databases, validate schema/table counts and WAL consistency without mutating the original live database.
5. Read-only compare recovered Git origin/branch/local HEAD metadata against an independently fetched Test Vault remote HEAD. HEAD equality alone does not prove file-byte equivalence.
6. Where snapshot time makes it applicable, confirm the known one-note pilot marker, local hash, Git blob content and audit receipt. A snapshot taken before the pilot must be classified as an **RPO gap**, not necessarily corruption.
7. Verify host/auth/writer safeguards stayed disabled on the isolated restore. Keep M2 device sync paused.
8. Record exact PASS/FAIL/BLOCKED, before/after manifests, provider receipt, remaining mismatches and owner sign-off in restricted immutable audit evidence.

## Classification / stop / rollback

- **PASS — live isolated Staging restore:** authorized operation completed to a separate destination; source/restore identity, physical SHA inventory, SQLite integrity and Git provenance validated; no original Staging, Production, Test Vault, ledger or credentials modified.
- **FAIL:** restore attempted and an integrity, isolation or hash check failed; quarantine target and preserve receipts; no destructive automatic retry.
- **BLOCKED:** missing authorization, backup ID, isolated target, consistent manifest, necessary key/capability, or safe recovery procedure. Do not report success.
- **STOP IMMEDIATELY** on shared/overlapping target, active writers, unexpected Git HEAD, tamper/hash mismatch, unknown Git push outcome, attempted security bypass, unexplained new cost or any write to live resources.
- **Rollback** only the disposable isolated recovery target after recording evidence and separate owner approval; never roll back Production or operational Staging as part of this test.

## Open risks after passing offline CI

- Real Railway snapshot retention/recovery: **NOT VERIFIED**
- Desktop/Android Obsidian note arrival: **PAUSED by owner**
- Direct ChatGPT MCP `apply_edit`: **PLATFORM BLOCKED**; use independently approved owner-operated flow only
- Existing audited dependency exceptions: retained with explicit build/runtime boundaries; revalidate when entrypoints or dependencies change
- Source repository and Test Vault visibility/permissions: recheck using live GitHub access before publishing internal operational evidence

This runbook is documentation only. **No restore, paid inference, deployment, credential or Vault operation is authorized by its presence.**
