import hashlib
import json
from collections.abc import Iterable
from dataclasses import dataclass
from datetime import datetime
from uuid import UUID


@dataclass(frozen=True)
class BookingCandidate:
    """A professional who is eligible and free at the requested time."""

    professional_id: UUID
    registered_at: datetime
    appointments_that_day: int


def choose_professional(candidates: Iterable[BookingCandidate]) -> UUID | None:
    """RN10: fewest appointments that day, then oldest registration, then lowest id."""
    chosen = min(
        candidates,
        key=lambda candidate: (
            candidate.appointments_that_day,
            candidate.registered_at,
            candidate.professional_id,
        ),
        default=None,
    )
    return None if chosen is None else chosen.professional_id


def booking_fingerprint(
    *,
    service_id: UUID,
    professional_id: UUID | None,
    starts_at: datetime,
    customer_name: str,
    customer_email: str,
    customer_phone: str,
) -> str:
    """RN13: the hash of the validated data, as sent.

    The time keeps the offset it was sent with. A real retry repeats the request,
    so any difference is treated as different data and refused.
    """
    data = [
        str(service_id),
        None if professional_id is None else str(professional_id),
        starts_at.isoformat(),
        customer_name,
        customer_email,
        customer_phone,
    ]
    return hashlib.sha256(json.dumps(data).encode()).hexdigest()
