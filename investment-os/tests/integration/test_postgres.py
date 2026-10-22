"""Real PostgreSQL checks; no SQLite substitution. All inserts roll back."""

import json
import os
from uuid import uuid4

import pytest
from sqlalchemy import text
from sqlalchemy.exc import DBAPIError

from investment_os.storage.database import make_engine, ready

pytestmark = pytest.mark.integration


@pytest.fixture
def database():
    url = os.environ.get("IOS_TEST_DATABASE_URL")
    if not url:
        pytest.skip("IOS_TEST_DATABASE_URL required for disposable synthetic PostgreSQL")
    if not url.split("?")[0].endswith("/ios_synthetic"):
        pytest.fail("Integration tests require the dedicated ios_synthetic database")
    engine = make_engine(url)
    try:
        yield engine
    finally:
        engine.dispose()


@pytest.fixture
def conn(database):
    with database.connect() as c:
        transaction = c.begin()
        try:
            yield c
        finally:
            transaction.rollback()


def insert_entity(conn, payload):
    entity_id = uuid4()
    payload = dict(payload, id=str(entity_id))
    conn.execute(
        text("INSERT INTO entities(id,kind) VALUES (:id,:kind)"),
        {"id": entity_id, "kind": payload["kind"]},
    )
    conn.execute(
        text("""INSERT INTO entity_versions(entity_id,version,schema_version,payload,content_sha256)
        VALUES (:id,1,'1.0',CAST(:payload AS jsonb),:sha)"""),
        {"id": entity_id, "payload": json.dumps(payload), "sha": "a" * 64},
    )
    return entity_id


def insert_operation(conn):
    values = dict(id=uuid4(), actor=uuid4(), key="synthetic-operation", sha="a" * 64)
    conn.execute(
        text("""INSERT INTO operations(id,actor_id,idempotency_key,request_sha256,state,version)
        VALUES (:id,:actor,:key,:sha,'queued',1)"""),
        values,
    )
    return values


def test_postgres_connection_and_migration(database):
    assert ready(database)
    with database.connect() as c:
        assert c.execute(text("SELECT current_database()")).scalar() == "ios_synthetic"
        assert (
            c.execute(
                text("SELECT count(*) FROM information_schema.tables WHERE table_schema='public'")
            ).scalar()
            >= 8
        )


def test_canonical_versions_and_immutable_history(conn, records):
    entity_id = insert_entity(conn, next(r for r in records if r["kind"] == "company"))
    conn.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))
    with pytest.raises(DBAPIError, match="immutable history"):
        conn.execute(
            text("UPDATE entity_versions SET content_sha256=:sha WHERE entity_id=:id"),
            {"sha": "b" * 64, "id": entity_id},
        )


def test_current_version_cannot_point_to_missing_revision(conn):
    conn.execute(text("INSERT INTO entities(id,kind) VALUES (:id,'company')"), {"id": uuid4()})
    with pytest.raises(DBAPIError):
        conn.execute(text("SET CONSTRAINTS ALL IMMEDIATE"))


def test_reference_cannot_point_to_missing_entity(conn, records):
    entity_id = insert_entity(conn, next(r for r in records if r["kind"] == "company"))
    with pytest.raises(DBAPIError):
        conn.execute(
            text("""INSERT INTO entity_references(from_id,from_version,field_name,to_id)
                     VALUES (:id,1,'source_ids',:missing)"""),
            {"id": entity_id, "missing": uuid4()},
        )


def test_idempotency_actor_scope_prevents_duplicate_operations(conn):
    values = insert_operation(conn)
    with pytest.raises(DBAPIError):
        conn.execute(
            text("""INSERT INTO operations(id,actor_id,idempotency_key,request_sha256,state,version)
          VALUES (:id,:actor,:key,:sha,'queued',1)"""),
            dict(values, id=uuid4()),
        )


def test_compare_and_swap_rejects_stale_operation(conn):
    op = insert_operation(conn)
    update = text(
        "UPDATE operations SET state='running',version=version+1 WHERE id=:id AND version=:expected"
    )
    assert conn.execute(update, {"id": op["id"], "expected": 1}).rowcount == 1
    assert conn.execute(update, {"id": op["id"], "expected": 1}).rowcount == 0


def test_committed_receipt_requires_physical_index_links(conn):
    op = insert_operation(conn)
    with pytest.raises(DBAPIError):
        conn.execute(
            text("INSERT INTO receipts(id,operation_id,state) VALUES (:id,:op,'committed')"),
            {"id": uuid4(), "op": op["id"]},
        )


def test_audit_is_append_only(conn):
    op = insert_operation(conn)
    audit_id = uuid4()
    conn.execute(
        text("""INSERT INTO audit_events(id,operation_id,actor_id,action,outcome,request_id,payload_sha256)
        VALUES (:id,:op,:actor,'synthetic','denied',:request,:sha)"""),
        {"id": audit_id, "op": op["id"], "actor": op["actor"], "request": uuid4(), "sha": "a" * 64},
    )
    with pytest.raises(DBAPIError, match="immutable history"):
        conn.execute(text("DELETE FROM audit_events WHERE id=:id"), {"id": audit_id})


def test_api_database_role_cannot_write(database):
    url = os.environ["IOS_TEST_DATABASE_URL"].replace(
        "ios_dummy:dummy-local-only", "ios_app:dummy-read-only"
    )
    app = make_engine(url)
    try:
        assert ready(app)
        with app.begin() as c:
            with pytest.raises(DBAPIError, match="permission denied"):
                c.execute(
                    text("INSERT INTO entities(id,kind) VALUES (:id,'company')"), {"id": uuid4()}
                )
    finally:
        app.dispose()
