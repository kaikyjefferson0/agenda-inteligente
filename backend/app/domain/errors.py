from collections.abc import Sequence
from enum import StrEnum

from app.domain.schedule import AppointmentSummary


class ErrorCode(StrEnum):
    INVALID_TOKEN = "INVALID_TOKEN"
    INVALID_CREDENTIALS = "INVALID_CREDENTIALS"
    NOT_AUTHENTICATED = "NOT_AUTHENTICATED"
    INVALID_REFRESH_TOKEN = "INVALID_REFRESH_TOKEN"
    FORBIDDEN = "FORBIDDEN"
    REGISTRATION_DISABLED = "REGISTRATION_DISABLED"
    DEMO_RESTRICTED = "DEMO_RESTRICTED"
    NOT_FOUND = "NOT_FOUND"
    SLOT_UNAVAILABLE = "SLOT_UNAVAILABLE"
    CHANGE_DEADLINE_PASSED = "CHANGE_DEADLINE_PASSED"
    INVALID_STATUS_TRANSITION = "INVALID_STATUS_TRANSITION"
    IDEMPOTENCY_KEY_REUSED = "IDEMPOTENCY_KEY_REUSED"
    APPOINTMENT_CONFLICTS = "APPOINTMENT_CONFLICTS"
    TIME_BLOCK_OVERLAP = "TIME_BLOCK_OVERLAP"
    EMAIL_IN_USE = "EMAIL_IN_USE"
    SLUG_IN_USE = "SLUG_IN_USE"
    VALIDATION_ERROR = "VALIDATION_ERROR"
    RATE_LIMITED = "RATE_LIMITED"
    DATABASE_UNAVAILABLE = "DATABASE_UNAVAILABLE"
    HTTP_ERROR = "HTTP_ERROR"
    INTERNAL_ERROR = "INTERNAL_ERROR"


class AppError(Exception):
    """A business failure. The API layer translates it to HTTP."""

    def __init__(
        self,
        code: ErrorCode,
        *,
        retry_after: int | None = None,
        conflicts: Sequence[AppointmentSummary] | None = None,
        invalid_field: tuple[str, str] | None = None,
        invalid_location: str = "body",
    ) -> None:
        super().__init__(code.value)
        self.code = code
        self.retry_after = retry_after
        self.conflicts = conflicts
        # (field, message), for a rule that needs the stored values to be checked.
        self.invalid_field = invalid_field
        self.invalid_location = invalid_location
