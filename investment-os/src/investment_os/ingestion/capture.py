"""Resumable filesystem/registry saga for synthetic originals, never a verified receipt."""

import hashlib
from datetime import UTC, datetime
from uuid import NAMESPACE_URL, uuid5

from investment_os.domain.canonical import canonical_sha256
from investment_os.domain.common import Provenance, Times
from investment_os.domain.entities import Document, Source
from investment_os.ingestion.validation import (
    MAX_BYTES,
    MEDIA_TYPES,
    POLICY_VERSION,
    validate_bytes,
)
from investment_os.policy.access import DUMMY_PRINCIPALS, Principal, Role
from investment_os.ports.contracts import SyntheticCaptureRequest, SyntheticCaptureResult
from investment_os.storage.local_objects import ObjectIntegrityError, SyntheticObjectStore
from investment_os.storage.registry import IdempotencyConflict, SyntheticRegistry


class PartialCaptureError(RuntimeError):
    """Journal/originals are preserved. Retry the exact request; do not invent success."""


class SyntheticCapture:
    def __init__(self, store: SyntheticObjectStore, registry: SyntheticRegistry):
        self.store, self.registry = store, registry

    def capture(self, principal: Principal, request: SyntheticCaptureRequest, content: bytes):
        if principal not in DUMMY_PRINCIPALS.values() or principal.role not in {
            Role.RESEARCHER,
            Role.OWNER,
        }:
            raise PermissionError("synthetic capture principal required")
        request = SyntheticCaptureRequest.model_validate(request.model_dump(mode="python"))
        if type(content) is not bytes or not 0 < len(content) <= MAX_BYTES:
            raise ValueError("nonempty bytes within intake size limit required")
        if request.received_at > datetime.now(UTC):
            raise ValueError("received timestamp cannot be in the future")
        digest = hashlib.sha256(content).hexdigest()
        key = canonical_sha256({"actor": principal.actor_id, "key": request.idempotency_key})
        fingerprint = canonical_sha256(
            {"actor": principal.actor_id, "request": request, "sha256": digest}
        )
        with self.store.lock(key):
            prepared = self.store.journal(key, "prepared")
            if prepared is None:
                prepared = self.store.journal(
                    key,
                    "prepared",
                    {
                        "request_sha256": fingerprint,
                        "content_sha256": digest,
                        "byte_size": len(content),
                        "request": request,
                        "actor_id": principal.actor_id,
                        "imported_at": datetime.now(UTC),
                        "document_id": uuid5(
                            NAMESPACE_URL, "investment-os/capture/document/" + key
                        ),
                        "source_id": uuid5(NAMESPACE_URL, "investment-os/capture/source/" + key),
                        "policy": POLICY_VERSION,
                    },
                )
            if prepared["request_sha256"] != fingerprint:
                raise IdempotencyConflict("capture key already bound to a different request")
            if prepared["policy"] != POLICY_VERSION:
                raise ObjectIntegrityError(
                    "capture policy changed; explicit reconciliation required"
                )
            done = self.store.journal(key, "committed")
            if done:
                self._verify(principal, prepared)
                result = SyntheticCaptureResult.model_validate(done)
                if (
                    result.content_sha256 != digest
                    or str(result.document_id) != prepared["document_id"]
                    or str(result.source_id) != prepared["source_id"]
                ):
                    raise ObjectIntegrityError("capture receipt identity mismatch")
                return result.model_copy(update={"replayed": True})
            rejected = self.store.journal(key, "rejected")
            if rejected:
                self.store.read_verified("quarantine", digest)
                return SyntheticCaptureResult(
                    status="quarantined",
                    content_sha256=digest,
                    reason=rejected["reason"],
                    replayed=True,
                )
            # Admission size/authority checks happen before any disk write; staged bytes never execute.
            self.store.write_once("quarantine", digest, content)
            if self.store.read_verified("quarantine", digest) != content:
                raise ObjectIntegrityError("quarantine readback mismatch")
            inspected = self.store.journal(key, "validated")
            if inspected is None:
                inspection = validate_bytes(content, request.filename.rsplit(".", 1)[1])
                if not inspection["accepted"]:
                    self.store.journal(key, "rejected", inspection)
                    return SyntheticCaptureResult(
                        status="quarantined", content_sha256=digest, reason=inspection["reason"]
                    )
                inspected = self.store.journal(key, "validated", inspection)
            if inspected["policy"] != POLICY_VERSION or inspected["accepted"] is not True:
                raise ObjectIntegrityError("invalid validation checkpoint")
            try:
                self.store.promote(digest)
                document, source = self._records(prepared)
                self.registry.put(
                    principal,
                    document,
                    expected_version=0,
                    idempotency_key="capture-document-" + key,
                )
                self.registry.put(
                    principal, source, expected_version=0, idempotency_key="capture-source-" + key
                )
                self._verify(principal, prepared)
                result = SyntheticCaptureResult(
                    status="captured",
                    content_sha256=digest,
                    document_id=document.id,
                    source_id=source.id,
                    original_bytes_verified=True,
                )
                self.store.journal(key, "committed", result)
                return result
            except Exception as exc:
                raise PartialCaptureError(
                    "capture is partial; original and journal retained; retry identical request"
                ) from exc

    def _records(self, prepared):
        request = SyntheticCaptureRequest.model_validate(prepared["request"])
        common = dict(
            provenance=Provenance(
                origin="synthetic",
                basis="Explicit synthetic local capture; unverified fixture",
                actor_id=prepared["actor_id"],
            ),
            times=Times(received_at=request.received_at, imported_at=prepared["imported_at"]),
            classification=request.classification,
        )
        document = Document(
            id=prepared["document_id"],
            content_sha256=prepared["content_sha256"],
            byte_size=prepared["byte_size"],
            media_type=MEDIA_TYPES[request.filename.rsplit(".", 1)[1]],
            storage_key="objects/" + prepared["content_sha256"],
            storage_backend="local",
            **common,
        )
        source = Source(
            id=prepared["source_id"],
            publisher=request.publisher,
            channel="manual",
            source_type="user_supplied",
            original_document_id=document.id,
            **common,
        )
        return document, source

    def _verify(self, principal, prepared):
        data = self.store.read_verified("objects", prepared["content_sha256"])
        if len(data) != prepared["byte_size"]:
            raise ObjectIntegrityError("original size mismatch")
        for expected in self._records(prepared):
            actual = self.registry.get(principal, expected.id, 1)
            if canonical_sha256(actual) != canonical_sha256(expected):
                raise ObjectIntegrityError("capture registry readback mismatch")
