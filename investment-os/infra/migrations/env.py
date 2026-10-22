from alembic import context

from investment_os.api.settings import Settings
from investment_os.storage.database import make_engine

# Never put connection URLs in checked-in config or migration logging.
engine = make_engine(Settings().database_url.get_secret_value())
with engine.connect() as connection:
    context.configure(connection=connection, target_metadata=None)
    with context.begin_transaction():
        context.run_migrations()
engine.dispose()
