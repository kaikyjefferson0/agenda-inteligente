"""CT57 and D37: the five templates, rendered without the database."""

from typing import Any

from pytest import mark, raises

from app.email.rendering import (
    LINK_STILL_VALID,
    TemplateError,
    format_instant,
    render,
)
from app.email.templates import EmailTemplate
from tests.email.helpers import CONFIRMATION_PAYLOAD, URL
from tests.public.helpers import CUSTOMER_NAME, CUSTOMER_PHONE

SCRIPT = "<script>alert(1)</script>"
APPOINTMENT = {
    "business_name": "Barbearia",
    "service_name": "Corte",
    "professional_name": "Profissional",
    "starts_at": "2026-11-10T09:00:00-03:00",
}
ACCOUNT = {
    "url": "https://app.test/convite/token-de-convite",
    "business_name": "Barbearia",
    "expires_at": "2026-11-17T09:00:00-03:00",
}
PAYLOADS: dict[EmailTemplate, dict[str, Any]] = {
    EmailTemplate.ACCOUNT_INVITE: ACCOUNT,
    EmailTemplate.PASSWORD_RESET: {
        **ACCOUNT,
        "url": "https://app.test/recuperar-senha/token-de-recuperacao",
    },
    EmailTemplate.APPOINTMENT_CONFIRMATION: CONFIRMATION_PAYLOAD,
    EmailTemplate.APPOINTMENT_CANCELLATION: APPOINTMENT,
    EmailTemplate.APPOINTMENT_RESCHEDULE: {**APPOINTMENT, "url": URL},
}
SUBJECTS = {
    EmailTemplate.ACCOUNT_INVITE: "Convite para a equipe de Barbearia",
    EmailTemplate.PASSWORD_RESET: "Recuperação de senha em Barbearia",
    EmailTemplate.APPOINTMENT_CONFIRMATION: "Agendamento confirmado em Barbearia",
    EmailTemplate.APPOINTMENT_CANCELLATION: "Agendamento cancelado em Barbearia",
    EmailTemplate.APPOINTMENT_RESCHEDULE: "Agendamento remarcado em Barbearia",
}


@mark.parametrize("template", list(EmailTemplate))
def test_ct57_every_template_has_subject_text_and_html(template: EmailTemplate) -> None:
    rendered = render(template, PAYLOADS[template])

    assert rendered.subject == SUBJECTS[template]
    assert "Barbearia" in rendered.text
    assert rendered.html.startswith("<!doctype html>")
    assert '<html lang="pt-BR">' in rendered.html
    # D10: nothing of the customer, who is never in the payload either.
    for value in (CUSTOMER_NAME, CUSTOMER_PHONE, "cliente@example.com"):
        assert value not in rendered.text
        assert value not in rendered.html


@mark.parametrize("template", list(EmailTemplate))
def test_ct57_names_typed_by_the_owner_are_escaped_in_the_html(
    template: EmailTemplate,
) -> None:
    payload = {
        key: SCRIPT if key.endswith("_name") else value
        for key, value in PAYLOADS[template].items()
    }

    rendered = render(template, payload)

    assert "<script>" not in rendered.html
    assert "&lt;script&gt;alert(1)&lt;/script&gt;" in rendered.html
    # Plain text is not HTML, so it keeps the name as typed.
    assert SCRIPT in rendered.text


@mark.parametrize(
    "template",
    [
        EmailTemplate.APPOINTMENT_CONFIRMATION,
        EmailTemplate.APPOINTMENT_CANCELLATION,
        EmailTemplate.APPOINTMENT_RESCHEDULE,
    ],
)
def test_ct57_the_time_is_in_the_offset_of_the_business(
    template: EmailTemplate,
) -> None:
    rendered = render(template, PAYLOADS[template])

    expected = "terça-feira, 10/11/2026 às 09:00"
    assert f"Horário: {expected}" in rendered.text
    assert expected in rendered.html
    assert "Serviço: Corte" in rendered.text
    assert "Profissional: Profissional" in rendered.text


@mark.parametrize(
    ("value", "expected"),
    [
        ("2026-11-09T08:05:00-03:00", "segunda-feira, 09/11/2026 às 08:05"),
        ("2026-11-10T09:00:00-03:00", "terça-feira, 10/11/2026 às 09:00"),
        ("2026-11-11T23:59:00-03:00", "quarta-feira, 11/11/2026 às 23:59"),
        ("2026-11-12T00:00:00-03:00", "quinta-feira, 12/11/2026 às 00:00"),
        ("2026-11-13T10:30:00-03:00", "sexta-feira, 13/11/2026 às 10:30"),
        ("2026-11-14T10:30:00-03:00", "sábado, 14/11/2026 às 10:30"),
        ("2026-11-15T10:30:00-03:00", "domingo, 15/11/2026 às 10:30"),
        # The same instant in UTC: the offset received decides the clock.
        ("2026-11-10T12:00:00+00:00", "terça-feira, 10/11/2026 às 12:00"),
        ("2026-11-11T02:30:00+00:00", "quarta-feira, 11/11/2026 às 02:30"),
    ],
)
def test_d37_the_time_format_does_not_depend_on_the_locale(
    value: str, expected: str
) -> None:
    assert format_instant(value) == expected


def test_d37_the_customer_reschedule_shows_the_link() -> None:
    rendered = render(EmailTemplate.APPOINTMENT_RESCHEDULE, {**APPOINTMENT, "url": URL})

    assert URL in rendered.text
    assert f'href="{URL}"' in rendered.html
    assert LINK_STILL_VALID not in rendered.text


def test_d37_the_team_reschedule_says_the_link_still_works() -> None:
    rendered = render(
        EmailTemplate.APPOINTMENT_RESCHEDULE,
        {**APPOINTMENT, "link_still_valid": True},
    )

    assert LINK_STILL_VALID in rendered.text
    assert LINK_STILL_VALID in rendered.html
    assert "http" not in rendered.text
    assert "href" not in rendered.html


def test_d37_the_cancellation_has_no_link() -> None:
    rendered = render(EmailTemplate.APPOINTMENT_CANCELLATION, APPOINTMENT)

    assert "http" not in rendered.text
    assert "href" not in rendered.html


@mark.parametrize(
    "template", [EmailTemplate.ACCOUNT_INVITE, EmailTemplate.PASSWORD_RESET]
)
def test_d37_account_emails_show_the_link_and_the_local_expiry(
    template: EmailTemplate,
) -> None:
    payload = PAYLOADS[template]

    rendered = render(template, payload)

    assert payload["url"] in rendered.text
    assert "terça-feira, 17/11/2026 às 09:00" in rendered.text
    assert "UTC" not in rendered.text
    assert "UTC" not in rendered.html


def test_d37_a_line_break_in_a_name_never_reaches_the_subject() -> None:
    rendered = render(
        EmailTemplate.APPOINTMENT_CANCELLATION,
        {**APPOINTMENT, "business_name": "Barbearia\r\nBcc: alguem@example.com"},
    )

    assert (
        rendered.subject == "Agendamento cancelado em Barbearia Bcc: alguem@example.com"
    )
    assert "\n" not in rendered.subject


def test_d37_the_link_is_escaped_in_the_attribute() -> None:
    rendered = render(
        EmailTemplate.APPOINTMENT_CONFIRMATION,
        {**CONFIRMATION_PAYLOAD, "url": 'https://app.test/a"onclick="x'},
    )

    assert 'href="https://app.test/a&quot;onclick=&quot;x"' in rendered.html


@mark.parametrize(
    ("template", "payload"),
    [
        ("unknown_template", APPOINTMENT),
        (EmailTemplate.APPOINTMENT_CANCELLATION, {}),
        (EmailTemplate.APPOINTMENT_CANCELLATION, {**APPOINTMENT, "starts_at": "x"}),
        (
            EmailTemplate.APPOINTMENT_CANCELLATION,
            {**APPOINTMENT, "starts_at": "2026-11-10T09:00:00"},
        ),
        (EmailTemplate.APPOINTMENT_CANCELLATION, {**APPOINTMENT, "service_name": 1}),
        (EmailTemplate.ACCOUNT_INVITE, {**ACCOUNT, "url": None}),
    ],
    ids=[
        "unknown",
        "empty",
        "bad_time",
        "naive_time",
        "not_text",
        "no_url",
    ],
)
def test_d37_a_payload_that_does_not_fit_is_a_template_error(
    template: str, payload: dict[str, Any]
) -> None:
    with raises(TemplateError):
        render(template, payload)
