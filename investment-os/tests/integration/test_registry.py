"""Repository tests commit fictional UUIDs to the dedicated synthetic database.

Unlike P0 SQL primitive tests, these prove real transaction/replay/concurrency behavior.
Append-only history is preserved; tests never reset or truncate any database.
"""

import copy
import json
import os
from concurrent.futures import ThreadPoolExecutor
from threading import Barrier
from uuid import UUID, uuid4

import pytest
from sqlalchemy import event, text
from sqlalchemy.exc import DBAPIError

from investment_os.domain.canonical import canonical_sha256
from investment_os.domain.entities import EntityEnvelope
from investment_os.domain.references import extract_references
from investment_os.policy.access import DUMMY_PRINCIPALS
from investment_os.storage.database import make_engine
from investment_os.storage.registry import (
    IdempotencyConflict,
    IntegrityFailure,
    SyntheticRegistry,
    VersionConflict,
)

pytestmark = pytest.mark.integration
ACTOR = DUMMY_PRINCIPALS["dummy-researcher"]
OWNER = DUMMY_PRINCIPALS["dummy-owner"]
READER = DUMMY_PRINCIPALS["dummy-reader"]


@pytest.fixture
def registry():
    url = os.environ.get("IOS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("IOS_TEST_DATABASE_URL required for real synthetic PostgreSQL")
    if not url.split("?")[0].endswith("/ios_synthetic"):
        pytest.fail("dedicated ios_synthetic database required")
    engine = make_engine(url)
    try:
        yield SyntheticRegistry(engine)
    finally:
        engine.dispose()


@pytest.fixture
def data(records):
    mapping = {r["id"]: str(uuid4()) for r in records}

    def remap(value):
        if isinstance(value, dict):
            return {k: remap(v) for k, v in value.items()}
        if isinstance(value, list):
            return [remap(v) for v in value]
        return mapping.get(value, value) if isinstance(value, str) else value

    result = {r["kind"]: remap(r) for r in records}
    for r in result.values():
        r["provenance"]["actor_id"] = str(ACTOR.actor_id)
    return result


@pytest.fixture
def seed(registry, data):
    done = set()
    by_id = {r["id"]: r for r in data.values()}

    def create(kind):
        record = data[kind]
        if kind not in done:
            for ref in extract_references(EntityEnvelope.model_validate(record).root):
                create(by_id[str(ref.target_id)]["kind"])
            registry.put(ACTOR, record, expected_version=0, idempotency_key="seed-" + record["id"])
            done.add(kind)
        return copy.deepcopy(record)

    return create


def counts(registry):
    with registry.engine.connect() as conn:
        return tuple(
            conn.execute(text("SELECT count(*) FROM " + table)).scalar()
            for table in [
                "entities",
                "entity_versions",
                "entity_references",
                "operations",
                "registry_commits",
                "audit_events",
                "receipts",
            ]
        )


def test_create_reference_projection_and_readback_after_new_connection(registry, data, seed):
    for kind in [
        "industry",
        "technology",
        "company",
        "instrument",
        "document",
        "source",
        "event",
        "claim",
        "evidence",
        "relationship",
    ]:
        seed(kind)
    registry.engine.dispose()
    for kind in ["company", "source", "claim", "evidence", "relationship"]:
        record = registry.get(READER, UUID(data[kind]["id"]))
        assert record.kind == kind and record.provenance.independent_evidence is False
        with registry.engine.connect() as conn:
            actual = conn.execute(
                text("""SELECT field_name,to_id,to_version FROM entity_references
                WHERE from_id=:id AND from_version=1"""),
                {"id": record.id},
            ).all()
        assert {(r[0], r[1]) for r in actual} == {
            (r.field, r.target_id) for r in extract_references(record)
        }
        assert all(r[2] == 1 for r in actual)


def test_replay_is_stable_after_later_revision_and_does_not_write(registry, data):
    original = data["technology"]
    key = "replay-" + original["id"]
    first = registry.put(ACTOR, original, expected_version=0, idempotency_key=key)
    revised = copy.deepcopy(original)
    revised.update(version=2, name="New synthetic description")
    registry.put(ACTOR, revised, expected_version=1, idempotency_key=key + "-v2")
    before = counts(registry)
    replay = registry.put(ACTOR, original, expected_version=0, idempotency_key=key)
    assert replay.replayed and replay.operation_id == first.operation_id and replay.version == 1
    assert counts(registry) == before
    assert registry.get(READER, UUID(original["id"])).version == 2
    assert registry.get(READER, UUID(original["id"]), 1).name == original["name"]


def test_same_key_different_payload_conflicts(registry, data):
    record = data["technology"]
    key = "key-conflict-" + record["id"]
    registry.put(ACTOR, record, expected_version=0, idempotency_key=key)
    record["name"] = "Changed payload"
    before = counts(registry)
    with pytest.raises(IdempotencyConflict):
        registry.put(ACTOR, record, expected_version=0, idempotency_key=key)
    assert counts(registry) == before


def test_keys_are_scoped_to_authenticated_actor(registry, data):
    a = data["technology"]
    b = copy.deepcopy(a)
    b["id"] = str(uuid4())
    b["provenance"]["actor_id"] = str(OWNER.actor_id)
    key = "shared-" + a["id"]
    first = registry.put(ACTOR, a, expected_version=0, idempotency_key=key)
    second = registry.put(OWNER, b, expected_version=0, idempotency_key=key)
    assert first.operation_id != second.operation_id


@pytest.mark.parametrize("problem", ["missing", "wrong_kind", "duplicate", "self"])
def test_bad_references_leave_no_partial_rows(registry, data, seed, problem):
    source = seed("technology")
    r = copy.deepcopy(data["company"])
    r["industry_ids"] = {
        "missing": [str(uuid4())],
        "wrong_kind": [source["id"]],
        "duplicate": [source["id"], source["id"]],
        "self": [r["id"]],
    }[problem]
    before = counts(registry)
    with pytest.raises((ValueError, IntegrityFailure)):
        registry.put(ACTOR, r, expected_version=0, idempotency_key="bad-ref-" + r["id"])
    assert counts(registry) == before


def test_wrong_company_claim_and_wrong_document_evidence_denied(registry, data, seed):
    seed("event")
    other = copy.deepcopy(data["company"])
    other["id"] = str(uuid4())
    registry.put(ACTOR, other, expected_version=0, idempotency_key="other-company-" + other["id"])
    claim = copy.deepcopy(data["claim"])
    claim["subject_id"] = other["id"]
    before = counts(registry)
    with pytest.raises(IntegrityFailure, match="event company"):
        registry.put(
            ACTOR, claim, expected_version=0, idempotency_key="wrong-company-" + claim["id"]
        )
    assert counts(registry) == before
    seed("claim")
    evidence = copy.deepcopy(data["evidence"])
    evidence["document_sha256"] = "b" * 64
    before = counts(registry)
    with pytest.raises(IntegrityFailure, match="source document"):
        registry.put(
            ACTOR, evidence, expected_version=0, idempotency_key="wrong-hash-" + evidence["id"]
        )
    assert counts(registry) == before


def test_edges_cannot_invent_issuer_or_support_relations(registry, data, seed):
    seed("instrument")
    other = copy.deepcopy(data["company"])
    other["id"] = str(uuid4())
    registry.put(ACTOR, other, expected_version=0, idempotency_key="issuer-other-" + other["id"])
    edge = copy.deepcopy(data["relationship"])
    edge.update(predicate="issuer_of", subject_id=other["id"], object_id=data["instrument"]["id"])
    with pytest.raises(IntegrityFailure, match="security master"):
        registry.put(ACTOR, edge, expected_version=0, idempotency_key="issuer-edge-" + edge["id"])
    seed("evidence")
    edge.update(
        predicate="source_supports_claim",
        subject_id=data["source"]["id"],
        object_id=data["claim"]["id"],
        evidence_ids=[data["evidence"]["id"]],
    )
    with pytest.raises(IntegrityFailure, match="matching evidence"):
        registry.put(ACTOR, edge, expected_version=0, idempotency_key="support-edge-" + edge["id"])


def test_reference_versions_are_pinned_and_parent_edit_does_not_rewrite_history(
    registry, data, seed
):
    company = seed("company")
    industry = copy.deepcopy(data["industry"])
    industry.update(version=2, name="New taxonomy description")
    registry.put(
        ACTOR, industry, expected_version=1, idempotency_key="industry-v2-" + industry["id"]
    )
    assert registry.get(READER, UUID(company["id"])).version == 1
    with registry.engine.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT to_version FROM entity_references WHERE from_id=:id AND field_name='industry_ids'"
                ),
                {"id": UUID(company["id"])},
            ).scalar()
            == 1
        )
    company.update(version=2)
    registry.put(ACTOR, company, expected_version=1, idempotency_key="company-v2-" + company["id"])
    with registry.engine.connect() as conn:
        assert (
            conn.execute(
                text(
                    "SELECT to_version FROM entity_references WHERE from_id=:id AND from_version=2 AND field_name='industry_ids'"
                ),
                {"id": UUID(company["id"])},
            ).scalar()
            == 2
        )


@pytest.mark.parametrize(
    "kind,field,value",
    [("document", "content_sha256", "b" * 64), ("instrument", "share_class", "B")],
)
def test_identity_changes_require_new_id(registry, data, seed, kind, field, value):
    r = seed(kind)
    r.update(version=2)
    r[field] = value
    before = counts(registry)
    with pytest.raises(IntegrityFailure, match="new canonical ID"):
        registry.put(ACTOR, r, expected_version=1, idempotency_key="identity-change-" + r["id"])
    assert counts(registry) == before


@pytest.mark.parametrize(
    "kind", ["thesis_version", "portfolio", "transaction", "decision", "note", "receipt"]
)
def test_protected_and_later_phase_kinds_are_denied(registry, data, kind):
    r = data[kind]
    before = counts(registry)
    with pytest.raises(PermissionError):
        registry.put(ACTOR, r, expected_version=0, idempotency_key="protected-" + r["id"])
    assert counts(registry) == before


def test_reader_and_forged_actor_denied_before_mutation(registry, data):
    r = data["technology"]
    before = counts(registry)
    with pytest.raises(PermissionError):
        registry.put(READER, r, expected_version=0, idempotency_key="reader-" + r["id"])
    r["provenance"]["actor_id"] = str(uuid4())
    with pytest.raises(PermissionError):
        registry.put(ACTOR, r, expected_version=0, idempotency_key="forged-" + r["id"])
    assert counts(registry) == before


@pytest.mark.parametrize(
    "change",
    [
        {"origin": "human"},
        {"license_id": "licensed-feed"},
        {"permitted_uses": ["local_research", "redistribute"]},
    ],
)
def test_non_synthetic_and_rights_expansion_denied(registry, data, change):
    r = data["technology"]
    r["provenance"].update(change)
    with pytest.raises(PermissionError):
        registry.put(ACTOR, r, expected_version=0, idempotency_key="rights-" + r["id"])


def test_classification_cannot_be_downgraded_from_reference(registry, data, seed):
    seed("industry")
    r = data["company"]
    r["classification"] = "public"
    with pytest.raises(PermissionError, match="classification"):
        registry.put(ACTOR, r, expected_version=0, idempotency_key="public-" + r["id"])


def test_audit_failure_rolls_back_every_row_and_same_key_can_retry(registry, data):
    r = data["technology"]
    key = "audit-failure-" + r["id"]
    before = counts(registry)

    def fail_audit(conn, cursor, statement, parameters, context, executemany):
        if "INSERT INTO audit_events" in statement:
            raise RuntimeError("injected audit storage failure")

    event.listen(registry.engine, "before_cursor_execute", fail_audit)
    try:
        with pytest.raises(RuntimeError, match="audit storage"):
            registry.put(ACTOR, r, expected_version=0, idempotency_key=key)
    finally:
        event.remove(registry.engine, "before_cursor_execute", fail_audit)
    assert counts(registry) == before
    result = registry.put(ACTOR, r, expected_version=0, idempotency_key=key)
    assert not result.replayed


def test_concurrent_identical_retry_has_one_commit(registry, data):
    r = data["technology"]
    barrier = Barrier(2)

    def put():
        barrier.wait(timeout=10)
        return registry.put(ACTOR, r, expected_version=0, idempotency_key="parallel-" + r["id"])

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(put) for _ in range(2)]
        results = [f.result(timeout=15) for f in futures]
    assert len({r.operation_id for r in results}) == 1
    assert sorted(r.replayed for r in results) == [False, True]


def test_concurrent_stale_updates_have_exactly_one_winner(registry, data, seed):
    original = seed("technology")
    barrier = Barrier(2)

    def change(name):
        r = copy.deepcopy(original)
        r.update(version=2, name=name)
        barrier.wait(timeout=10)
        try:
            return registry.put(
                ACTOR, r, expected_version=1, idempotency_key="race-" + name + "-" + r["id"]
            )
        except VersionConflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(change, name) for name in ["first", "second"]]
        results = [f.result(timeout=15) for f in futures]
    assert results.count("conflict") == 1
    assert registry.get(READER, UUID(original["id"])).version == 2
    with registry.engine.connect() as conn:
        assert (
            conn.execute(
                text("SELECT count(*) FROM registry_commits WHERE entity_id=:id"),
                {"id": UUID(original["id"])},
            ).scalar()
            == 2
        )


def test_extra_reference_after_seal_is_detected(registry, data, seed):
    r = seed("technology")
    industry = seed("industry")
    with registry.engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text("""INSERT INTO entity_references(from_id,from_version,field_name,to_id,to_version)
                VALUES (:id,1,'invented_reference',:target,1)"""),
                {"id": UUID(r["id"]), "target": UUID(industry["id"])},
            )
            with pytest.raises(IntegrityFailure, match="projection"):
                registry._load(conn, UUID(r["id"]))
        finally:
            tx.rollback()


def test_database_rejects_rewriting_sealed_references(registry, data, seed):
    r = seed("company")
    with pytest.raises(DBAPIError, match="immutable history"):
        with registry.engine.begin() as conn:
            conn.execute(
                text("DELETE FROM entity_references WHERE from_id=:id"), {"id": UUID(r["id"])}
            )


def test_legacy_payload_is_not_silently_adopted(registry, data):
    r = data["technology"]
    with registry.engine.connect() as conn:
        tx = conn.begin()
        try:
            conn.execute(
                text("INSERT INTO entities(id,kind) VALUES (:id,'technology')"),
                {"id": UUID(r["id"])},
            )
            conn.execute(
                text("""INSERT INTO entity_versions(entity_id,version,schema_version,payload,content_sha256)
                VALUES (:id,1,'1.0',CAST(:payload AS jsonb),:sha)"""),
                {"id": UUID(r["id"]), "payload": json.dumps(r), "sha": canonical_sha256(r)},
            )
            with pytest.raises(IntegrityFailure, match="unregistered"):
                registry._load(conn, UUID(r["id"]))
        finally:
            tx.rollback()


def test_concurrent_first_creation_with_distinct_keys_has_one_winner(registry, data):
    original = data["technology"]
    barrier = Barrier(2)

    def create(name):
        r = copy.deepcopy(original)
        r["name"] = name
        barrier.wait(timeout=10)
        try:
            return registry.put(
                ACTOR, r, expected_version=0, idempotency_key="create-race-" + name + r["id"]
            )
        except VersionConflict:
            return "conflict"

    with ThreadPoolExecutor(max_workers=2) as pool:
        futures = [pool.submit(create, name) for name in ["first", "second"]]
        results = [f.result(timeout=15) for f in futures]
    assert results.count("conflict") == 1
    assert registry.get(READER, UUID(original["id"])).version == 1


def test_incomplete_reserved_operation_cannot_report_replayed_success(registry, data):
    from investment_os.domain.canonical import CANONICAL_FORMAT

    r = data["technology"]
    key = "incomplete-" + r["id"]
    request_hash = canonical_sha256(
        {
            "record": EntityEnvelope.model_validate(r).root,
            "expected_version": 0,
            "format": CANONICAL_FORMAT,
        }
    )
    with registry.engine.begin() as conn:
        conn.execute(
            text("""INSERT INTO operations(id,actor_id,idempotency_key,request_sha256,state,version)
            VALUES (:id,:actor,:key,:sha,'running',1)"""),
            {"id": uuid4(), "actor": ACTOR.actor_id, "key": key, "sha": request_hash},
        )
    before = counts(registry)
    with pytest.raises(IdempotencyConflict, match="incomplete"):
        registry.put(ACTOR, r, expected_version=0, idempotency_key=key)
    assert counts(registry) == before


def test_valid_support_edge_requires_matching_evidence(registry, data, seed):
    evidence = seed("evidence")
    evidence.update(version=2, relation="supports")
    registry.put(
        ACTOR, evidence, expected_version=1, idempotency_key="support-v2-" + evidence["id"]
    )
    edge = copy.deepcopy(data["relationship"])
    edge.update(
        predicate="source_supports_claim",
        subject_id=data["source"]["id"],
        object_id=data["claim"]["id"],
        evidence_ids=[evidence["id"]],
    )
    result = registry.put(
        ACTOR, edge, expected_version=0, idempotency_key="valid-edge-" + edge["id"]
    )
    assert registry.get(READER, result.entity_id).predicate == "source_supports_claim"
