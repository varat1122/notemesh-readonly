"""Versioned derived excerpts and fresh-source citation readback for synthetic captures."""

import json
import platform
import subprocess
import sys
from datetime import UTC, datetime
from importlib.metadata import version
from uuid import UUID

from investment_os.domain.canonical import canonical_sha256, canonical_text
from investment_os.domain.entities import Document
from investment_os.ingestion.validation import MAX_BYTES, MEDIA_TYPES
from investment_os.policy.access import DUMMY_PRINCIPALS, Principal, Role
from investment_os.ports.extraction import (
    ExtractedValue,
    ExtractionArtifact,
    ParserProfile,
    SourceExcerpt,
    excerpt_id,
)
from investment_os.storage.local_objects import ObjectIntegrityError, SyntheticObjectStore
from investment_os.storage.registry import SyntheticRegistry

MAX_OUTPUT_BYTES = 750000


class ExtractionError(ValueError):
    pass


def current_profile():
    return ParserProfile(
        python_version=platform.python_version(),
        pypdf_version=version("pypdf"),
        openpyxl_version=version("openpyxl"),
        defusedxml_version=version("defusedxml"),
    )


def extract_values(content: bytes, extension: str):
    if (
        type(content) is not bytes
        or not 0 < len(content) <= MAX_BYTES
        or extension not in MEDIA_TYPES
    ):
        raise ExtractionError("invalid input size or format")
    try:
        result = subprocess.run(
            [sys.executable, "-m", "investment_os.ingestion.extraction_worker", extension],
            input=content,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            timeout=8,
            env={"PATH": "/usr/bin:/bin", "LANG": "C.UTF-8"},
            check=False,
        )
    except subprocess.TimeoutExpired:
        raise ExtractionError("extraction timeout; no artifact committed") from None
    if result.returncode or len(result.stdout) > MAX_OUTPUT_BYTES:
        raise ExtractionError("extraction worker failed; no artifact committed")
    try:
        payload = json.loads(result.stdout)
    except ValueError:
        raise ExtractionError("invalid extraction response") from None
    if payload.get("ok") is not True:
        raise ExtractionError("extraction rejected: " + str(payload.get("reason", "unknown")))
    payload["excerpts"] = tuple(ExtractedValue.model_validate(e) for e in payload["excerpts"])
    return payload


def build_artifact(document: Document, profile: ParserProfile, extracted: dict):
    excerpts = tuple(
        SourceExcerpt(
            id=excerpt_id(document.id, document.version, profile, value), **value.model_dump()
        )
        for value in extracted["excerpts"]
    )
    payload = dict(
        document_id=document.id,
        document_version=document.version,
        document_payload_sha256=canonical_sha256(document),
        source_sha256=document.content_sha256,
        media_type=document.media_type,
        profile=profile,
        excerpts=excerpts,
        pages_without_text=tuple(extracted["pages_without_text"]),
        warnings=tuple(extracted["warnings"]),
        status="text_extracted" if excerpts else "no_text",
    )
    artifact = ExtractionArtifact(**payload, output_sha256=canonical_sha256(payload))
    if len(canonical_text(artifact).encode("utf-8")) > MAX_OUTPUT_BYTES:
        raise ExtractionError("artifact byte budget exceeded; no partial success")
    return artifact


def authorize(principal: Principal, write=False):
    if principal not in DUMMY_PRINCIPALS.values() or (
        write and principal.role not in {Role.RESEARCHER, Role.OWNER}
    ):
        raise PermissionError("synthetic extraction authority required")


class SyntheticExtractor:
    def __init__(self, store: SyntheticObjectStore, registry: SyntheticRegistry):
        self.store, self.registry = store, registry

    def _source(self, principal, document_id, document_version):
        if type(document_version) is not int or document_version < 1:
            raise ExtractionError("explicit positive document version required")
        document = self.registry.get(principal, document_id, document_version)
        if (
            not isinstance(document, Document)
            or document.storage_backend != "local"
            or document.storage_key != "objects/" + document.content_sha256
            or document.media_type not in MEDIA_TYPES.values()
        ):
            raise PermissionError("registered synthetic local original required")
        content = self.store.read_verified("objects", document.content_sha256)
        if len(content) != document.byte_size:
            raise ObjectIntegrityError("registered original size mismatch")
        return document, content

    def extract(self, principal: Principal, document_id: UUID, document_version: int = 1):
        authorize(principal, write=True)
        document, content = self._source(principal, document_id, document_version)
        profile = current_profile()
        key = canonical_sha256(
            {"operation": "extract", "document": canonical_sha256(document), "profile": profile}
        )
        with self.store.lock(key):
            cached = self.store.journal(key, "extracted")
            if cached is not None:
                artifact = ExtractionArtifact.model_validate(cached["artifact"])
                if (
                    artifact.document_payload_sha256 != canonical_sha256(document)
                    or artifact.profile != profile
                    or artifact.source_sha256 != document.content_sha256
                    or artifact.document_id != document.id
                    or artifact.document_version != document.version
                ):
                    raise ObjectIntegrityError("extraction cache binding mismatch")
                return artifact
            extension = next(k for k, v in MEDIA_TYPES.items() if v == document.media_type)
            artifact = build_artifact(document, profile, extract_values(content, extension))
            # Immutable local derived artifact. Original bytes and registry records are untouched.
            stored = self.store.journal(
                key,
                "extracted",
                {
                    "artifact": artifact,
                    "created_by": principal.actor_id,
                    "created_at": datetime.now(UTC),
                },
            )
            return ExtractionArtifact.model_validate(stored["artifact"])

    def verify_excerpt(self, principal: Principal, artifact: ExtractionArtifact, excerpt_id: UUID):
        """Reparse actual original bytes. This proves reproducibility, not claim truth."""
        authorize(principal)
        artifact = ExtractionArtifact.model_validate(artifact.model_dump(mode="python"))
        if artifact.profile != current_profile():
            raise ExtractionError("matching parser environment required for citation readback")
        document, content = self._source(principal, artifact.document_id, artifact.document_version)
        extension = next(k for k, v in MEDIA_TYPES.items() if v == document.media_type)
        fresh = build_artifact(document, current_profile(), extract_values(content, extension))
        if fresh != artifact:
            raise ObjectIntegrityError("citation output does not reproduce from original bytes")
        for excerpt in fresh.excerpts:
            if excerpt.id == excerpt_id:
                return excerpt
        raise ExtractionError("excerpt does not belong to artifact")
