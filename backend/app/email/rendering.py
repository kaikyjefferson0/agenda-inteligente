"""D37: subject, plain text and simple HTML for each template, in Portuguese.

Pure functions over the outbox payload. No free text typed by the customer
reaches them (D10), and what the Owner typed is escaped in the HTML.
"""

import html
import unicodedata
from collections.abc import Callable, Mapping
from dataclasses import dataclass
from datetime import datetime
from typing import Any

from app.email.sender import EmailMessage
from app.email.templates import EmailTemplate

# Fixed in the code, so the result never depends on the locale of the system.
WEEKDAYS = (
    "segunda-feira",
    "terça-feira",
    "quarta-feira",
    "quinta-feira",
    "sexta-feira",
    "sábado",
    "domingo",
)
SIGNATURE = "Agenda Inteligente"
LINK_STILL_VALID = (
    "O link que você recebeu na confirmação continua valendo para consultar, "
    "cancelar ou remarcar."
)
MANAGE_LINK = "Para consultar, cancelar ou remarcar, acesse:"


class TemplateError(ValueError):
    """The payload does not fit the template, which will not change by retrying."""


@dataclass(frozen=True)
class RenderedEmail:
    subject: str
    text: str
    html: str

    def to(self, recipient: str) -> EmailMessage:
        return EmailMessage(recipient, self.subject, self.text, self.html)


def format_instant(value: str) -> str:
    """In the offset of the payload, e.g. "terça-feira, 10/11/2026 às 09:00"."""
    instant = datetime.fromisoformat(value)
    if instant.tzinfo is None:
        raise TemplateError("instants need an offset")
    return f"{WEEKDAYS[instant.weekday()]}, {instant:%d/%m/%Y} às {instant:%H:%M}"


def _one_line(value: str) -> str:
    """Line breaks in a header would be refused by SMTP or start a new header."""
    cleaned = "".join(
        " " if unicodedata.category(char) == "Cc" else char for char in value
    )
    return " ".join(cleaned.split())


@dataclass(frozen=True)
class _Content:
    """What every template has: a subject, paragraphs, details and a link."""

    subject: str
    paragraphs: tuple[str, ...]
    details: tuple[tuple[str, str], ...] = ()
    link: tuple[str, str] | None = None  # (introduction, url)
    closing: tuple[str, ...] = ()


def _text(content: _Content) -> str:
    lines: list[str] = []
    for paragraph in content.paragraphs:
        lines += [paragraph, ""]
    for label, value in content.details:
        lines.append(f"{label}: {value}")
    if content.details:
        lines.append("")
    if content.link is not None:
        introduction, url = content.link
        lines += [introduction, url, ""]
    for paragraph in content.closing:
        lines += [paragraph, ""]
    lines.append(SIGNATURE)
    return "\n".join(lines) + "\n"


def _html(content: _Content) -> str:
    escape = html.escape
    parts = [f"<p>{escape(paragraph)}</p>" for paragraph in content.paragraphs]
    if content.details:
        items = "".join(
            f"<li><strong>{escape(label)}:</strong> {escape(value)}</li>"
            for label, value in content.details
        )
        parts.append(f"<ul>{items}</ul>")
    if content.link is not None:
        introduction, url = content.link
        link = escape(url, quote=True)
        parts.append(f'<p>{escape(introduction)}<br><a href="{link}">{link}</a></p>')
    parts += [f"<p>{escape(paragraph)}</p>" for paragraph in content.closing]
    parts.append(f"<p>{SIGNATURE}</p>")
    body = "\n".join(parts)
    return (
        '<!doctype html>\n<html lang="pt-BR">\n<head><meta charset="utf-8">'
        f"<title>{escape(content.subject)}</title></head>\n<body>\n{body}\n"
        "</body>\n</html>\n"
    )


def _appointment_details(payload: Mapping[str, Any]) -> tuple[tuple[str, str], ...]:
    return (
        ("Serviço", payload["service_name"]),
        ("Profissional", payload["professional_name"]),
        ("Horário", format_instant(payload["starts_at"])),
    )


def _account_invite(payload: Mapping[str, Any]) -> _Content:
    business = payload["business_name"]
    return _Content(
        subject=f"Convite para a equipe de {business}",
        paragraphs=(
            f"Você recebeu um convite para a equipe de {business} "
            "na Agenda Inteligente.",
        ),
        link=("Para criar sua senha e aceitar o convite, acesse:", payload["url"]),
        closing=(
            f"O convite vale até {format_instant(payload['expires_at'])}.",
            "Se você não esperava este convite, ignore este e-mail.",
        ),
    )


def _password_reset(payload: Mapping[str, Any]) -> _Content:
    business = payload["business_name"]
    return _Content(
        subject=f"Recuperação de senha em {business}",
        paragraphs=(
            f"Recebemos um pedido para redefinir a senha da sua conta em {business}.",
        ),
        link=("Para escolher uma nova senha, acesse:", payload["url"]),
        closing=(
            f"O link vale até {format_instant(payload['expires_at'])} "
            "e pode ser usado uma única vez.",
            "Se você não fez esse pedido, ignore este e-mail; sua senha continua a "
            "mesma.",
        ),
    )


def _appointment_confirmation(payload: Mapping[str, Any]) -> _Content:
    business = payload["business_name"]
    return _Content(
        subject=f"Agendamento confirmado em {business}",
        paragraphs=(f"Seu agendamento em {business} está confirmado.",),
        details=_appointment_details(payload),
        link=(MANAGE_LINK, payload["url"]),
    )


def _appointment_cancellation(payload: Mapping[str, Any]) -> _Content:
    business = payload["business_name"]
    return _Content(
        subject=f"Agendamento cancelado em {business}",
        paragraphs=(f"Seu agendamento em {business} foi cancelado.",),
        details=_appointment_details(payload),
    )


def _appointment_reschedule(payload: Mapping[str, Any]) -> _Content:
    """With `url` from the customer link; with `link_still_valid` from the team."""
    business = payload["business_name"]
    url = payload.get("url")
    return _Content(
        subject=f"Agendamento remarcado em {business}",
        paragraphs=(
            f"Seu agendamento em {business} foi remarcado para um novo horário.",
        ),
        details=_appointment_details(payload),
        link=None if url is None else (MANAGE_LINK, url),
        closing=(LINK_STILL_VALID,)
        if url is None and payload.get("link_still_valid") is True
        else (),
    )


_BUILDERS: dict[EmailTemplate, Callable[[Mapping[str, Any]], _Content]] = {
    EmailTemplate.ACCOUNT_INVITE: _account_invite,
    EmailTemplate.PASSWORD_RESET: _password_reset,
    EmailTemplate.APPOINTMENT_CONFIRMATION: _appointment_confirmation,
    EmailTemplate.APPOINTMENT_CANCELLATION: _appointment_cancellation,
    EmailTemplate.APPOINTMENT_RESCHEDULE: _appointment_reschedule,
}


def render(template: str, payload: Mapping[str, Any]) -> RenderedEmail:
    """Raises TemplateError for an unknown template or a payload that misses data."""
    try:
        content = _BUILDERS[EmailTemplate(template)](payload)
        return RenderedEmail(
            subject=_one_line(content.subject),
            text=_text(content),
            html=_html(content),
        )
    except TemplateError:
        raise
    except (AttributeError, KeyError, TypeError, ValueError) as exc:
        raise TemplateError(type(exc).__name__) from None
