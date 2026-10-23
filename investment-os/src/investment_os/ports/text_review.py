"""Unverified paragraph review queue. These are not canonical Claim/Evidence records."""

import hashlib
from typing import Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import Field, model_validator

from investment_os.domain.canonical import canonical_sha256
from investment_os.domain.common import Contract, Digest

ALGORITHM = "synthetic-paragraph-review-v1"


class TextReviewItem(Contract):
    id: UUID
    char_start: int = Field(ge=0)
    char_end: int = Field(gt=0)
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)
    text: str = Field(min_length=1, max_length=10000)
    text_sha256: Digest
    contains_number: bool
    status: Literal["needs_human_review"] = "needs_human_review"
    untrusted_data: Literal[True] = True
    independent_evidence: Literal[False] = False

    @model_validator(mode="after")
    def integrity(self):
        if (
            self.char_end - self.char_start != len(self.text)
            or self.line_end < self.line_start
            or hashlib.sha256(self.text.encode("utf-8")).hexdigest() != self.text_sha256
            or self.contains_number != any(c.isdecimal() for c in self.text)
        ):
            raise ValueError("review item integrity mismatch")
        return self


def review_item_id(document_id, document_version, source_sha256, value):
    digest = canonical_sha256(
        {
            "algorithm": ALGORITHM,
            "document_id": document_id,
            "document_version": document_version,
            "source_sha256": source_sha256,
            "item": value,
        }
    )
    return uuid5(NAMESPACE_URL, "investment-os/text-review/" + digest)


class TextReviewPacket(Contract):
    algorithm: Literal["synthetic-paragraph-review-v1"] = ALGORITHM
    scope: Literal["synthetic_local_review_draft"] = "synthetic_local_review_draft"
    document_id: UUID
    document_version: int = Field(ge=1)
    document_payload_sha256: Digest
    source_id: UUID
    source_version: int = Field(ge=1)
    source_payload_sha256: Digest
    source_sha256: Digest
    items: tuple[TextReviewItem, ...] = Field(min_length=1, max_length=200)
    status: Literal["needs_human_review"] = "needs_human_review"
    output_sha256: Digest

    @model_validator(mode="after")
    def integrity(self):
        if canonical_sha256(self.model_dump(exclude={"output_sha256"})) != self.output_sha256:
            raise ValueError("review packet digest mismatch")
        previous_end = 0
        for item in self.items:
            expected = review_item_id(
                self.document_id,
                self.document_version,
                self.source_sha256,
                item.model_dump(exclude={"id"}),
            )
            if item.id != expected or item.char_start < previous_end:
                raise ValueError("review item identity or ordering mismatch")
            previous_end = item.char_end
        return self
