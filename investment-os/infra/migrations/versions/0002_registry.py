"""Separate database-only registry commits from future Vault readback receipts."""

from alembic import op

revision = "0002_registry"
down_revision = "0001_p0"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("""
    CREATE TABLE registry_commits (
      operation_id uuid PRIMARY KEY REFERENCES operations(id),
      entity_id uuid NOT NULL,
      entity_version integer NOT NULL,
      canonical_format text NOT NULL CHECK (canonical_format = 'ios-json-v1'),
      payload_sha256 char(64) NOT NULL CHECK (payload_sha256 ~ '^[a-f0-9]{64}$'),
      references_sha256 char(64) NOT NULL CHECK (references_sha256 ~ '^[a-f0-9]{64}$'),
      committed_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE(entity_id,entity_version),
      FOREIGN KEY(entity_id,entity_version) REFERENCES entity_versions(entity_id,version)
    );
    CREATE TRIGGER immutable_registry_commit BEFORE UPDATE OR DELETE ON registry_commits
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    CREATE TRIGGER immutable_reference BEFORE UPDATE OR DELETE ON entity_references
      FOR EACH ROW EXECUTE FUNCTION reject_immutable_change();
    CREATE FUNCTION preserve_entity_identity() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.id <> OLD.id OR NEW.kind <> OLD.kind THEN
        RAISE EXCEPTION 'canonical identity and kind are immutable';
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER entity_identity BEFORE UPDATE ON entities
      FOR EACH ROW EXECUTE FUNCTION preserve_entity_identity();
    CREATE FUNCTION check_payload_identity() RETURNS trigger LANGUAGE plpgsql AS $$
    BEGIN
      IF NEW.payload->>'kind' IS DISTINCT FROM
          (SELECT kind FROM entities WHERE id=NEW.entity_id)
         OR NEW.payload->>'schema_version' IS DISTINCT FROM NEW.schema_version THEN
        RAISE EXCEPTION 'payload kind or schema identity mismatch';
      END IF;
      RETURN NEW;
    END; $$;
    CREATE TRIGGER payload_identity BEFORE INSERT ON entity_versions
      FOR EACH ROW EXECUTE FUNCTION check_payload_identity();
    """)


def downgrade():
    op.execute("""
    DROP TABLE registry_commits;
    DROP TRIGGER immutable_reference ON entity_references;
    DROP TRIGGER payload_identity ON entity_versions;
    DROP FUNCTION check_payload_identity();
    DROP TRIGGER entity_identity ON entities;
    DROP FUNCTION preserve_entity_identity();
    """)
