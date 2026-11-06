from enum import StrEnum


class EmailTemplate(StrEnum):
    ACCOUNT_INVITE = "account_invite"
    PASSWORD_RESET = "password_reset"
    APPOINTMENT_CONFIRMATION = "appointment_confirmation"
