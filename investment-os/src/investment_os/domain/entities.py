"""Logical schemas for P1–P9; defining a schema does not implement its business engine."""

from decimal import Decimal
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, Field, RootModel, model_validator

from .common import Contract, Digest, Record, Text

Positive = Annotated[Decimal, Field(gt=0)]
Nonnegative = Annotated[Decimal, Field(ge=0)]
Currency = Annotated[str, Field(pattern=r"^[A-Z]{3}$")]


class SymbolAlias(Contract):
    symbol: Text
    venue: Text
    currency: Currency
    valid_from: AwareDatetime
    valid_to: AwareDatetime | None = None

    @model_validator(mode="after")
    def validity(self):
        if self.valid_to and self.valid_to <= self.valid_from:
            raise ValueError("symbol interval must be positive")
        return self


class Instrument(Record):
    kind: Literal["instrument"] = "instrument"
    issuer_id: UUID
    asset_type: Literal["equity", "bond", "fund", "fx", "commodity", "derivative"]
    share_class: Text
    aliases: Annotated[tuple[SymbolAlias, ...], Field(min_length=1)]
    external_ids: dict[str, str] = Field(default_factory=dict)


class Company(Record):
    kind: Literal["company"] = "company"
    legal_name: Text
    jurisdiction: Text
    industry_ids: tuple[UUID, ...] = ()


class Industry(Record):
    kind: Literal["industry"] = "industry"
    name: Text
    taxonomy_version: Text
    parent_id: UUID | None = None


class Technology(Record):
    kind: Literal["technology"] = "technology"
    name: Text
    maturity: Literal["research", "prototype", "commercial", "unknown"] = "unknown"


class Source(Record):
    kind: Literal["source"] = "source"
    publisher: Text
    channel: Literal["manual", "drive", "official_api", "market_api", "social"]
    source_type: Literal["primary", "commentary", "secondary", "user_supplied", "social"]
    original_document_id: UUID
    original_source_id: UUID | None = None
    url: Annotated[str, Field(pattern=r"^https://", max_length=2000)] | None = None


class Document(Record):
    kind: Literal["document"] = "document"
    content_sha256: Digest
    byte_size: Annotated[int, Field(gt=0)]
    media_type: Text
    storage_key: Annotated[str, Field(pattern=r"^[a-z0-9][a-z0-9/_.-]{0,500}$")]
    storage_backend: Literal["local", "drive", "object"]


class Event(Record):
    kind: Literal["event"] = "event"
    company_id: UUID
    source_ids: Annotated[tuple[UUID, ...], Field(min_length=1)]
    event_type: Text
    period: Text
    classification_result: Literal[
        "new_event",
        "duplicate",
        "added_detail",
        "correction",
        "contradiction",
        "confirmation",
        "unresolved",
        "thesis_changing_candidate",
    ] = "unresolved"
    related_event_id: UUID | None = None


class Claim(Record):
    kind: Literal["claim"] = "claim"
    subject_id: UUID
    event_id: UUID
    statement: Text
    claim_type: Literal["fact_claim", "quote", "forecast", "opinion", "ai_hypothesis"]
    metric: Text | None = None
    period: Text | None = None
    value: Decimal | None = None
    unit: Text | None = None

    @model_validator(mode="after")
    def units_and_origin(self):
        if self.value is not None and (not self.unit or not self.period):
            raise ValueError("numeric claims require unit and period")
        if self.claim_type == "ai_hypothesis" and self.verification == "verified":
            raise ValueError("hypothesis is not a verified fact")
        return self


class Evidence(Record):
    kind: Literal["evidence"] = "evidence"
    claim_id: UUID
    source_id: UUID
    document_id: UUID
    document_sha256: Digest
    locator: Text  # page, table/cell, byte range, or exact text anchor
    excerpt: Text
    relation: Literal["supports", "contradicts", "context"]


class Relationship(Record):
    kind: Literal["relationship"] = "relationship"
    subject_id: UUID
    object_id: UUID
    predicate: Literal[
        "issuer_of",
        "source_supports_claim",
        "source_contradicts_claim",
        "claim_updates_thesis",
        "company_operates_in_industry",
        "company_offers_product",
        "product_competes_with",
        "supplier_to",
        "customer_of",
        "partner_of",
        "potential_beneficiary_of",
        "potential_risk_from",
        "technology_enables",
        "technology_substitutes",
        "industry_exposed_to_macro",
        "review_related_to",
        "quant_signal_applies_to",
        "trade_setup_for",
        "decision_references_thesis",
    ]
    evidence_ids: tuple[UUID, ...] = ()
    mechanism: Text
    strength: Literal["possible", "attributed", "supported"] = "possible"
    link_policy: Literal["proposed_only", "approved"] = "proposed_only"
    review_by: AwareDatetime | None = None

    @model_validator(mode="after")
    def backed_edge(self):
        if self.subject_id == self.object_id:
            raise ValueError("self edge requires separate future schema")
        if self.verification == "verified" and not self.evidence_ids:
            raise ValueError("verified edge requires evidence")
        if self.predicate.startswith("potential_") and self.verification == "verified":
            raise ValueError("potential relationship remains hypothesis")
        return self


class Note(Record):
    kind: Literal["note"] = "note"
    canonical_path: Text
    note_type: Literal["company", "industry", "review", "thesis", "timeline", "decision"]
    content_sha256: Digest
    entity_ids: tuple[UUID, ...]
    previous_paths: tuple[str, ...] = ()


class ResearchReview(Record):
    kind: Literal["research_review"] = "research_review"
    event_id: UUID
    note_id: UUID
    source_ids: Annotated[tuple[UUID, ...], Field(min_length=1)]
    claim_ids: tuple[UUID, ...] = ()
    thesis_id: UUID | None = None
    analyst_lens: Text
    conclusion: Text
    counter_evidence_ids: tuple[UUID, ...] = ()
    uncertainties: tuple[str, ...]
    analysis_origin: Literal["ai", "human"]
    independent_evidence: Literal[False] = False


class ThesisVersion(Record):
    kind: Literal["thesis_version"] = "thesis_version"
    company_id: UUID
    mandate_id: UUID
    note_id: UUID
    scenarios: dict[Literal["bull", "base", "bear"], str]
    assumptions: Annotated[tuple[str, ...], Field(min_length=1)]
    invalidation: Text
    approval_receipt_id: UUID | None = None
    status: Literal["proposed", "approved", "superseded"] = "proposed"

    @model_validator(mode="after")
    def protected(self):
        if set(self.scenarios) != {"bull", "base", "bear"}:
            raise ValueError("all scenarios required, unknown inputs must be explicit")
        if self.status == "approved" and not self.approval_receipt_id:
            raise ValueError("approved thesis requires a separate approval receipt")
        return self


class MarketDataReference(Record):
    kind: Literal["market_data_reference"] = "market_data_reference"
    instrument_id: UUID
    provider: Text
    dataset_sha256: Digest
    artifact_key: Text
    adjustment: Literal["raw", "split", "total_return", "unknown"]
    currency: Currency
    session_timezone: Text
    corporate_action_source_ids: tuple[UUID, ...] = ()
    coverage_start: AwareDatetime
    coverage_end: AwareDatetime

    @model_validator(mode="after")
    def point_in_time(self):
        if not self.times.data_as_of or not self.times.available_to_strategy_at:
            raise ValueError("market data requires as-of and strategy availability")
        if self.coverage_end < self.coverage_start:
            raise ValueError("invalid coverage")
        return self


class QuantRun(Record):
    kind: Literal["quant_run"] = "quant_run"
    dataset_ids: Annotated[tuple[UUID, ...], Field(min_length=1)]
    code_version: Text
    environment_sha256: Digest
    model_version: Text
    parameters: dict[str, str | int | float | bool | None]
    result_artifact: Text | None = None
    verification_result: Literal["not_computed", "computed", "reproduced"] = "not_computed"
    limitations: tuple[str, ...]
    transaction_cost_assumptions: Text
    bias_controls: tuple[str, ...]

    @model_validator(mode="after")
    def real_result(self):
        if self.verification_result != "not_computed" and (
            not self.result_artifact or not self.times.calculation_at
        ):
            raise ValueError("computed result requires artifact and calculation timestamp")
        return self


class Signal(Record):
    kind: Literal["signal"] = "signal"
    instrument_id: UUID
    run_id: UUID
    horizon: Text
    generated_at: AwareDatetime
    expires_at: AwareDatetime
    status: Literal["proposed", "active", "expired", "invalidated"] = "proposed"

    @model_validator(mode="after")
    def expiry(self):
        if self.expires_at <= self.generated_at:
            raise ValueError("signal expiry must follow generation")
        return self


class Mandate(Record):
    kind: Literal["mandate"] = "mandate"
    name: Text
    mandate_type: Literal["core", "tactical", "event_driven", "macro", "systematic", "hedge"]
    horizon: Text
    risk_budget: Nonnegative
    currency: Currency
    constraints: Annotated[tuple[str, ...], Field(min_length=1)]


class TradeSetup(Record):
    kind: Literal["trade_setup"] = "trade_setup"
    mandate_id: UUID
    instrument_id: UUID
    thesis_id: UUID | None = None
    signal_id: UUID | None = None
    market_data_id: UUID
    entry_conditions: Text
    invalidation: Text
    stop_policy: Text
    take_profit_policy: Text
    risk_unit: Positive
    position_limit: Positive
    transaction_cost_assumption: Text
    expected_holding_period: Text
    expires_at: AwareDatetime
    review_status: Literal["draft", "reviewed", "rejected"] = "draft"
    executable_order: Literal[False] = False


class Portfolio(Record):
    kind: Literal["portfolio"] = "portfolio"
    account_reference: Text
    base_currency: Currency
    mandate_ids: tuple[UUID, ...]
    performance_method: Literal["not_configured", "time_weighted", "money_weighted"] = (
        "not_configured"
    )


class Transaction(Record):
    kind: Literal["transaction"] = "transaction"
    portfolio_id: UUID
    instrument_id: UUID | None = None
    transaction_type: Literal["buy", "sell", "deposit", "withdrawal", "dividend", "fee", "split"]
    quantity: Positive
    price: Nonnegative
    fees: Nonnegative
    taxes: Nonnegative
    currency: Currency
    fx_rate: Positive
    settlement_at: AwareDatetime | None = None
    reconciliation: Literal["unreconciled", "reconciled", "disputed"] = "unreconciled"

    @model_validator(mode="after")
    def instrument_for_trades(self):
        if self.transaction_type in {"buy", "sell", "split"} and not self.instrument_id:
            raise ValueError("trade requires instrument")
        if not self.times.event_at:
            raise ValueError("transaction event timestamp required")
        return self


class Decision(Record):
    kind: Literal["decision"] = "decision"
    mandate_id: UUID
    thesis_id: UUID
    thesis_version: Annotated[int, Field(ge=1)]
    research_ids: Annotated[tuple[UUID, ...], Field(min_length=1)]
    risk_review_id: UUID
    constraints: Annotated[tuple[str, ...], Field(min_length=1)]
    action: Literal[
        "BUY_CANDIDATE",
        "ADD_CANDIDATE",
        "HOLD",
        "REDUCE_CANDIDATE",
        "EXIT_CANDIDATE",
        "HEDGE_REVIEW",
        "WATCHLIST",
        "NO_ACTION_INSUFFICIENT_EVIDENCE",
    ]
    rationale: Text
    dissent: tuple[str, ...]
    approval_receipt_id: UUID | None = None
    execution_authorized: Literal[False] = False


class AuditEvent(Record):
    kind: Literal["audit_event"] = "audit_event"
    actor_id: UUID
    action: Text
    resource_id: UUID
    request_id: UUID
    outcome: Literal["allowed", "denied", "failed"]
    payload_sha256: Digest
    # No source text, request bodies or credentials in audit payload.


class Job(Record):
    kind: Literal["job"] = "job"
    job_type: Text
    idempotency_key: Annotated[str, Field(min_length=8, max_length=200)]
    request_sha256: Digest
    actor_id: UUID
    state: Literal[
        "queued", "running", "completed", "failed_retryable", "failed_terminal", "blocked"
    ]
    attempt: Annotated[int, Field(ge=0)] = 0


class Receipt(Record):
    kind: Literal["receipt"] = "receipt"
    job_id: UUID
    resource_id: UUID
    before_sha256: Digest | None = None
    after_sha256: Digest | None = None
    physical_verified: bool = False
    index_verified: bool = False
    links_verified: bool = False
    state: Literal["prepared", "partial", "committed", "blocked", "reconciled"]
    device_sync_verified: Literal[False] = False

    @model_validator(mode="after")
    def no_verbal_success(self):
        if self.state == "committed" and not (
            self.after_sha256
            and self.physical_verified
            and self.index_verified
            and self.links_verified
        ):
            raise ValueError("committed requires physical, index and links verification")
        return self


Entity = Annotated[
    Instrument
    | Company
    | Industry
    | Technology
    | Source
    | Document
    | Event
    | Claim
    | Evidence
    | Relationship
    | Note
    | ResearchReview
    | ThesisVersion
    | MarketDataReference
    | QuantRun
    | Signal
    | Mandate
    | TradeSetup
    | Portfolio
    | Transaction
    | Decision
    | AuditEvent
    | Job
    | Receipt,
    Field(discriminator="kind"),
]


class EntityEnvelope(RootModel[Entity]):
    pass
