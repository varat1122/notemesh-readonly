# Better Auth 1.7.7 — M4 isolated Staging migration gate (2026-10-29)

Status: **PREVIEW/REVIEW ONLY — NOT APPLIED.** This document does not authorize a deployment, a database mutation or a Production change.

## Why this gate exists
- On the M4 staging branch, Better Auth 1.7.2 and the 1.7.2-era `backfillAccountIssuer()` can leave `account.issuer TEXT NOT NULL` and `account_issuer_accountId_uidx` in `/data/app.sqlite`.
- Better Auth >=1.7.3 reverted the mandatory `issuer` account column and does not populate it for new account rows. Package-only upgrades can break sign-up/account linking; a unique index can also conflate provider-side account IDs.
- This security-fix branch intentionally **refuses** to migrate a database containing `account.issuer` automatically. No model/tool should bypass the refusal or manufacture a backup receipt.
- Source: Better Auth official 1.7 upgrade guide, *Account identity keeps the provider key*: https://github.com/better-auth/better-auth/blob/v1.7.7/docs/content/docs/guides/1-7-upgrade-guide.mdx

## Operator preflight (STAGING ONLY)
1. Confirm **exact service**, environment and volume: `notemesh-m53-isolated-staging`, Railway staging, a single replica, `/data` volume. Confirm Production and pilot use separate volumes. Record deployed commit. Confirm `SAFE_EDIT_ENABLED` is still disabled; do not deploy pending writer flags.
2. Read the existing `/data/app.sqlite` schema via a read-only SQLite connection:
   `PRAGMA table_info(account);`, `PRAGMA index_list(account);`, and `SELECT providerId, accountId, count(*) n FROM account GROUP BY providerId,accountId HAVING n>1;`.
   If an unexpected schema, duplicate provider key, or an active writer exists, **HOLD**.
3. Before ANY schema mutation, stop authenticated requests/other writers under operator control. Use SQLite's consistent online-backup API or `sqlite3 ... .backup` (not a live `cp` of a WAL-mode database). Record byte hash, verify `PRAGMA integrity_check` on the copy, and perform a separate read-only restored-copy sign-in/migration rehearsal. Preserve the pre-upgrade DB **off the active volume** when possible; a Git branch of Markdown notes is not a database backup.
4. On the **verified isolated restored copy**, review the actual legacy index names and if they match the official guide execute in one controlled transaction only:
   ```sql
   BEGIN IMMEDIATE;
   DROP INDEX IF EXISTS account_issuer_accountId_uidx;
   ALTER TABLE account DROP COLUMN issuer;
   COMMIT;
   ```
   If other indexes/triggers reference issuer, or SQLite refuses to drop the column, **ROLLBACK / HOLD** and reconcile the actual schema; never invent SQL for an unknown state.
5. Re-run integrity checks and prove retained admin account and authorization records, existing sign-in, new sign-in/session, OAuth DCR/consent, refresh scope narrowing, revocation and Safe Edit resource-audience separation on the isolated restored copy. Document as-of time and exact SHA/receipt.
6. Only after compatible tests **and** a reviewed recoverable copy are confirmed, schedule a Staging-only cutover with authentication/Sync paused, schema cleanup, and coordinated deployment of the reviewed SHA. A rollback of the application **alone** is unsafe after a changed auth schema; define a compatible rollback/restore plan before cutover.

## M4 Acceptance
- Security audit, lint, typecheck, build, all unit/HTTP/E2E tests, Docker image/process gate GREEN for the exact commit. No ignored high/critical Better Auth advisories.
- Test-DB migration rehearsal with verified backup/readback and old/new login compatibility; no Production modifications.
- Only then deploy **Staging only**; enable writer flags in a separately reviewed step.
- Synthetic M4TEST only: Preview -> Apply -> Receipt -> SHA readback -> Search/Wikilinks -> Git Sync, with explicit authorization and protected-note boundaries.
- Remote-device Sync and Production are separate gates and cannot be inferred from server readback.
