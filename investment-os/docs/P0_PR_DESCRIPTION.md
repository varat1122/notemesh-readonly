# Investment OS: add isolated synthetic-only P0 foundation

The greenfield Investment OS blueprint has no runnable Python/data-contract foundation. This change adds it under `investment-os/`, preserving the existing NoteMesh application and prior PR108 work. The API exposes health, contract validation and a non-executing policy evaluator; all protected writes and paid/model/trading operations remain unavailable.

Includes 24 canonical entity schemas, provider-neutral module interfaces, a PostgreSQL registry/version/audit migration, SELECT-only API DB role, Docker Compose, read-only synthetic Vault adapter, synthetic fixtures, architecture/storage/security specifications, 12 Mermaid diagrams, 10 ADRs and an ordered P1 implementation plan. A separate CI workflow checks only the new foundation.

Validation actually performed: 85 Pytest tests (including 9 real PostgreSQL integration tests), frozen install repeated in a fresh environment, lint/format/schema drift checks, Docker Compose health/migration, real HTTP authorization denial, synthetic Parquet readback, and database backup/restore plus migration reversal. All 12 Mermaid diagrams passed the actual Mermaid syntax parser.

Outstanding: browser Mermaid rendering is blocked by environment file:// policy; detailed owner architecture/schema review is pending; remote GitHub CI is not verified. Real OAuth, provider adapters, ingestion, cross-store writer/recovery, research/quant/tactical/portfolio engines are later phases. P1 must enforce typed reference targets and canonical payload hashes before exposing business persistence.

No paid inference, real Vault modification, production deployment or merge. Draft for review only. Full evidence and limitations: `investment-os/docs/IMPLEMENTATION_STATUS.md`.
