from functools import lru_cache
from typing import Literal, Self

from pydantic import Field, SecretStr, model_validator
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
    # D35: smtp points to Mailpit in development; nothing logs the messages.
    email_backend: Literal["smtp", "fake", "resend"] = "smtp"
    email_from: str = Field(
        default="Agenda Inteligente <nao-responda@localhost>", min_length=1
    )
    smtp_host: str = "mailpit"
    smtp_port: int = Field(default=1025, ge=1, le=65535)
    # SecretStr keeps the key out of reprs and validation errors.
    resend_api_key: SecretStr | None = None

    @model_validator(mode="after")
    def _require_resend_key(self) -> Self:
        """D41: with Resend, the application does not start without the key."""
        if self.email_backend == "resend" and (
            self.resend_api_key is None or not self.resend_api_key.get_secret_value()
        ):
            raise ValueError("RESEND_API_KEY is required when EMAIL_BACKEND=resend")
        return self

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
