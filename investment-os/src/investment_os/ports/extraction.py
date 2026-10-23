"""Deterministic source excerpts; byte/text readback never verifies investment truth."""

import hashlib
import re
from typing import Annotated, Literal
from uuid import NAMESPACE_URL, UUID, uuid5

from pydantic import Field, model_validator

from investment_os.domain.canonical import canonical_sha256
from investment_os.domain.common import Contract, Digest


class PdfLocator(Contract):
    kind: Literal["pdf"] = "pdf"
    page: int = Field(ge=1, le=100)
    char_start: int = Field(ge=0)
    char_end: int = Field(gt=0)


class CsvLocator(Contract):
    kind: Literal["csv"] = "csv"
    record: int = Field(ge=1, le=10000)
    column: int = Field(ge=1, le=100)
    line_start: int = Field(ge=1)
    line_end: int = Field(ge=1)

    @model_validator(mode="after")
    def order(self):
        if self.line_end < self.line_start:
            raise ValueError("invalid physical line range")
        return self


class XlsxLocator(Contract):
    kind: Literal["xlsx"] = "xlsx"
    sheet: str = Field(min_length=1, max_length=128)
    cell: str = Field(pattern=r"^[A-Z]{1,2}[1-9][0-9]{0,4}$")
    style_index: int = Field(ge=0, default=0)

    @model_validator(mode="after")
    def cell_bounds(self):
        letters, row = re.fullmatch(r"([A-Z]+)([0-9]+)", self.cell).groups()
        column = 0
        for letter in letters:
            column = column * 26 + ord(letter) - ord("A") + 1
        if column > 100 or int(row) > 10000:
            raise ValueError("cell outside supported worksheet bounds")
        return self


Locator = Annotated[PdfLocator | CsvLocator | XlsxLocator, Field(discriminator="kind")]


class ParserProfile(Contract):
    algorithm: Literal["synthetic-excerpts-v1"] = "synthetic-excerpts-v1"
    admission_policy: Literal["synthetic-static-files-v1"] = "synthetic-static-files-v1"
    python_version: str = Field(min_length=1, max_length=50)
    pypdf_version: str = Field(min_length=1, max_length=50)
    openpyxl_version: str = Field(min_length=1, max_length=50)
    defusedxml_version: str = Field(min_length=1, max_length=50)


class ExtractedValue(Contract):
    locator: Locator
    text: str = Field(min_length=1, max_length=10000)
    value_type: Literal["text", "number", "boolean", "date_lexical", "error"] = "text"
    text_sha256: Digest
    untrusted_data: Literal[True] = True
    independent_evidence: Literal[False] = False

    @model_validator(mode="after")
    def text_integrity(self):
        if hashlib.sha256(self.text.encode("utf-8")).hexdigest() != self.text_sha256:
            raise ValueError("excerpt text digest mismatch")
        if isinstance(
            self.locator, PdfLocator
        ) and self.locator.char_end - self.locator.char_start != len(self.text):
            raise ValueError("PDF character range does not match text")
        if not isinstance(self.locator, XlsxLocator) and self.value_type != "text":
            raise ValueError("only XLSX encodes cell value types")
        return self


class SourceExcerpt(ExtractedValue):
    id: UUID


def excerpt_id(document_id, document_version, profile, value):
    identity = canonical_sha256(
        {
            "document_id": document_id,
            "version": document_version,
            "profile": profile,
            "value": value,
        }
    )
    return uuid5(NAMESPACE_URL, "investment-os/excerpt/" + identity)


class ExtractionArtifact(Contract):
    document_id: UUID
    document_version: int = Field(ge=1)
    document_payload_sha256: Digest
    source_sha256: Digest
    media_type: Literal[
        "application/pdf",
        "text/csv",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ]
    profile: ParserProfile
    excerpts: tuple[SourceExcerpt, ...] = Field(max_length=2000)
    pages_without_text: tuple[int, ...] = ()
    warnings: tuple[str, ...] = Field(max_length=10)
    status: Literal["text_extracted", "no_text"]
    output_sha256: Digest

    @model_validator(mode="after")
    def artifact_integrity(self):
        if canonical_sha256(self.model_dump(exclude={"output_sha256"})) != self.output_sha256:
            raise ValueError("extraction output digest mismatch")
        if (self.status == "text_extracted") != bool(self.excerpts):
            raise ValueError("text status does not match excerpts")
        if sum(len(e.text) for e in self.excerpts) > 120000:
            raise ValueError("extraction character budget exceeded")
        if len({e.id for e in self.excerpts}) != len(self.excerpts):
            raise ValueError("duplicate excerpt identity")
        expected_kind = {
            "application/pdf": "pdf",
            "text/csv": "csv",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "xlsx",
        }[self.media_type]
        for e in self.excerpts:
            value = ExtractedValue.model_validate(e.model_dump(exclude={"id"}))
            if (
                e.id != excerpt_id(self.document_id, self.document_version, self.profile, value)
                or e.locator.kind != expected_kind
            ):
                raise ValueError("excerpt identity or source format mismatch")
        if tuple(sorted(set(self.pages_without_text))) != self.pages_without_text or any(
            not 1 <= p <= 100 for p in self.pages_without_text
        ):
            raise ValueError("invalid empty-page coverage")
        if self.pages_without_text and expected_kind != "pdf":
            raise ValueError("page coverage applies only to PDF")
        return self
