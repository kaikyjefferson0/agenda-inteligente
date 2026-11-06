from datetime import UTC, datetime, timedelta
from typing import Any
from uuid import UUID
from zoneinfo import ZoneInfo

from pytest import mark

from app.domain.booking import (
    BookingCandidate,
    booking_fingerprint,
    choose_professional,
)

FIRST = UUID(int=1)
SECOND = UUID(int=2)
THIRD = UUID(int=3)
OLDER = datetime(2030, 1, 1, tzinfo=UTC)
NEWER = OLDER + timedelta(days=1)


def candidate(
    professional_id: UUID, appointments: int = 0, registered_at: datetime = OLDER
) -> BookingCandidate:
    return BookingCandidate(professional_id, registered_at, appointments)


def test_ct07_chooses_the_fewest_appointments_that_day() -> None:
    chosen = choose_professional(
        [
            candidate(FIRST, appointments=2),
            candidate(SECOND, appointments=1, registered_at=NEWER),
            candidate(THIRD, appointments=3),
        ]
    )

    assert chosen == SECOND


def test_ct07_a_tie_goes_to_the_oldest_registration() -> None:
    chosen = choose_professional(
        [
            candidate(FIRST, registered_at=NEWER),
            candidate(SECOND, registered_at=OLDER),
        ]
    )

    assert chosen == SECOND


def test_ct07_a_full_tie_goes_to_the_lowest_id() -> None:
    assert choose_professional([candidate(THIRD), candidate(FIRST)]) == FIRST


def test_ct07_the_result_does_not_depend_on_the_order() -> None:
    candidates = [
        candidate(FIRST, appointments=1),
        candidate(SECOND, registered_at=NEWER),
        candidate(THIRD),
    ]

    assert choose_professional(candidates) == THIRD
    assert choose_professional(reversed(candidates)) == THIRD


def test_ct07_no_candidates_means_no_professional() -> None:
    assert choose_professional([]) is None


def fingerprint(**changes: Any) -> str:
    data: dict[str, Any] = {
        "service_id": FIRST,
        "professional_id": None,
        "starts_at": OLDER,
        "customer_name": "Cliente",
        "customer_email": "cliente@example.com",
        "customer_phone": "+5511999999999",
    }
    return booking_fingerprint(**{**data, **changes})


def test_same_data_has_the_same_fingerprint() -> None:
    assert fingerprint() == fingerprint()


@mark.parametrize(
    "changes",
    [
        {"service_id": SECOND},
        {"professional_id": SECOND},
        {"starts_at": OLDER + timedelta(minutes=15)},
        {"customer_name": "Outra"},
        {"customer_email": "outra@example.com"},
        {"customer_phone": "+5511888888888"},
    ],
)
def test_any_different_field_changes_the_fingerprint(changes: dict[str, Any]) -> None:
    assert fingerprint(**changes) != fingerprint()


def test_the_same_instant_with_another_offset_counts_as_different_data() -> None:
    same_instant = OLDER.astimezone(ZoneInfo("America/Sao_Paulo"))

    assert same_instant == OLDER
    assert fingerprint(starts_at=same_instant) != fingerprint()


def test_a_different_email_case_counts_as_different_data() -> None:
    assert fingerprint(customer_email="Cliente@example.com") != fingerprint()


def test_fingerprint_does_not_contain_the_customer_data() -> None:
    assert "cliente" not in fingerprint()
    assert len(fingerprint()) == 64
