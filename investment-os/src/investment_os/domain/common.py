"""Canonical contracts. No provider SDK, SQL, filesystem or model calls."""

from datetime import datetime
from enum import StrEnum
from typing import Annotated, Literal
from uuid import UUID

from pydantic import AwareDatetime, BaseModel, ConfigDict, Field, model_validator

Text = Annotated[str, Field(min_length=1, max_length=10000)]
Digest = Annotated[str, Field(pattern=r"^[a-f0-9]{64}$")]


class Contract(BaseModel):
    model_config = ConfigDict(extra="forbid", frozen=True, allow_inf_nan=False)


class Classification(StrEnum):
    PUBLIC = "public"
    LICENSED = "licensed_vendor"
    INTERNAL = "internal_research"
    PORTFOLIO = "confidential_portfolio"
    PERSONAL = "personal_sensitive"
    SECRET = "secret"


class Times(Contract):
    # Unknown is null: never derive event/publication/as-of from import time.
    event_at: AwareDatetime | None = None
    published_at: AwareDatetime | None = None
    received_at: AwareDatetime
    imported_at: AwareDatetime
    verified_at: AwareDatetime | None = None
    data_as_of: AwareDatetime | None = None
    effective_from: AwareDatetime | None = None
    effective_to: AwareDatetime | None = None
    calculation_at: AwareDatetime | None = None
    known_at: AwareDatetime | None = None
    available_to_strategy_at: AwareDatetime | None = None
    vintage_at: AwareDatetime | None = None

    @model_validator(mode="after")
    def chronology(self):
        for start, end in [
            (self.received_at, self.imported_at),
            (self.effective_from, self.effective_to),
            (self.received_at, self.verified_at),
            (self.known_at, self.available_to_strategy_at),
        ]:
            if start and end and end < start:
                raise ValueError("invalid timestamp ordering")
        return self


class Provenance(Contract):
    origin: Literal["source", "human", "ai", "deterministic", "system", "synthetic"]
    source_ids: tuple[UUID, ...] = ()
    basis: Text
    actor_id: UUID
    original_origin_id: UUID | None = None
    independent_evidence: bool = False
    license_id: Text = "synthetic-only"
    permitted_uses: tuple[Literal["local_research", "model_input", "redistribute"], ...] = (
        "local_research",
    )

    @model_validator(mode="after")
    def no_ai_promotion(self):
        if self.origin in {"ai", "synthetic", "system"} and self.independent_evidence:
            raise ValueError("AI, synthetic and system artifacts are not independent evidence")
        return self


class Record(Contract):
    id: UUID
    version: Annotated[int, Field(ge=1)] = 1
    schema_version: Literal["1.0"] = "1.0"
    provenance: Provenance
    times: Times
    classification: Classification = Classification.INTERNAL
    verification: Literal["unverified", "verified", "rejected", "superseded", "not_applicable"] = (
        "unverified"
    )
    verified_by: UUID | None = None
    supersedes_id: UUID | None = None

    @model_validator(mode="after")
    def verification_receipt(self):
        if (
            getattr(self, "kind", None) in {"portfolio", "transaction"}
            and self.classification != Classification.PORTFOLIO
        ):
            raise ValueError("portfolio records require confidential_portfolio classification")
        if self.verification == "verified":
            if not self.verified_by or not self.times.verified_at:
                raise ValueError("verified requires reviewer and verified_at")
            if self.provenance.origin in {"ai", "synthetic"}:
                raise ValueError("AI and synthetic records cannot self-promote to verified")
        elif self.verified_by or self.times.verified_at:
            raise ValueError("verification metadata requires verified status")
        if self.supersedes_id == self.id:
            raise ValueError("use version for own revisions, supersedes for another identity")
        return self


def utc_iso(value: datetime) -> str:
    """Serialization boundary: aware UTC, without silently fixing naive dates."""
    from datetime import UTC

    if value.tzinfo is None:
        raise ValueError("timezone required")
    return value.astimezone(UTC).isoformat()
