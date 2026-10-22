from sqlalchemy import create_engine, text
from sqlalchemy.engine import Engine

SCHEMA_REVISION = "0001_p0"


def make_engine(url: str) -> Engine:
    if not url.startswith("postgresql+psycopg://"):
        raise ValueError("PostgreSQL is required")
    return create_engine(url, pool_pre_ping=True, connect_args={"connect_timeout": 3})


def ready(engine: Engine) -> bool:
    with engine.connect() as conn:
        return (
            conn.execute(text("SELECT version_num FROM alembic_version")).scalar()
            == SCHEMA_REVISION
        )
