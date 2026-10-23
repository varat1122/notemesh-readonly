"""Draft paragraph queue and source readback, with no semantic/fact verification."""

import hashlib
from datetime import UTC, datetime

from investment_os.domain.canonical import canonical_sha256, canonical_text
from investment_os.domain.entities import Document, Source
from investment_os.ingestion.extraction import authorize
from investment_os.ingestion.plain_text import decode_text, line_at, paragraph_spans
from investment_os.ports.text_review import (
    ALGORITHM,
    TextReviewItem,
    TextReviewPacket,
    review_item_id,
)
from investment_os.storage.local_objects import ObjectIntegrityError


def build_packet(document: Document, source: Source, content: bytes):
    text = decode_text(content)
    if (
        hashlib.sha256(content).hexdigest() != document.content_sha256
        or len(content) != document.byte_size
        or source.original_document_id != document.id
    ):
        raise ObjectIntegrityError("source binding mismatch")
    items = []
    for start, end in paragraph_spans(text):
        excerpt = text[start:end]
        value = dict(
            char_start=start,
            char_end=end,
            line_start=line_at(text, start),
            line_end=line_at(text, end - 1),
            text=excerpt,
            text_sha256=hashlib.sha256(excerpt.encode("utf-8")).hexdigest(),
            contains_number=any(c.isdecimal() for c in excerpt),
            status="needs_human_review",
            untrusted_data=True,
            independent_evidence=False,
        )
        items.append(
            TextReviewItem(
                id=review_item_id(document.id, document.version, document.content_sha256, value),
                **value,
            )
        )
    payload = dict(
        algorithm=ALGORITHM,
        scope="synthetic_local_review_draft",
        document_id=document.id,
        document_version=document.version,
        document_payload_sha256=canonical_sha256(document),
        source_id=source.id,
        source_version=source.version,
        source_payload_sha256=canonical_sha256(source),
        source_sha256=document.content_sha256,
        items=tuple(items),
        status="needs_human_review",
    )
    packet = TextReviewPacket(**payload, output_sha256=canonical_sha256(payload))
    if len(canonical_text(packet).encode("utf-8")) > 500_000:
        raise ValueError("review packet output budget exceeded")
    return packet


class SyntheticTextReviewer:
    def __init__(self, store, registry):
        self.store, self.registry = store, registry

    def _source(self, principal, source_id, source_version, document_version):
        if any(type(v) is not int or v < 1 for v in [source_version, document_version]):
            raise ValueError("explicit positive versions required")
        source = self.registry.get(principal, source_id, source_version)
        if not isinstance(source, Source) or source.provenance.origin != "synthetic":
            raise PermissionError("registered synthetic source required")
        document = self.registry.get(principal, source.original_document_id, document_version)
        if (
            not isinstance(document, Document)
            or document.provenance.origin != "synthetic"
            or document.media_type != "text/plain"
            or document.storage_backend != "local"
            or document.storage_key != "objects/" + document.content_sha256
        ):
            raise PermissionError("registered synthetic plain text required")
        content = self.store.read_verified("objects", document.content_sha256)
        return document, source, content

    def draft(self, principal, source_id, source_version=1, document_version=1):
        authorize(principal, write=True)
        document, source, content = self._source(
            principal, source_id, source_version, document_version
        )
        # Recompute against originals even on replay; cached digests alone are not proof.
        packet = build_packet(document, source, content)
        key = canonical_sha256({"operation": ALGORITHM, "document": document, "source": source})
        with self.store.lock(key):
            cached = self.store.journal(key, "reviewdraft")
            if cached is None:
                cached = self.store.journal(
                    key,
                    "reviewdraft",
                    {
                        "packet": packet,
                        "created_by": principal.actor_id,
                        "created_at": datetime.now(UTC),
                    },
                )
            checked = TextReviewPacket.model_validate(cached["packet"])
            if checked != packet:
                raise ObjectIntegrityError("review draft does not match original")
            return checked

    def verify_item(self, principal, packet: TextReviewPacket, item_id):
        authorize(principal)
        packet = TextReviewPacket.model_validate(packet.model_dump())
        document, source, content = self._source(
            principal, packet.source_id, packet.source_version, packet.document_version
        )
        if packet != build_packet(document, source, content):
            raise ObjectIntegrityError("review packet does not match original")
        for item in packet.items:
            if item.id == item_id:
                return item
        raise KeyError("unknown review item")
