from enum import StrEnum


class ErrorCode(StrEnum):
    INVALID_TOKEN = "INVALID_TOKEN"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    INVALID_REFRESH_TOKEN = "INVALID_REFRESH_TOKEN"
    FORBIDDEN = "FORBIDDEN"
    REGISTRATION_DISABLED = "REGISTRATION_DISABLED"
    DEMO_RESTRICTED = "DEMO_RESTRICTED"
    NOT_FOUND = "NOT_FOUND"
    EMAIL_IN_USE = "EMAIL_IN_USE"
    SLUG_IN_USE = "SLUG_IN_USE"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    RATE_LIMITED = "RATE_LIMITED"
    DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE"
    HTTP_ERROR = "HTTP_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class AppError(Exception):
    """A business failure. The API layer translates it to HTTP."""

    def __init__(self, code: ErrorCode, *, retry_after: int | None = None) -> None:
        super().__init__(code.value)
        self.code = code
        self.retry_after = retry_after
