"""Provider-neutral boundaries only. P0 does not run orchestration or business engines."""

from decimal import Decimal
from typing import Literal, Protocol
from uuid import UUID

from pydantic import AwareDatetime, Field, model_validator

from investment_os.domain.common import Contract, Digest, Text
from investment_os.domain.entities import (
    Decision,
    Event,
    MarketDataReference,
    QuantRun,
    Receipt,
    Relationship,
    Source,
    TradeSetup,
)


class IntakeRequest(Contract):
    document_id: UUID
    content_sha256: Digest
    idempotency_key: Text
    channel: Literal["manual", "drive", "official_api"]
    received_at: AwareDatetime
    license_id: Text


class IntakeResult(Contract):
    source: Source
    event: Event | None = None
    status: Literal["quarantined", "duplicate_review", "ready_for_evidence_review"]


class RetrievalRequest(Contract):
    entity_ids: tuple[UUID, ...] = Field(min_length=1)
    question: Text
    as_of: AwareDatetime
    mandate_id: UUID
    max_characters: int = Field(ge=1000, le=100000)


class ContextItem(Contract):
    entity_id: UUID
    source_id: UUID | None = None
    excerpt: Text
    content_sha256: Digest
    untrusted_data: Literal[True] = True
    archived_ai: bool = False
    independent_evidence: bool = False
    available_at: AwareDatetime
    truncated: bool = False

    @model_validator(mode="after")
    def preserve_ai_origin(self):
        if self.archived_ai and self.independent_evidence:
            raise ValueError("archived AI is not independent evidence")
        return self


class ContextPack(Contract):
    request_id: UUID
    as_of: AwareDatetime
    items: tuple[ContextItem, ...]
    missing_evidence: tuple[str, ...]
    additional_read_ids: tuple[UUID, ...] = ()

    @model_validator(mode="after")
    def no_future_information(self):
        if any(i.available_at > self.as_of for i in self.items):
            raise ValueError("future information in point-in-time context")
        return self


class SpecialistResult(Contract):
    id: UUID
    question: Text
    lens: Literal[
        "fundamental",
        "industry",
        "supply_chain",
        "macro",
        "scientific",
        "quant",
        "tactical",
        "risk",
        "counter_thesis",
    ]
    findings: tuple[str, ...]
    claims_with_source_ids: dict[str, tuple[UUID, ...]]
    mechanism: Text
    estimates_if_available: dict[str, Decimal | None]
    counter_evidence: tuple[str, ...]
    uncertainties: tuple[str, ...]
    required_evidence: tuple[str, ...]
    confidence_basis: Text
    as_of: AwareDatetime
    horizon: Text
    proposed_thesis_impact: Text
    should_abstain: bool
    independent_evidence: Literal[False] = False


class ResearchRequest(Contract):
    context: ContextPack
    lenses: tuple[str, ...] = Field(min_length=1)
    mandate_id: UUID
    max_output_tokens: int = Field(gt=0, le=100000)
    paid_calls_allowed: Literal[False] = False


class ResearchResult(Contract):
    specialist_results: tuple[SpecialistResult, ...]
    disagreements: tuple[str, ...]
    missing_evidence: tuple[str, ...]
    draft_only: Literal[True] = True


class GraphProposal(Contract):
    relationships: tuple[Relationship, ...]
    reviewer_required: Literal[True] = True


class WritebackPlan(Contract):
    operation_id: UUID
    idempotency_key: Text
    entity_id: UUID
    note_path: Text
    expected_version: int = Field(ge=1)
    before_sha256: Digest
    proposed_sha256: Digest
    approval_receipt_id: UUID
    action: Literal["research_draft", "timeline_append"]


class MarketRequest(Contract):
    instrument_ids: tuple[UUID, ...] = Field(min_length=1)
    start: AwareDatetime
    end: AwareDatetime
    as_of: AwareDatetime
    frequency: Literal["daily"] = "daily"

    @model_validator(mode="after")
    def interval(self):
        if self.start > self.end or self.end > self.as_of:
            raise ValueError("invalid market request interval")
        return self


class MarketBar(Contract):
    instrument_id: UUID
    session_at: AwareDatetime
    open: Decimal
    high: Decimal
    low: Decimal
    close: Decimal
    volume: Decimal = Field(ge=0)
    dataset_id: UUID
    currency: str = Field(pattern=r"^[A-Z]{3}$")
    available_at: AwareDatetime

    @model_validator(mode="after")
    def consistent_bar(self):
        if not (self.low <= min(self.open, self.close) <= max(self.open, self.close) <= self.high):
            raise ValueError("OHLC range invalid")
        if self.available_at < self.session_at:
            raise ValueError("bar unavailable before session")
        return self


class QuantRequest(Contract):
    dataset_ids: tuple[UUID, ...] = Field(min_length=1)
    strategy: Text
    code_version: Text
    parameters: dict[str, str | int | float | bool | None]
    as_of: AwareDatetime


class TradingRequest(Contract):
    mandate_id: UUID
    research_review_ids: tuple[UUID, ...]
    signal_ids: tuple[UUID, ...]
    market_data_id: UUID
    as_of: AwareDatetime


class PortfolioRequest(Contract):
    portfolio_id: UUID
    as_of: AwareDatetime
    mandate_ids: tuple[UUID, ...]


class PortfolioResult(Contract):
    portfolio_id: UUID
    as_of: AwareDatetime
    exposure_artifact: Text | None
    reconciliation_gaps: tuple[str, ...]
    recommendation_only: Literal[True] = True


class DecisionRequest(Contract):
    research_ids: tuple[UUID, ...] = Field(min_length=1)
    mandate_id: UUID
    quant_run_ids: tuple[UUID, ...]
    trade_setup_ids: tuple[UUID, ...]
    independent_risk_review_id: UUID
    constraints: tuple[str, ...] = Field(min_length=1)


class SourceIntake(Protocol):
    def intake(self, request: IntakeRequest) -> IntakeResult: ...


class HistoricalRetrieval(Protocol):
    def retrieve(self, request: RetrievalRequest) -> ContextPack: ...


class ResearchOrchestrator(Protocol):
    def research(self, request: ResearchRequest) -> ResearchResult: ...


class ModelAdapter(Protocol):
    def reason(self, request: ResearchRequest) -> SpecialistResult: ...


class EvidenceGraph(Protocol):
    def propose(self, request: GraphProposal) -> GraphProposal: ...


class KnowledgeWriteback(Protocol):
    def apply(self, request: WritebackPlan) -> Receipt: ...


class MarketDataAdapter(Protocol):
    def fetch(self, request: MarketRequest) -> tuple[MarketDataReference, ...]: ...


class QuantEngine(Protocol):
    def compute(self, request: QuantRequest) -> QuantRun: ...


class TradingStrategyEngine(Protocol):
    def propose(self, request: TradingRequest) -> tuple[TradeSetup, ...]: ...


class PortfolioEngine(Protocol):
    def evaluate(self, request: PortfolioRequest) -> PortfolioResult: ...


class InvestmentDecisionEngine(Protocol):
    def propose(self, request: DecisionRequest) -> Decision: ...
