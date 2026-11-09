"""D35: plain SMTP, used with Mailpit in development."""

import asyncio
import smtplib
from email.message import EmailMessage as MimeMessage
from email.utils import make_msgid

from app.domain.email_retry import FailureKind, error_summary
from app.email.sender import EmailDeliveryError, EmailMessage

TIMEOUT_SECONDS = 10.0


class SmtpSender:
    """smtplib is blocking, so each delivery runs in a thread."""

    def __init__(self, host: str, port: int, from_address: str) -> None:
        self._host = host
        self._port = port
        self._from_address = from_address

    def _build(self, message: EmailMessage, idempotency_key: str) -> MimeMessage:
        mime = MimeMessage()
        mime["From"] = self._from_address
        mime["To"] = message.to_email
        mime["Subject"] = message.subject
        # SMTP has no idempotency key; the id at least marks repeated deliveries.
        mime["Message-ID"] = make_msgid(idstring=idempotency_key)
        mime.set_content(message.text)
        mime.add_alternative(message.html, subtype="html")
        return mime

    def _deliver(self, mime: MimeMessage) -> None:
        with smtplib.SMTP(self._host, self._port, timeout=TIMEOUT_SECONDS) as smtp:
            smtp.send_message(mime)

    async def send(self, message: EmailMessage, idempotency_key: str) -> None:
        mime = self._build(message, idempotency_key)
        try:
            await asyncio.to_thread(self._deliver, mime)
        except smtplib.SMTPRecipientsRefused as exc:
            # D39: the address was refused, so trying again changes nothing.
            raise EmailDeliveryError(
                FailureKind.PERMANENT, error_summary(type(exc).__name__)
            ) from None
        except smtplib.SMTPResponseException as exc:
            raise EmailDeliveryError(
                FailureKind.TEMPORARY, error_summary(type(exc).__name__, exc.smtp_code)
            ) from None
        except (smtplib.SMTPException, OSError) as exc:  # Includes timeouts.
            raise EmailDeliveryError(
                FailureKind.TEMPORARY, error_summary(type(exc).__name__)
            ) from None
