# Data architecture and canonical contracts

## Source of truth and storage ownership

| Store | Owns | Derived/allowed duplication | Consistency |
|---|---|---|---|
| PostgreSQL | Stable identities, claims/evidence, semantic edges, note registry, permissions, decisions, portfolios, jobs/audit | Note hash/path/version and narrative metadata; never second authoritative narrative body | Transactional FK/version constraints; CAS for mutable pointers |
| Obsidian Markdown | Human-readable thesis/research/company/industry interpretation | Wikilinks, frontmatter IDs, generated decision summaries clearly marked as projections | One authorized writer, per-note CAS; reconciliation for manual edits |
| Drive/private object store | Exact original document bytes | Content-addressed authorized local cache and backup; hash manifest explains copies | Immutable objects; registry moves to ready after readback |
| Parquet + DuckDB | Versioned market/quant partitions and result artifacts | PostgreSQL stores manifests, as-of, hash, licensing and lineage | Immutable partitions; publish manifest only after hash verification |
| Git | Code, schema, ADR, synthetic fixtures | Never real portfolio, original licensed data or credentials | Version-controlled source and lockfiles |

A source's URL or Drive file ID is a locator, not its identity. Drive revisions can change; P1 must preserve exact authorized bytes separately when retention rights permit. Content SHA determines byte identity, not claim truth or publisher authenticity. DB and Markdown duplication is intentional only for indexes, path/hash registry and explicit human-readable summaries. The authoritative field owner is listed above.

## ID and revision rules

Every entity has UUID `id` independent of ticker, path, provider or database. P1 uses UUID4 generated once at first capture, unique within the registry; deterministic UUID5 is used only for reproducible synthetic fixtures. Issuer/company differs from its listed instruments, ADRs, classes and venues. Symbol aliases have venue/currency/effective interval; same ticker may identify different instruments. Overlapping aliases require ambiguity resolution in the P1 Security Master, not automatic merging. CIK/FIGI/ISIN mappings carry their own entitlement and validity checks before use.

`version` is a positive immutable revision under the same identity. `schema_version` identifies contract format, not business revision. Superseding a different source/event uses `supersedes_id`; a revision of the same ID increments version. Cross-entity references may pin `to_version`; decisions require explicit thesis revision. A note move changes the registry path/version and preserves path history, not note identity. Original document bytes change → new Document identity/digest; source correction links old/new versions.

## Common fields and timestamps

All entities carry provenance (origin, source IDs, actor, basis, original origin, license/permitted uses, independence), classification, status, reviewer and timestamp envelope. UUIDs can refer to actors outside the entity registry, so actor authority belongs to the identity system, not note content. Verification is unverified/verified/rejected/superseded/not_applicable. `verified` requires reviewer and verification time; AI and synthetic artifacts cannot self-promote. That contract is necessary, not sufficient: evidence review must also verify source and authorization in P1/P2.

| Time | Meaning | Unknown / rule |
|---|---|---|
| event_at | Occurrence described | null when unknown; never import time |
| published_at | Publisher's release time | preserve source timezone/precision separately during ingestion |
| received_at | First observation by this system | required, timezone-aware |
| imported_at | Registry capture | required; >= received_at |
| verified_at | Authorized evidence review | only with verified status/reviewer |
| data_as_of | Data measurement/snapshot boundary | not retrieval freshness |
| effective_from/to | Business validity interval | ordered if both known |
| calculation_at | Deterministic execution time | required for computed QuantRun |
| known_at | Information first knowable | distinct from occurrence |
| available_to_strategy_at | Information usable by strategy | >= known_at when both supplied |
| vintage_at | Dataset release/restatement vintage | keep prior values for historical replay |

Datetime inputs require explicit timezone. Database timestamps are `timestamptz`; stored instants are UTC, display may be Asia/Bangkok. Date-only/uncertain source values must not invent midnight UTC: preserve original string and precision in the future parser artifact and leave unknown instant null. API contract serialization retains supplied offset for lossless interchange; persistence must normalize via `utc_iso` before canonical hashing. Hash canonical payload with fixed JSON encoding, sorted keys and decimal strings; retain original document bytes unchanged. P1 implements the canonical serializer and actual persistence workflow.

## Logical entity catalog

Full executable definitions: `src/investment_os/domain/entities.py`; JSON Schemas: `docs/schemas/*.json`; all 24 synthetic examples: `tests/fixtures_synthetic/entities.json`. Each row inherits the common fields above.

| Entity | Links / specific validation | Authoritative location |
|---|---|---|
| Instrument | issuer → Company; dated SymbolAlias; no ticker identity | PG |
| Company | Industry IDs; jurisdiction/legal name | PG identity + Markdown knowledge |
| Industry | parent Industry, versioned taxonomy | PG identity + Markdown knowledge |
| Technology | maturity and name; semantic relationships separate | PG identity + Markdown knowledge |
| Document | digest, size > 0, media type, storage backend/key | Object bytes + PG metadata |
| Source | Document, optional original Source; channel/type/publisher | PG |
| Event | Company, nonempty Sources, period/classification, related Event | PG |
| Claim | subject entity + Event; numeric value requires period/unit | PG |
| Evidence | Claim + Source + Document digest/locator; support/contradict/context | PG |
| Relationship | typed directed endpoints, evidence, mechanism, strength, validity | PG; Wikilinks project references only |
| Note | canonical path/hash/type/entity IDs, prior paths | Markdown body + PG registry |
| ResearchReview | Event/Note/Sources/Claims/Thesis, analyst lens, uncertainties | Markdown body + PG provenance |
| ThesisVersion | Company/Mandate/Note, scenarios, assumptions, invalidation, approval | Markdown narrative + PG revision/approval |
| MarketDataReference | Instrument, dataset hash/locator/provider/license/as-of/adjustment | PG manifest + Parquet |
| QuantRun | dataset IDs, code/environment/model, parameters, costs/bias controls | PG manifest + Parquet/results |
| Signal | Instrument + QuantRun, generation/expiry/horizon | PG |
| Mandate | type/horizon/risk budget/currency/constraints | PG |
| TradeSetup | Mandate/Instrument/Thesis/Signal/MarketData, entry/stop/expiry | PG; executable_order always false |
| Portfolio | account, base currency, mandates, explicit return method | PG confidential |
| Transaction | Portfolio/Instrument, quantities/price/fees/taxes/FX/settlement | PG confidential; synthetic only in P0 |
| Decision | mandate, pinned thesis revision, research and independent risk IDs | PG; Markdown summary derived |
| AuditEvent | actor/action/resource/request/hash/outcome | PG append-only |
| Job | actor-scoped idempotency/digest/state/attempt | PG operations projection |
| Receipt | Job/resource hashes, physical/index/link checks, stage | PG append-only |

Provider bar contract additionally validates OHLC range, volume, currency, dataset ID, session and availability. Negative prices are not universally forbidden across all asset classes; adapters must enforce instrument-specific rules. No performance result is fabricated in fixtures.

## Physical P0 schema

Alembic revision `0001_p0` creates `entities`, `entity_versions`, `entity_references`, `operations`, `audit_events`, `receipts`, `permission_grants`, plus Alembic's version table. [Physical ER](diagrams/README.md#physical-registry) shows relational constraints.

The registry stores validated, versioned domain payloads in JSONB while FK/version columns remain relational. This is an explicit P0 foundation (ADR 010), not a claim that every later business field already has a SQL constraint. `entity_versions` is append-only; the entity current-version FK is deferred to allow one transaction to insert identity and revision. Reference rows enforce existence and optionally revision. API's DB role has SELECT only. Version pointers are updated using `WHERE current_version = expected`; zero rows means conflict.

The database rejects missing versions, dangling materialized references, actor/key duplicates, invalid receipt commitment and changes to append-only history. The P1 repository MUST validate EntityEnvelope, compute digest, verify entity kind/typed reference targets, extract all reference rows and write them in the same transaction. P0 intentionally exposes no persistence endpoint until these checks exist. JSON payload references alone are not automatically SQL foreign keys. Denormalized payload and reference projection must be reconciled; no claim of complete business-level DB integrity yet.

## Synchronization, backup and consistency

Database operations are atomic inside PostgreSQL. Original bytes and registry use an outbox/journal in P1; Markdown + PG + second note use a recovery protocol in P2. No distributed atomic transaction is claimed. Manual Vault edits trigger hash/version mismatch and reconciliation, never silent overwrite. Source caches and FTS are rebuildable; original bytes, identities, historical payloads, decisions and journals are not disposable.

Backup set: PG dump/WAL boundary + Vault file manifest/digests + object inventory/bytes + Parquet manifests + schema/code version + encryption-key recovery reference. Pause writer or capture a consistent checkpoint; restore into isolated stores, verify hashes, references, operation states and indexes before resuming. Sync is not backup. P0 provides a local schema dump/restore drill; full cross-store recovery belongs to P2/P9. Retention, RPO/RTO and encryption/key custody require owner approval before real data (operations runbook, ADR 009).
