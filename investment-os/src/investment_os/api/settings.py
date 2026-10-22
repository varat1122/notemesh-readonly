from typing import Literal

from pydantic import SecretStr
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_prefix="IOS_", extra="ignore")
    environment: Literal["synthetic_development"] = "synthetic_development"
    database_url: SecretStr = SecretStr(
        "postgresql+psycopg://ios_dummy:dummy-local-only@127.0.0.1:55432/ios_synthetic"
    )
    enable_dummy_auth: bool = False  # explicit opt-in; impossible production mode
