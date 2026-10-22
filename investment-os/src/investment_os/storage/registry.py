"""Transactional synthetic registry, not a production write API or Vault writer."""

from dataclasses import dataclass
from uuid import UUID, uuid4

from sqlalchemy import text
from sqlalchemy.engine import Connection, Engine

from investment_os.domain.canonical import CANONICAL_FORMAT, canonical_sha256, canonical_text
from investment_os.domain.common import Record
from investment_os.domain.entities import EntityEnvelope
from investment_os.domain.references import REFERENCE_RULES, extract_references
from investment_os.policy.access import DUMMY_PRINCIPALS, Principal, Role
from investment_os.storage.database import SCHEMA_REVISION


class RegistryError(ValueError):
    pass


class VersionConflict(RegistryError):
    pass


class IdempotencyConflict(RegistryError):
    pass


class IntegrityFailure(RegistryError):
    pass


@dataclass(frozen=True)
class RegistryResult:
    operation_id: UUID
    entity_id: UUID
    version: int
    payload_sha256: str
    replayed: bool
    scope: str = "synthetic_registry_only"


def _principal(principal: Principal, write: bool = False):
    if principal not in DUMMY_PRINCIPALS.values():
        raise PermissionError("only explicit synthetic principals are allowed")
    if write and principal.role not in {Role.RESEARCHER, Role.OWNER}:
        raise PermissionError("principal cannot write synthetic registry drafts")


def _record_scope(record: Record):
    if (
        record.kind not in REFERENCE_RULES
        or record.provenance.origin != "synthetic"
        or record.provenance.license_id != "synthetic-only"
        or record.provenance.permitted_uses != ("local_research",)
        or record.classification not in {"public", "internal_research"}
        or record.verification != "unverified"
    ):
        raise PermissionError("only unverified synthetic data/evidence drafts are enabled")
    if record.kind == "relationship" and (
        record.link_policy != "proposed_only" or record.strength != "possible"
    ):
        raise PermissionError("relationship promotion is disabled")


def _references_rows(conn: Connection, entity_id: UUID, version: int):
    return [
        dict(field=r.field_name, target=str(r.to_id), version=r.to_version)
        for r in conn.execute(
            text("""SELECT field_name,to_id,to_version FROM entity_references
                WHERE from_id=:id AND from_version=:version ORDER BY field_name,to_id"""),
            {"id": entity_id, "version": version},
        )
    ]


class SyntheticRegistry:
    def __init__(self, engine: Engine):
        self.engine = engine

    def _database(self, conn: Connection):
        if conn.execute(text("SELECT current_database()")).scalar() != "ios_synthetic":
            raise PermissionError("dedicated ios_synthetic database required")
        if (
            conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
            != SCHEMA_REVISION
        ):
            raise IntegrityFailure("migration not ready")

    def _load(self, conn: Connection, entity_id: UUID, version: int | None = None) -> Record:
        row = (
            conn.execute(
                text("""
          SELECT e.kind, v.payload, v.content_sha256, c.payload_sha256, c.references_sha256,
                 c.canonical_format
          FROM entities e JOIN entity_versions v ON e.id=v.entity_id
          JOIN registry_commits c ON c.entity_id=v.entity_id AND c.entity_version=v.version
          WHERE e.id=:id AND v.version=COALESCE(:version,e.current_version)
          """),
                {"id": entity_id, "version": version},
            )
            .mappings()
            .first()
        )
        if not row:
            raise IntegrityFailure("missing or unregistered entity revision")
        record = EntityEnvelope.model_validate(row["payload"]).root
        _record_scope(record)
        digest = canonical_sha256(record)
        if (
            record.id != entity_id
            or record.kind != row["kind"]
            or digest != row["content_sha256"]
            or digest != row["payload_sha256"]
            or row["canonical_format"] != CANONICAL_FORMAT
        ):
            raise IntegrityFailure("stored payload integrity mismatch")
        refs = _references_rows(conn, record.id, record.version)
        expected = {(r.field, str(r.target_id)) for r in extract_references(record)}
        if (
            canonical_sha256(refs) != row["references_sha256"]
            or {(r["field"], r["target"]) for r in refs} != expected
            or any(r["version"] is None for r in refs)
        ):
            raise IntegrityFailure("reference projection integrity mismatch")
        return record

    def get(self, principal: Principal, entity_id: UUID, version: int | None = None) -> Record:
        _principal(principal)
        with self.engine.connect() as conn:
            self._database(conn)
            return self._load(conn, entity_id, version)

    def _resolve(self, conn: Connection, record: Record):
        rows, targets, cache = [], {}, {}
        for ref in extract_references(record):
            if ref.target_id not in cache:
                cache[ref.target_id] = self._load(conn, ref.target_id)
            target = cache[ref.target_id]
            if target.kind not in ref.kinds:
                raise IntegrityFailure("reference target has wrong entity kind")
            if target.classification == "internal_research" and record.classification == "public":
                raise PermissionError("derived record cannot downgrade source classification")
            if not set(record.provenance.permitted_uses).issubset(target.provenance.permitted_uses):
                raise PermissionError("derived record cannot widen permitted uses")
            rows.append(dict(field=ref.field, target=str(ref.target_id), version=target.version))
            targets[(ref.field, ref.target_id)] = target
        self._semantics(record, targets)
        return rows

    def _semantics(self, record: Record, targets):
        def target(field):
            return targets[(field, getattr(record, field))]

        if record.kind == "claim":
            subject, event = target("subject_id"), target("event_id")
            company_id = subject.issuer_id if subject.kind == "instrument" else subject.id
            if company_id != event.company_id:
                raise IntegrityFailure("claim subject does not match event company")
        if record.kind == "evidence":
            source, document = target("source_id"), target("document_id")
            if (
                source.original_document_id != document.id
                or record.document_sha256 != document.content_sha256
            ):
                raise IntegrityFailure("evidence does not match source document version")
        if record.kind == "relationship":
            if (
                record.predicate == "issuer_of"
                and target("object_id").issuer_id != record.subject_id
            ):
                raise IntegrityFailure("issuer relationship contradicts security master")
            if record.predicate in {"source_supports_claim", "source_contradicts_claim"}:
                relation = (
                    "supports" if record.predicate == "source_supports_claim" else "contradicts"
                )
                evidence = [targets[("evidence_ids", i)] for i in record.evidence_ids]
                if not any(
                    e.source_id == record.subject_id
                    and e.claim_id == record.object_id
                    and e.relation == relation
                    for e in evidence
                ):
                    raise IntegrityFailure("source-claim edge lacks matching evidence relation")

    def put(
        self,
        principal: Principal,
        payload: dict | Record,
        *,
        expected_version: int,
        idempotency_key: str,
    ) -> RegistryResult:
        _principal(principal, write=True)
        # Revalidate even model_construct/model_copy instances; never trust caller-built models.
        data = payload.model_dump(mode="python") if isinstance(payload, Record) else payload
        record = EntityEnvelope.model_validate(data).root
        _record_scope(record)
        if record.provenance.actor_id != principal.actor_id:
            raise PermissionError("payload actor does not match principal")
        if (
            type(expected_version) is not int
            or expected_version < 0
            or record.version != expected_version + 1
        ):
            raise VersionConflict("version must be exactly expected version plus one")
        if not isinstance(idempotency_key, str) or not 8 <= len(idempotency_key) <= 200:
            raise ValueError("idempotency key length must be 8..200")
        digest, encoded = canonical_sha256(record), canonical_text(record)
        request_hash = canonical_sha256(
            {"record": record, "expected_version": expected_version, "format": CANONICAL_FORMAT}
        )
        operation_id = uuid4()
        with self.engine.begin() as conn:
            self._database(conn)
            inserted = conn.execute(
                text("""
              INSERT INTO operations(id,actor_id,idempotency_key,request_sha256,state,version)
              VALUES (:id,:actor,:key,:sha,'running',1)
              ON CONFLICT(actor_id,idempotency_key) DO NOTHING RETURNING id
              """),
                {
                    "id": operation_id,
                    "actor": principal.actor_id,
                    "key": idempotency_key,
                    "sha": request_hash,
                },
            ).scalar()
            if not inserted:
                old = (
                    conn.execute(
                        text("""SELECT id,request_sha256,state FROM operations
                    WHERE actor_id=:actor AND idempotency_key=:key FOR UPDATE"""),
                        {"actor": principal.actor_id, "key": idempotency_key},
                    )
                    .mappings()
                    .one()
                )
                if old["request_sha256"] != request_hash or old["state"] != "completed":
                    raise IdempotencyConflict(
                        "key already bound to different or incomplete operation"
                    )
                receipt = (
                    conn.execute(
                        text("SELECT * FROM registry_commits WHERE operation_id=:id"),
                        {"id": old["id"]},
                    )
                    .mappings()
                    .first()
                )
                if not receipt or (
                    receipt["entity_id"],
                    receipt["entity_version"],
                    receipt["payload_sha256"],
                ) != (record.id, record.version, digest):
                    raise IntegrityFailure("replay receipt mismatch")
                self._load(conn, record.id, record.version)
                return RegistryResult(old["id"], record.id, record.version, digest, True)
            # Serialize creation as well as updates, including two concurrent first writers.
            conn.execute(
                text("SELECT pg_advisory_xact_lock(hashtextextended(:id,0))"),
                {"id": str(record.id)},
            )
            existing = (
                conn.execute(
                    text("SELECT kind,current_version FROM entities WHERE id=:id FOR UPDATE"),
                    {"id": record.id},
                )
                .mappings()
                .first()
            )
            if expected_version == 0:
                if existing:
                    raise VersionConflict("entity already exists")
                conn.execute(
                    text("INSERT INTO entities(id,kind,current_version) VALUES (:id,:kind,1)"),
                    {"id": record.id, "kind": record.kind},
                )
            else:
                if (
                    not existing
                    or existing["kind"] != record.kind
                    or existing["current_version"] != expected_version
                ):
                    raise VersionConflict("stale or changed entity identity")
                previous = self._load(conn, record.id, expected_version)
                stable_fields = {
                    "document": ("content_sha256", "byte_size", "media_type"),
                    "source": ("original_document_id",),
                    "instrument": ("issuer_id", "asset_type", "share_class"),
                }.get(record.kind, ())
                if any(getattr(previous, f) != getattr(record, f) for f in stable_fields):
                    raise IntegrityFailure("immutable identity fields require a new canonical ID")
                if (
                    previous.classification == "internal_research"
                    and record.classification == "public"
                ):
                    raise PermissionError("revision cannot downgrade classification")
            refs = self._resolve(conn, record)
            conn.execute(
                text("""INSERT INTO entity_versions(entity_id,version,schema_version,payload,content_sha256)
                         VALUES (:id,:version,:schema,CAST(:payload AS jsonb),:sha)"""),
                {
                    "id": record.id,
                    "version": record.version,
                    "schema": record.schema_version,
                    "payload": encoded,
                    "sha": digest,
                },
            )
            for ref in refs:
                conn.execute(
                    text("""INSERT INTO entity_references(from_id,from_version,field_name,to_id,to_version)
                     VALUES (:id,:version,:field,:target,:target_version)"""),
                    {
                        "id": record.id,
                        "version": record.version,
                        "field": ref["field"],
                        "target": UUID(ref["target"]),
                        "target_version": ref["version"],
                    },
                )
            if expected_version:
                count = conn.execute(
                    text("""UPDATE entities SET current_version=:version
                        WHERE id=:id AND current_version=:expected"""),
                    {"id": record.id, "version": record.version, "expected": expected_version},
                ).rowcount
                if count != 1:
                    raise VersionConflict("compare-and-swap conflict")
            conn.execute(
                text("""INSERT INTO registry_commits(operation_id,entity_id,entity_version,
                  canonical_format,payload_sha256,references_sha256)
                  VALUES (:op,:id,:version,:format,:sha,:refs)"""),
                {
                    "op": operation_id,
                    "id": record.id,
                    "version": record.version,
                    "format": CANONICAL_FORMAT,
                    "sha": digest,
                    "refs": canonical_sha256(refs),
                },
            )
            # Read from actual stored JSONB and references before declaring DB success.
            if canonical_sha256(self._load(conn, record.id, record.version)) != digest:
                raise IntegrityFailure("registry readback mismatch")
            conn.execute(
                text("""INSERT INTO audit_events(id,operation_id,actor_id,action,outcome,
                   resource_id,request_id,payload_sha256)
                   VALUES (:id,:op,:actor,'synthetic_registry.put','allowed',:resource,:request,:sha)"""),
                {
                    "id": uuid4(),
                    "op": operation_id,
                    "actor": principal.actor_id,
                    "resource": record.id,
                    "request": uuid4(),
                    "sha": request_hash,
                },
            )
            conn.execute(
                text("UPDATE operations SET state='completed',version=version+1 WHERE id=:id"),
                {"id": operation_id},
            )
        return RegistryResult(operation_id, record.id, record.version, digest, False)
