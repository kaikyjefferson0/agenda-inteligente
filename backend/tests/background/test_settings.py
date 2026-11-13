"""D105 and D106: the two variables, independent and off by default."""

from pydantic import ValidationError
from pytest import MonkeyPatch, mark, raises

from app.core.config import Settings
from tests.demo.helpers import DEMO_PASSWORD

SECRETS = {
    "database_url": "postgresql+asyncpg://x",
    "jwt_secret": "j" * 32,
    "rate_limit_key_secret": "r" * 32,
}


def test_both_tasks_are_off_by_default() -> None:
    settings = Settings(**SECRETS)

    assert settings.email_worker_in_process is False
    assert settings.demo_restore_in_process is False


def test_the_worker_turns_on_without_the_restoration() -> None:
    # A real installation: e-mails inside the API, no demo, no DEMO_PASSWORD.
    settings = Settings(**SECRETS, email_worker_in_process=True)

    assert settings.email_worker_in_process is True
    assert settings.demo_restore_in_process is False


@mark.parametrize("password", [None, "", "curta"])
def test_the_restoration_does_not_start_without_a_valid_demo_password(
    password: str | None,
) -> None:
    with raises(ValidationError, match="DEMO_RESTORE_IN_PROCESS requires"):
        Settings(**SECRETS, demo_restore_in_process=True, demo_password=password)


def test_the_restoration_starts_with_a_valid_demo_password() -> None:
    settings = Settings(
        **SECRETS, demo_restore_in_process=True, demo_password=DEMO_PASSWORD
    )

    assert settings.demo_restore_in_process is True


def test_the_variables_come_from_the_environment(monkeypatch: MonkeyPatch) -> None:
    monkeypatch.setenv("EMAIL_WORKER_IN_PROCESS", "true")
    monkeypatch.setenv("DEMO_RESTORE_IN_PROCESS", "true")
    monkeypatch.setenv("DEMO_PASSWORD", DEMO_PASSWORD)

    settings = Settings(**SECRETS)

    assert settings.email_worker_in_process is True
    assert settings.demo_restore_in_process is True
