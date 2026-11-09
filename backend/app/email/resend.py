"""D36: the Resend API, with the message id as the idempotency key."""

import httpx

from app.domain.email_retry import FailureKind, classify_http_status, error_summary
from app.email.sender import EmailDeliveryError, EmailMessage

RESEND_URL = "https://api.resend.com/emails"
TIMEOUT_SECONDS = 10.0


class ResendSender:
    def __init__(
        self,
        api_key: str,
        from_address: str,
        *,
        transport: httpx.AsyncBaseTransport | None = None,
    ) -> None:
        self._api_key = api_key
        self._from_address = from_address
        # Only the tests replace it, with httpx.MockTransport.
        self._transport = transport

    async def send(self, message: EmailMessage, idempotency_key: str) -> None:
        try:
            async with httpx.AsyncClient(
                transport=self._transport, timeout=TIMEOUT_SECONDS
            ) as client:
                response = await client.post(
                    RESEND_URL,
                    headers={
                        "Authorization": f"Bearer {self._api_key}",
                        "Idempotency-Key": idempotency_key,
                    },
                    json={
                        "from": self._from_address,
                        "to": [message.to_email],
                        "subject": message.subject,
                        "text": message.text,
                        "html": message.html,
                    },
                )
                response.raise_for_status()
        except httpx.HTTPStatusError as exc:
            # The body may echo the recipient, so only the code is kept (D40).
            status_code = exc.response.status_code
            raise EmailDeliveryError(
                classify_http_status(status_code),
                error_summary(type(exc).__name__, status_code),
            ) from None
        except httpx.HTTPError as exc:  # Network errors and timeouts.
            raise EmailDeliveryError(
                FailureKind.TEMPORARY, error_summary(type(exc).__name__)
            ) from None
