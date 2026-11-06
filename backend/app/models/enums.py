from enum import StrEnum


class UserRole(StrEnum):
    OWNER = "owner"
    PROFESSIONAL = "professional"


class AccountTokenPurpose(StrEnum):
    INVITE = "invite"
    PASSWORD_RESET = "password_reset"


class AppointmentStatus(StrEnum):
    CONFIRMED = "confirmed"
    CANCELLED = "cancelled"
    COMPLETED = "completed"
    NO_SHOW = "no_show"


class AppointmentOrigin(StrEnum):
    PUBLIC = "public"
    STAFF = "staff"


class EmailOutboxStatus(StrEnum):
    PENDING = "pending"
    SENT = "sent"
    FAILED = "failed"
