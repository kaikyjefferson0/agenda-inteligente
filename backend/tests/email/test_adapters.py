"""D34 to D36 and D41: the adapters, the factory and the configuration."""

import json
import smtplib
from email.message import EmailMessage as MimeMessage
from typing import Any

import httpx
from pydantic import ValidationError
from pytest import MonkeyPatch, mark, raises

from app.core.config import Settings
from app.domain.email_retry import FailureKind
from app.email.factory import build_sender
from app.email.fake import FakeSender
from app.email.resend import RESEND_URL, ResendSender
from app.email.sender import EmailDeliveryError, EmailMessage
from app.email.smtp import SmtpSender

pytestmark = mark.anyio

MESSAGE = EmailMessage(
    "cliente@example.com", "Assunto", "Texto simples", "<p>HTML simples</p>"
)
KEY = "0b8e6a0c-0000-4000-8000-000000000001"
SECRETS = {
    "database_url": "postgresql+asyncpg://x",
    "jwt_secret": "j" * 32,
    "rate_limit_key_secret": "r" * 32,
}


def resend_answering(
    status_code: int, requests: list[httpx.Request] | None = None
) -> ResendSender:
    def handler(request: httpx.Request) -> httpx.Response:
        if requests is not None:
            requests.append(request)
        return httpx.Response(status_code, json={"message": "cliente@example.com"})

    return ResendSender(
        "re_chave", "Agenda <a@app.test>", transport=httpx.MockTransport(handler)
    )


async def test_d36_resend_receives_the_message_and_the_idempotency_key() -> None:
    requests: list[httpx.Request] = []

    await resend_answering(200, requests).send(MESSAGE, KEY)

    [request] = requests
    assert request.method == "POST"
    assert str(request.url) == RESEND_URL
    assert request.headers["Authorization"] == "Bearer re_chave"
    assert request.headers["Idempotency-Key"] == KEY
    assert json.loads(request.content) == {
        "from": "Agenda <a@app.test>",
        "to": ["cliente@example.com"],
        "subject": "Assunto",
        "text": "Texto simples",
        "html": "<p>HTML simples</p>",
    }


@mark.parametrize(
    ("status_code", "kind"),
    [
        (400, FailureKind.PERMANENT),
        (401, FailureKind.PERMANENT),
        (403, FailureKind.PERMANENT),
        (422, FailureKind.PERMANENT),
        (429, FailureKind.TEMPORARY),
        (500, FailureKind.TEMPORARY),
        (503, FailureKind.TEMPORARY),
    ],
)
async def test_d39_each_resend_answer_is_classified(
    status_code: int, kind: FailureKind
) -> None:
    with raises(EmailDeliveryError) as refused:
        await resend_answering(status_code).send(MESSAGE, KEY)

    assert refused.value.kind is kind
    # D40: the type and the code, never the body, which echoes the recipient.
    assert refused.value.summary == f"HTTPStatusError {status_code}"
    assert refused.value.__cause__ is None


@mark.parametrize(
    "error",
    [httpx.ConnectTimeout("t"), httpx.ReadTimeout("t"), httpx.ConnectError("c")],
)
async def test_d39_network_errors_with_resend_are_temporary(
    error: httpx.HTTPError,
) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        raise error

    sender = ResendSender("k", "a@b.test", transport=httpx.MockTransport(handler))

    with raises(EmailDeliveryError) as refused:
        await sender.send(MESSAGE, KEY)

    assert refused.value.kind is FailureKind.TEMPORARY
    assert refused.value.summary == type(error).__name__


class FakeSmtp:
    """Stands in for smtplib.SMTP; `error` is raised by send_message."""

    sent: list[MimeMessage] = []
    error: Exception | None = None
    opened: list[tuple[str, int, float]] = []

    def __init__(self, host: str, port: int, timeout: float) -> None:
        type(self).opened.append((host, port, timeout))

    def __enter__(self) -> FakeSmtp:
        return self

    def __exit__(self, *_: Any) -> None:
        return None

    def send_message(self, message: MimeMessage) -> None:
        if type(self).error is not None:
            raise type(self).error
        type(self).sent.append(message)


def use_fake_smtp(monkeypatch: MonkeyPatch, error: Exception | None = None) -> None:
    FakeSmtp.sent, FakeSmtp.opened, FakeSmtp.error = [], [], error
    monkeypatch.setattr(smtplib, "SMTP", FakeSmtp)


async def test_d35_smtp_sends_text_and_html(monkeypatch: MonkeyPatch) -> None:
    use_fake_smtp(monkeypatch)

    await SmtpSender("mailpit", 1025, "Agenda <a@app.test>").send(MESSAGE, KEY)

    assert FakeSmtp.opened == [("mailpit", 1025, 10.0)]
    [mime] = FakeSmtp.sent
    assert mime["From"] == "Agenda <a@app.test>"
    assert mime["To"] == "cliente@example.com"
    assert mime["Subject"] == "Assunto"
    assert KEY in mime["Message-ID"]
    text = mime.get_body(("plain",))
    html = mime.get_body(("html",))
    assert text is not None and html is not None
    assert text.get_content().strip() == "Texto simples"
    assert html.get_content().strip() == "<p>HTML simples</p>"


@mark.parametrize(
    ("error", "kind", "summary"),
    [
        (
            smtplib.SMTPRecipientsRefused(
                {"cliente@example.com": (550, b"no such user")}
            ),
            FailureKind.PERMANENT,
            "SMTPRecipientsRefused",
        ),
        (
            smtplib.SMTPDataError(451, b"try later cliente@example.com"),
            FailureKind.TEMPORARY,
            "SMTPDataError 451",
        ),
        (
            smtplib.SMTPServerDisconnected("gone"),
            FailureKind.TEMPORARY,
            "SMTPServerDisconnected",
        ),
        (
            ConnectionRefusedError("refused"),
            FailureKind.TEMPORARY,
            "ConnectionRefusedError",
        ),
        (TimeoutError("slow"), FailureKind.TEMPORARY, "TimeoutError"),
    ],
)
async def test_d39_smtp_errors_are_classified(
    monkeypatch: MonkeyPatch, error: Exception, kind: FailureKind, summary: str
) -> None:
    use_fake_smtp(monkeypatch, error)

    with raises(EmailDeliveryError) as refused:
        await SmtpSender("mailpit", 1025, "a@app.test").send(MESSAGE, KEY)

    assert refused.value.kind is kind
    assert refused.value.summary == summary
    assert "cliente@example.com" not in refused.value.summary


async def test_the_fake_sender_counts_failures_before_accepting() -> None:
    sender = FakeSender()
    sender.fail_next(FailureKind.TEMPORARY)
    sender.fail_next(FailureKind.PERMANENT)

    kinds = []
    for _ in range(2):
        with raises(EmailDeliveryError) as refused:
            await sender.send(MESSAGE, KEY)
        kinds.append(refused.value.kind)
    await sender.send(MESSAGE, KEY)

    assert kinds == [FailureKind.TEMPORARY, FailureKind.PERMANENT]
    assert sender.attempts == 3
    assert [item.idempotency_key for item in sender.sent] == [KEY]


def test_d41_the_defaults_point_to_mailpit(monkeypatch: MonkeyPatch) -> None:
    for name in ("EMAIL_BACKEND", "EMAIL_FROM", "SMTP_HOST", "SMTP_PORT"):
        monkeypatch.delenv(name, raising=False)

    settings = Settings(**SECRETS)

    assert settings.email_backend == "smtp"
    assert settings.email_from == "Agenda Inteligente <nao-responda@localhost>"
    assert (settings.smtp_host, settings.smtp_port) == ("mailpit", 1025)
    assert isinstance(build_sender(settings), SmtpSender)


@mark.parametrize("key", [None, ""], ids=["absent", "empty"])
def test_d41_resend_without_the_key_does_not_start(key: str | None) -> None:
    with raises(ValidationError, match="RESEND_API_KEY"):
        Settings(**SECRETS, email_backend="resend", resend_api_key=key)


def test_d41_resend_with_the_key_builds_its_adapter() -> None:
    settings = Settings(**SECRETS, email_backend="resend", resend_api_key="re_123")

    assert isinstance(build_sender(settings), ResendSender)
    assert "re_123" not in repr(settings)


def test_d41_the_fake_backend_builds_the_fake_sender() -> None:
    settings = Settings(**SECRETS, email_backend="fake")

    assert isinstance(build_sender(settings), FakeSender)


def test_d35_the_console_backend_no_longer_exists() -> None:
    with raises(ValidationError):
        Settings(**SECRETS, email_backend="console")
