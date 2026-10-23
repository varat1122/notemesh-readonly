# API and module contracts

## Implemented HTTP surface

| Endpoint | Auth | Result | Side effects |
|---|---|---|---|
| GET /health/live | none | process live, P0/synthetic marker | none |
| GET /health/ready | none | DB reachable and schema revision; otherwise 503 | SELECT only |
| POST /v1/contracts/validate | explicit dummy bearer | valid kind/id; `persisted=false` | none |
| POST /v1/policy/evaluate | explicit dummy bearer | future capability evaluation; executed/approval false | none |
| GET /docs, /openapi.json | none, loopback | development API specification | none |

All business write endpoints are absent (404). Wrong/missing credentials → 401; denied action/path → 403; invalid contract → 422 without submitted values; DB readiness failure → 503 without credentials or exception text. Request ID generated server-side. Logs contain method, matched route template, status and request ID only. Production authentication is not implemented; the public dummy tokens must never be exposed beyond an isolated developer machine.

## Internal interfaces

`src/investment_os/ports/contracts.py` defines typed Protocols and strict DTOs. Domain JSON schemas are generated, versioned and drift-tested. These are internal Python interfaces; no remote HTTP service or extra microservice is implied.

| Interface | Input → output | Required P1+ behavior |
|---|---|---|
| SourceIntake | IntakeRequest → IntakeResult | scoped capture, hash/readback, quarantine, rights, actor-key idempotency |
| HistoricalRetrieval | RetrievalRequest → ContextPack | IDs/as-of/rights, contrary evidence, no future facts; report truncation |
| ResearchOrchestrator | ResearchRequest → ResearchResult | framework routing, disagreements, abstention, no implicit writes |
| ModelAdapter | ResearchRequest → SpecialistResult | provider-specific translation; egress, license, cost approval before call |
| Specialist results | findings/claims/sources/mechanism/estimates/counter-evidence/unknowns | missing values null, confidence basis not fake probabilities |
| EvidenceGraph | GraphProposal → GraphProposal | economic semantics and typed provenance; human review where required |
| KnowledgeWriteback | WritebackPlan → Receipt | scoped approval, idempotency, CAS, journal, physical/index/link readback |
| MarketDataAdapter | MarketRequest → MarketDataReference[] | provider-neutral instrument mapping, rights, adjustment and as-of |
| QuantEngine | QuantRequest → QuantRun | deterministic versioned computation, no future data, cost/bias controls |
| TradingStrategyEngine | TradingRequest → TradeSetup[] | mandate-specific horizon/risk/expiry, never order execution |
| PortfolioEngine | PortfolioRequest → PortfolioResult | reconcile source transactions, aggregate mandates, show gaps |
| InvestmentDecisionEngine | DecisionRequest → Decision | independent risk gate, constraints, dissent, no implicit broker authority |

Ports implement no business code in P0. No fake success stubs or fabricated provider results. Future adapters raise typed errors: `unsupported`, `permission_denied`, `license_denied`, `stale_data`, `ambiguous_identity`, `version_conflict`, `budget_denied`, `retryable_provider_error`, `partial_persistence`. A retry must preserve actor/key/payload hash and cannot repeat a partially completed write without recovery review.

## Contract evolution

Synthetic P1 local harnesses additionally implement capture, extraction and paragraph review without HTTP write routes. `SyntheticCaptureRequest` accepts `.pdf`, `.csv`, `.xlsx`, `.txt`; authority is still dummy/synthetic-only. `TextReviewPacket` / `TextReviewItem` (ports/text_review.py) bind immutable original references and require human review. `SyntheticTextReviewer.draft` creates a local derived checkpoint; `verify_item` reopens registered originals and compares the complete packet. Neither method creates verified Claim/Evidence records. See ADR 014 for bounds and offset conventions.

Version DTO semantics before breaking changes. Historical entity payloads retain their schema version and validated migration path. Distinguish unknown/null, false and zero. Do not normalize a missing market price to zero. Ports accept UUIDs instead of provider tickers or database-specific row IDs. Original bytes and provenance survive adapter swaps. Client-supplied roles, approvals or source instructions are never trusted policy inputs.
