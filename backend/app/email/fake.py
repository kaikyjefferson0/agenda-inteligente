from dataclasses import dataclass, field

from app.domain.email_retry import FailureKind, error_summary
from app.email.sender import EmailDeliveryError, EmailMessage


@dataclass(frozen=True)
class SentEmail:
    message: EmailMessage
    idempotency_key: str


@dataclass
class FakeSender:
    """Keeps the messages in memory, for the tests and for `EMAIL_BACKEND=fake`.

    `fail_next` queues failures: each call to `send` consumes one, before any
    message is accepted. `attempts` counts every call, refused or not.
    """

    sent: list[SentEmail] = field(default_factory=list)
    attempts: int = 0
    _failures: list[FailureKind] = field(default_factory=list)

    def fail_next(self, kind: FailureKind, times: int = 1) -> None:
        self._failures.extend([kind] * times)

    async def send(self, message: EmailMessage, idempotency_key: str) -> None:
        self.attempts += 1
        if self._failures:
            kind = self._failures.pop(0)
            status_code = 503 if kind is FailureKind.TEMPORARY else 422
            raise EmailDeliveryError(
                kind, error_summary("FakeDeliveryError", status_code)
            )
        self.sent.append(SentEmail(message, idempotency_key))
