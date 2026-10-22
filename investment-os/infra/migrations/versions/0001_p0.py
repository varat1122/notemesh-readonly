"""Canonical registry with immutable versions and append-only operation evidence."""

from alembic import op

revision = "0001_p0"
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE entities (
      id uuid PRIMARY KEY,
      kind text NOT NULL CHECK (kind IN ('instrument','company','industry','technology','source',
       'document','event','claim','evidence','relationship','note','research_review','thesis_version',
       'market_data_reference','quant_run','signal','mandate','trade_setup','portfolio',
       'transaction','decision','audit_event','job','receipt')),
      created_at timestamptz NOT NULL DEFAULT now(),
      current_version integer NOT NULL DEFAULT 1 CHECK (current_version > 0)
    );
    CREATE TABLE entity_versions (
      entity_id uuid NOT NULL REFERENCES entities(id),
      version integer NOT NULL CHECK (version > 0),
      schema_version text NOT NULL CHECK (schema_version = '1.0'),
      payload jsonb NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
      content_sha256 char(64) NOT NULL CHECK (content_sha256 ~ '^[a-f0-9]{64}$'),
      recorded_at timestamptz NOT NULL DEFAULT now(),
      PRIMARY KEY(entity_id, version),
      CHECK (payload->>'id' = entity_id::text),
      CHECK ((payload->>'version')::integer = version),
      CHECK (payload ?& ARRAY['id','kind','version','schema_version','provenance','times'])
    );
    ALTER TABLE entities ADD CONSTRAINT current_version_exists
      FOREIGN KEY(id,current_version) REFERENCES entity_versions(entity_id,version)
      DEFERRABLE INITIALLY DEFERRED;
    CREATE TABLE entity_references (
      from_id uuid NOT NULL,
      from_version integer NOT NULL,
      field_name text NOT NULL,
      to_id uuid NOT NULL REFERENCES entities(id),
      to_version integer,
      PRIMARY KEY(from_id,from_version,field_name,to_id),
      FOREIGN KEY(from_id,from_version) REFERENCES entity_versions(entity_id,version),
      FOREIGN KEY(to_id,to_version) REFERENCES entity_versions(entity_id,version)
    );
    CREATE TABLE operations (
      id uuid PRIMARY KEY,
      actor_id uuid NOT NULL,
      idempotency_key text NOT NULL,
      request_sha256 char(64) NOT NULL CHECK (request_sha256 ~ '^[a-f0-9]{64}$'),
      state text NOT NULL CHECK (state IN ('queued','running','completed','failed_retryable',
        'failed_terminal','blocked','partial')),
      version integer NOT NULL CHECK (version > 0),
      created_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(actor_id,idempotency_key)
    );
    CREATE TABLE audit_events (
      id uuid PRIMARY KEY,
      operation_id uuid REFERENCES operations(id),
      actor_id uuid NOT NULL,
      action text NOT NULL,
      outcome text NOT NULL CHECK (outcome IN ('allowed','denied','failed')),
      resource_id uuid,
      request_id uuid NOT NULL,
      occurred_at timestamptz NOT NULL DEFAULT now(),
      payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$')
    );
    CREATE TABLE receipts (
      id uuid PRIMARY KEY,
      operation_id uuid NOT NULL REFERENCES operations(id),
      state text NOT NULL CHECK (state IN ('prepared','partial','committed','blocked','reconciled')),
      after_sha256 char(64),
      physical_verified boolean NOT NULL DEFAULT false,
      index_verified boolean NOT NULL DEFAULT false,
      links_verified boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (after_sha256 IS NULL OR after_sha256 ~ '^[a-f0-9]{64}$'),
      CHECK (state <> 'committed' OR (after_sha256 IS NOT NULL AND physical_verified
          AND index_verified AND links_verified))
    );
    CREATE TABLE permission_grants (
      id uuid PRIMARY KEY,
      principal_id uuid NOT NULL,
      action text NOT NULL,
      resource_scope text NOT NULL,
      approved_by uuid NOT NULL,
      expires_at timestamptz NOT NULL,
      revoked_at timestamptz,
      created_at timestamptz NOT NULL DEFAULT now(),
      CHECK (expires_at > created_at)
    );
    CREATE FUNCTION reject_immutable_change() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN RAISE EXCEPTION 'immutable history'; END; $$;
    CREATE TRIGGER immutable_version BEFORE UPDATE OR DELETE ON entity_versions
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON audit_events
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    CREATE TRIGGER immutable_receipt BEFORE UPDATE OR DELETE ON receipts
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    CREATE INDEX references_target ON entity_references(to_id);
    CREATE INDEX entities_kind ON entities(kind);
    CREATE INDEX operation_state ON operations(state,created_at);
    """)


def downgrade():
    op.execute("""
    DROP TABLE permission_grants, receipts, audit_events, operations, entity_references;
    ALTER TABLE entities DROP CONSTRAINT current_version_exists;
    DROP TABLE entity_versions, entities;
    DROP FUNCTION reject_immutable_change();
    """)
