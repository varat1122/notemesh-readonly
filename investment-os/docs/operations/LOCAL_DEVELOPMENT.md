# Local development, migrations and recovery

## Reproducibility

Python range is 3.12; uv version 0.12.23 and all resolved dependencies/hashes are locked in uv.lock. Python and PostgreSQL Docker bases are digest-pinned. `uv sync --frozen` refuses missing/stale lock resolution; schema export `--check` detects DTO drift. Docker uses the same lock and installs noneditable package wheels; API runs as UID 10001. No secret file or proxy CA is baked into images; CA is an optional BuildKit secret for networked install steps.

Recheck locks and base digests for security updates through a reviewed change. A lock is reproducibility, not proof dependencies are vulnerability-free. The supplied blueprint and synthetic fixtures are the only research content in this subtree. The bounded repository scanner detects common credential patterns and unexpected dataset files; manual review remains necessary.

## Startup and failure handling

Use README commands or `scripts/check.sh`. `db` health → `migrate` exit 0 → `api` ready is the startup chain. Liveness alone cannot establish DB readiness. An absent or wrong schema gives 503. Integration tests require `IOS_TEST_DATABASE_URL` and reject databases other than the dedicated `ios_synthetic`; a missing variable explicitly skips, so do not cite a unit-only run as DB validation.

The local bridge binds published ports only to 127.0.0.1. Do not change these to public interfaces with dummy auth. The managed cloud's proxy/network policy remains in force. If a host is blocked, record BLOCKED; do not disable TLS, proxy or browser policy. A full Docker cache can exhaust development disk; inspect usage and reclaim only unused build cache, preserving all service volumes and unrelated projects.

## Migrations and rollback

Alembic config contains no credential. `IOS_DATABASE_URL` selects the DB. Only the migration owner changes schema. API uses SELECT-only role. P0 migration is reversible and repeatable; downgrade intentionally destroys this foundational schema, so it is exercised only on a temporary restored synthetic database. Future real deployments require reviewed forward migration, backup and a compatibility/rollback plan; no blind downgrade of real records.

`restore_drill.py` captures a real `pg_dump -Fc`, restores to a uniquely named disposable DB, compares a fictional company payload/digest and schema revision, then exercises downgrade/upgrade/idempotent upgrade there. It removes only that temporary restored DB. The primary synthetic fixture remains for restart checks. This proves database restoration only, not Obsidian/object/Parquet/device recovery.

## Cross-store recovery design for P2/P9

Define RPO/RTO and retention with the owner before real deployment. Stop/fence the writer, record checkpoint and journal boundary, dump PostgreSQL with schema/code manifest, copy Vault before-images + content manifest, snapshot immutable object and Parquet partitions, preserve encryption-key recovery references outside Git. Restore to isolated paths/DB, verify all hashes and identity/version relationships, rebuild derived indexes, reconcile partial operations and verify a new event retrieves prior history. Resume one writer only after review. Sync/replication does not replace backup and does not prove device delivery.

## Observability

HTTP logs emit JSON request ID, method, route template and status. They never intentionally log query/body/token. Validation/readiness errors are sanitized. Future business audit must be transactional/append-only and distinct from process logs; P0 has the table but no business writer. Required later metrics: intake latency/failures, missing/contradictory evidence, stale data/signals, CAS conflicts, partial writes, readback mismatches, source rights blocks, provider usage/budget and portfolio reconciliation gaps.

## Known external gates

Real authentication/authorization and secret custody, model export/budget, Drive OAuth, real Vault enrollment, vendor licensing, portfolio account/risk limits, cloud retention/backup and public ingress require separate owner decisions. No local PASS silently approves them.
