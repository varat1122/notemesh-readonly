"""P0 capability check; never accepts roles or approval flags from source text."""

from enum import StrEnum
from pathlib import PurePosixPath
from typing import Literal
from uuid import UUID

from investment_os.domain.common import Contract


class Role(StrEnum):
    READER = "reader"
    RESEARCHER = "researcher"
    CURATOR = "curator"
    PORTFOLIO_ANALYST = "portfolio_analyst"
    RISK_REVIEWER = "risk_reviewer"
    OWNER = "owner_admin"
    WORKER = "service_worker"


class Action(StrEnum):
    READ = "read"
    DRAFT = "research_draft"
    EVIDENCE = "evidence_review"
    THESIS = "thesis_approve"
    PORTFOLIO = "portfolio_write"
    TRADE = "trade_execute"
    PAID = "paid_inference"


class Principal(Contract):
    actor_id: UUID
    role: Role
    actor_type: Literal["human", "ai", "service"]


class PermissionRequest(Contract):
    action: Action
    resource_path: str


DUMMY_PRINCIPALS = {
    "dummy-reader": Principal(actor_id=UUID(int=1), role=Role.READER, actor_type="human"),
    "dummy-researcher": Principal(actor_id=UUID(int=2), role=Role.RESEARCHER, actor_type="ai"),
    "dummy-owner": Principal(actor_id=UUID(int=3), role=Role.OWNER, actor_type="human"),
}


def safe_relative_path(value: str) -> PurePosixPath:
    p = PurePosixPath(value)
    if (
        not value
        or p.is_absolute()
        or "\\" in value
        or "\x00" in value
        or ":" in value
        or any(s in {"", ".", ".."} for s in value.split("/"))
    ):
        raise PermissionError("invalid scoped path")
    return p


def authorize(principal: Principal, request: PermissionRequest) -> None:
    path = safe_relative_path(request.resource_path)
    # Only public synthetic Notes and Drafts are readable, never protected roots.
    if path.parts[0] not in {"Notes", "Drafts"} or path.suffix != ".md":
        raise PermissionError("resource outside synthetic scope")
    if request.action == Action.READ:
        return
    if (
        request.action == Action.DRAFT
        and path.parts[0] == "Drafts"
        and principal.role in {Role.RESEARCHER, Role.OWNER}
    ):
        return  # capability evaluation only; P0 exposes no write operation
    raise PermissionError("action disabled in P0")
