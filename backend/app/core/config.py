from functools import lru_cache

from pydantic import Field
from pydantic_settings import BaseSettings

MIN_SECRET_LENGTH = 32


class Settings(BaseSettings):
    database_url: str
    jwt_secret: str = Field(min_length=MIN_SECRET_LENGTH)
    rate_limit_key_secret: str = Field(min_length=MIN_SECRET_LENGTH)
    registration_enabled: bool = False
    # Comma-separated. Kept as a string because pydantic-settings would otherwise
    # expect JSON from the environment.
    cors_allowed_origins: str = ""
    frontend_base_url: str = "http://localhost:5173"
    # Header set by the hosting proxy. Empty means no trusted proxy: the address
    # of the connection is used and client-supplied headers are ignored.
    trusted_client_ip_header: str = ""
    email_daily_cap: int = Field(default=100, ge=0)
    email_recipient_daily_cap: int = Field(default=3, ge=0)

    @property
    def cors_origins(self) -> list[str]:
        return [
            origin.strip()
            for origin in self.cors_allowed_origins.split(",")
            if origin.strip()
        ]


@lru_cache
def get_settings() -> Settings:
    return Settings()
