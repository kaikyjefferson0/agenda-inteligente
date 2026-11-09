"""D43 and D44: what the demo business holds after every restoration.

The ids are fixed (D42), so the slug, the ids and the accounts stay the same
from one restoration to the next. The rows that depend on the date take an id
derived from `ID_NAMESPACE` and a key that is stable for the same day.
"""

import unicodedata
from dataclasses import dataclass
from datetime import time
from uuid import UUID, uuid5

from app.domain.demo_schedule import DemoService
from app.models import UserRole

SLUG = "barbearia-demo"
BUSINESS_NAME = "Barbearia Demo"
TIMEZONE = "America/Sao_Paulo"
# The model's default (RN01); the schedule is planned on this grid.
SLOT_STEP_MINUTES = 15

BUSINESS_ID = UUID("de000000-0000-4000-8000-000000000001")
ID_NAMESPACE = UUID("de0000ff-0000-4000-8000-000000000000")

# D44: example.com is reserved for examples (RFC 2606).
STAFF_EMAIL_DOMAIN = "demo.example.com"
CUSTOMER_EMAIL_DOMAIN = "example.com"

# D45: any fixed number works, as long as nothing else uses it.
RESTORE_LOCK_KEY = 0x64656D6F  # "demo"

TIME_BLOCK_REASON = "Curso de atualização"


@dataclass(frozen=True)
class DemoAccount:
    user_id: UUID
    professional_id: UUID
    name: str
    email: str
    role: UserRole


OWNER = DemoAccount(
    user_id=UUID("de000001-0000-4000-8000-000000000001"),
    professional_id=UUID("de000002-0000-4000-8000-000000000001"),
    name="Dono Demo",
    email=f"dono@{STAFF_EMAIL_DOMAIN}",
    role=UserRole.OWNER,
)
PROFESSIONAL = DemoAccount(
    user_id=UUID("de000001-0000-4000-8000-000000000002"),
    professional_id=UUID("de000002-0000-4000-8000-000000000002"),
    name="Profissional Demo",
    email=f"profissional@{STAFF_EMAIL_DOMAIN}",
    role=UserRole.PROFESSIONAL,
)
# The owner also serves (D43). Ordered by id, like the tie in RN10.
ACCOUNTS = (OWNER, PROFESSIONAL)
STAFF_EMAILS = tuple(account.email for account in ACCOUNTS)


@dataclass(frozen=True)
class DemoServiceContent:
    id: UUID
    name: str
    duration_minutes: int
    preparation_minutes: int
    price_cents: int

    @property
    def schedule(self) -> DemoService:
        return DemoService(
            str(self.id), self.duration_minutes, self.preparation_minutes
        )


HAIRCUT = DemoServiceContent(
    UUID("de000003-0000-4000-8000-000000000001"), "Corte de cabelo", 30, 10, 5000
)
BEARD = DemoServiceContent(
    UUID("de000003-0000-4000-8000-000000000002"), "Barba", 20, 5, 3500
)
HAIRCUT_AND_BEARD = DemoServiceContent(
    UUID("de000003-0000-4000-8000-000000000003"), "Corte e barba", 50, 15, 8000
)
EYEBROWS = DemoServiceContent(
    UUID("de000003-0000-4000-8000-000000000004"), "Sobrancelha", 15, 0, 2000
)
SERVICES = (HAIRCUT, BEARD, HAIRCUT_AND_BEARD, EYEBROWS)

# Each professional serves at least two services, and every service is served.
SERVICES_BY_PROFESSIONAL = {
    OWNER.professional_id: (HAIRCUT, HAIRCUT_AND_BEARD, EYEBROWS),
    PROFESSIONAL.professional_id: (HAIRCUT, BEARD, HAIRCUT_AND_BEARD),
}


@dataclass(frozen=True)
class DemoInterval:
    weekday: int
    start_time: time
    end_time: time


# Tuesday (1) to Saturday (5), with a lunch break.
WORKING_HOURS = tuple(
    DemoInterval(weekday, start, end)
    for weekday in range(1, 6)
    for start, end in ((time(9), time(12)), (time(13), time(19)))
)


@dataclass(frozen=True)
class DemoCustomer:
    name: str
    email: str
    phone: str


def _customer(number: int, name: str) -> DemoCustomer:
    plain = unicodedata.normalize("NFKD", name).encode("ascii", "ignore").decode()
    local_part = plain.lower().replace(" ", ".")
    return DemoCustomer(
        name, f"{local_part}@{CUSTOMER_EMAIL_DOMAIN}", f"+55119000000{number:02d}"
    )


# Fictional names. The e-mails drop the accents.
CUSTOMERS = tuple(
    _customer(number, name)
    for number, name in enumerate(
        (
            "Ana Souza",
            "Bruno Lima",
            "Carla Mendes",
            "Diego Rocha",
            "Elisa Martins",
            "Felipe Costa",
            "Gabriela Alves",
            "Henrique Dias",
            "Isabela Nunes",
            "João Pereira",
            "Larissa Gomes",
            "Marcos Ribeiro",
        ),
        start=1,
    )
)
# Every fourth appointment was made by the team without e-mail nor token.
STAFF_WITHOUT_EMAIL_EVERY = 4


def derived_id(kind: str, key: str) -> UUID:
    """A fixed id for a row that depends on the date (D42)."""
    return uuid5(ID_NAMESPACE, f"{kind}/{key}")
