"""D34: the worker only knows this interface, never a provider."""

from dataclasses import dataclass
from typing import Protocol

from app.domain.email_retry import FailureKind


@dataclass(frozen=True)
class EmailMessage:
    to_email: str
    subject: str
    text: str
    html: str


class EmailDeliveryError(Exception):
    """A refused or failed delivery, already classified (D39).

    `summary` is what may be stored and logged (D40): the error type and the
    HTTP code, never the recipient, the link nor the body of a response.
    """

    def __init__(self, kind: FailureKind, summary: str) -> None:
        super().__init__(summary)
        self.kind = kind
        self.summary = summary


class EmailSender(Protocol):
    async def send(self, message: EmailMessage, idempotency_key: str) -> None:
        """Returns once the provider accepted it, or raises EmailDeliveryError."""
        ...
