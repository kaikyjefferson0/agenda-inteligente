from typing import Any

from httpx import AsyncClient
from pydantic import SecretStr
from pytest import fixture
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import Settings
from tests.auth.helpers import Clock, register_owner
from tests.configuration.helpers import (
    MONDAY,
    create_service,
    get_business,
    interval,
    next_local,
    put_hours,
    start_serving,
)
from tests.demo.helpers import DEMO_PASSWORD
from tests.public.helpers import (
    OTHER_SLUG,
    booking_body,
    link_services,
    post_booking,
)

OTHER_OWNER_EMAIL = "outra-dona@example.com"


@fixture
def settings(settings: Settings) -> Settings:
    """The suite's settings, with the password the job demands (D46)."""
    return settings.model_copy(update={"demo_password": SecretStr(DEMO_PASSWORD)})


@fixture
async def other_business(
    client: AsyncClient, db: AsyncSession, clock: Clock
) -> dict[str, Any]:
    """A real business with a session, a service, hours and a public booking.

    The booking leaves a pending confirmation to CUSTOMER_EMAIL in the outbox.
    """
    registered = await register_owner(client, OTHER_SLUG, OTHER_OWNER_EMAIL)
    token = registered.json()["access_token"]
    service = await create_service(client, token, name="Outro serviço")
    professional = await start_serving(client, token)
    await link_services(client, token, professional["id"], service["id"])
    hours = await put_hours(
        client, token, professional["id"], interval(MONDAY, "09:00", "18:00")
    )
    assert hours.status_code == 200, hours.text
    starts_at = next_local(clock.now, MONDAY, "10:00")
    response = await post_booking(
        client, booking_body(service["id"], starts_at), slug=OTHER_SLUG
    )
    assert response.status_code == 201, response.text
    business = await get_business(db, OTHER_SLUG)
    return {"token": token, "business_id": business.id}
