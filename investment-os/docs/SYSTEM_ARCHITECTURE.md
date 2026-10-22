# System architecture

## Execution model

Python 3.12 modular monolith, FastAPI at the boundary, PostgreSQL for canonical state and a later worker using the same domain package. Adapters depend on domain contracts; domain contracts never import a provider SDK, database, model client or filesystem. P0 includes API, domain, ports, policy, database bootstrap and a synthetic read-only Vault adapter. See [diagrams](diagrams/README.md) for executable Mermaid sources.

| Component | Responsibility | Contract / authority | P0 status |
|---|---|---|---|
| API | Authentication, request validation, health, policy evaluation | EntityEnvelope, PermissionRequest | Running, no business-write routes |
| Domain | IDs, provenance, chronology, validation | 24 versioned entity types | Implemented and tested |
| Policy | Deny protected actions, restrict paths | Principal supplied by server, Action enum | Synthetic policy implemented |
| Registry | Identity, immutable versions, references, operation evidence | UUID + version + payload hash | Migration only; repository in P1 |
| Intake | Immutable capture, quarantine, normalization | IntakeRequest/Result | Interface only |
| Evidence | Claim-source provenance, contradictions, review | Claim/Evidence/Relationship | Schemas only |
| Retrieval | Point-in-time, permission-filtered context | RetrievalRequest/ContextPack | Contract checks only |
| Research | Choose frameworks, structured drafts, disagreement | ResearchRequest/Result, SpecialistResult | Interface only; no multi-agent runtime |
| Model adapter | Provider isolation, egress/license/cost control | ModelAdapter | No provider implementation |
| Quant | Deterministic calculation from versioned data | QuantRequest/QuantRun | Interface; Parquet storage smoke only |
| Tactical | Expiring mandate-specific proposals | TradingRequest/TradeSetup | Interface; cannot submit orders |
| Portfolio and committee | Aggregate exposures, independent risk and decisions | PortfolioRequest/Result, DecisionRequest/Decision | Interface only |
| Vault agent/writeback | Scoped local IO, CAS, journal and receipts | WritebackPlan/Receipt | Read-only synthetic reader; writer deferred |

## Flow and data boundaries

Intake produces Source and Document identities before claims are extracted. Content hash detects repeated bytes, not event equivalence. Evidence review references exact document digest + locator. A correction creates new immutable source/document revisions and links the superseded source/event; it never rewrites the earlier observed truth.

Retrieval resolves company/instrument IDs first, filters entitlements and as-of availability, then includes original sources, current thesis, contradictory evidence, industry and archived AI reviews. It returns omissions/truncation explicitly. Historical AI remains non-independent. The future reader must fetch truncated documents before claiming complete evidence. P0 validates future timestamps and AI provenance; search/ranking/full-read enforcement comes in P2.

Orchestration selects frameworks, not necessarily separate agents. One model can execute Fundamental/Industry/Red Team with distinct prompts and schema. Independent risk is a separate authority, not majority voting among models. Provider output must pass contract and citation checks before draft presentation; it cannot call the persistence layer or supply approval tokens. Cost and rights gates occur before sending any provider request, including retries. No provider code exists in P0.

Quant consumes immutable datasets and explicit parameters. AI may propose a calculation but may not supply fabricated numeric results in place of engine output. Reproduction binds dataset, code, environment, parameters, as-of, cost assumptions and limitations. Market estimates use known/available timestamps and vintages; revised values cannot leak into prior backtests. Tactical setups expire, keep their mandate and cannot overwrite core thesis. Portfolio exposure eventually aggregates all mandates without duplicating transactions.

## Trust boundaries

Untrusted document/social/chat/model text is data only. Client role headers, note instructions, model-generated approvals and external URLs cannot confer permission. The only P0 identities are public dummy tokens explicitly enabled for loopback synthetic testing. This is NOT production OAuth. No real credential is read by the application.

Compose API has a read-only filesystem, non-root UID, dropped capabilities and a DB SELECT-only role. A separate one-shot migration container has the schema owner credential. API and DB use a project-specific Docker bridge; exposed ports bind loopback. This is not an egress-deny firewall; outbound controls remain host policy. No production volume is mounted. The local reader requires the synthetic marker and traverses components with directory FDs/O_NOFOLLOW. Administrators able to replace the configured root or database owner remain trusted; this is not a hostile-host sandbox.

## Persistence and failure protocol (P2 design, not P0 implementation)

1. Resolve exact note/issuer IDs and permissions; no guessed Wikilinks.
2. Canonicalize proposed content, record actor-bound idempotency key + request digest and source revision.
3. Preview diff; obtain scoped, expiring approval bound to actor, targets, hashes and action.
4. Write-ahead journal; check versions/CAS, preserve before-image, atomic rename one file.
5. Read back bytes and hash; update derived FTS and typed-link projection.
6. Append to existing evolution timeline as a separately journaled step. Two files + DB cannot be one filesystem transaction.
7. Mark receipt committed only when physical/index/link checks pass. Interrupted work stays partial, never automatic blind retry.
8. Recovery inspects durable receipts and exact before/after versions. Resume only missing authorized steps; conflicting bytes require human review. A new payload on an old idempotency key is conflict, not replay.

P0 demonstrates constraints and CAS primitives in PostgreSQL, not a finished outbox, locking service, writer or recovery runner. Device Sync is an independent verification boundary.

## Local deployment and future cloud

MVP API/worker/agent run beside an authorized local Vault. P0 uses only checked-in synthetic Markdown. In P2 API/worker should call a scoped agent interface, never accept arbitrary local paths over HTTP. A future cloud API communicates with an owner-enrolled local agent over authenticated outbound transport, or an explicitly authorized replica. The local authoritative writer retains CAS/journal controls. Cloud migration requires TLS/OIDC, distinct DB roles, encrypted storage/backup, key rotation, private networking, restores, network/entitlement/cost review and explicit owner approval (ADR 009).

One backend serves optional ChatGPT/Web/Mobile/LINE clients. Later interfaces cannot maintain independent decision or thesis truth. LINE requires signed webhook + account binding and prohibits confidential portfolio disclosures to unbound groups. X defaults to manual URL intake with unverified social labels. No interface is deployed in P0.

## Evolution rules

Add package implementations when a phase needs them; avoid empty module trees. Extract a service only for a demonstrated isolation, scaling or lifecycle requirement. Use additive schema migrations and portable IDs/object manifests; do not change identity when moving stores. Version API/event contracts, maintain readers for historical schema versions, and reconcile derived projections before accepting a migrated writer.
