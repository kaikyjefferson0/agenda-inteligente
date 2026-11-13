"""D94: the real bodies match the schemas the OpenAPI declares.

They go out as `application/problem+json`, although the OpenAPI lists them as
`application/json`, like the 422 (see tests/test_openapi_contract.py).
"""

from datetime import timedelta
from typing import Any

from httpx import AsyncClient, Response
from pydantic import BaseModel, TypeAdapter
from pytest import mark
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.professionals import TimeBlockConflict
from app.schemas.problems import (
    AppointmentConflictsProblem,
    TimeBlockOverlapProblem,
    ValidationProblem,
)
from app.schemas.professionals import ProfessionalData
from tests.auth.helpers import API, Clock, bearer
from tests.configuration.helpers import (
    MONDAY,
    Member,
    create_service,
    make_appointment,
    next_local,
)

pytestmark = mark.anyio

PROBLEM = "application/problem+json"


def assert_exactly(model: type[BaseModel], body: dict[str, Any]) -> None:
    """Every field of the body is declared, and every declared one is there."""
    model.model_validate(body)
    assert set(body) == set(model.model_fields)


async def post_block(
    client: AsyncClient, token: str, professional_id: str, starts_at: Any
) -> Response:
    return await client.post(
        f"{API}/professionals/{professional_id}/time-blocks",
        json={
            "starts_at": starts_at.isoformat(),
            "ends_at": (starts_at + timedelta(hours=1)).isoformat(),
            "reason": "Folga",
        },
        headers=bearer(token),
    )


async def test_block_over_an_appointment_matches_its_schema(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str, pro: Member
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "10:00")
    await make_appointment(db, pro.professional_id, service["id"], starts_at)

    response = await post_block(client, pro.token, pro.professional_id, starts_at)

    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM
    body = response.json()
    parsed = TypeAdapter(TimeBlockConflict).validate_python(body)
    assert isinstance(parsed, AppointmentConflictsProblem)
    assert_exactly(AppointmentConflictsProblem, body)
    assert len(parsed.conflicts) == 1


async def test_block_over_a_block_matches_its_schema(
    client: AsyncClient, clock: Clock, pro: Member
) -> None:
    starts_at = next_local(clock.now, MONDAY, "10:00")
    assert (
        await post_block(client, pro.token, pro.professional_id, starts_at)
    ).is_success

    response = await post_block(client, pro.token, pro.professional_id, starts_at)

    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM
    body = response.json()
    parsed = TypeAdapter(TimeBlockConflict).validate_python(body)
    assert isinstance(parsed, TimeBlockOverlapProblem)
    assert_exactly(TimeBlockOverlapProblem, body)


async def test_deactivation_with_appointments_matches_its_schema(
    client: AsyncClient, db: AsyncSession, clock: Clock, owner_token: str, pro: Member
) -> None:
    service = await create_service(client, owner_token)
    starts_at = next_local(clock.now, MONDAY, "10:00")
    await make_appointment(db, pro.professional_id, service["id"], starts_at)

    response = await client.post(
        f"{API}/professionals/{pro.professional_id}/deactivate",
        headers=bearer(owner_token),
    )

    assert response.status_code == 409
    assert response.headers["content-type"] == PROBLEM
    assert_exactly(AppointmentConflictsProblem, response.json())


async def test_repeated_start_serving_returns_the_body_of_the_201(
    client: AsyncClient, owner_token: str
) -> None:
    first = await client.post(f"{API}/professionals/me", headers=bearer(owner_token))
    again = await client.post(f"{API}/professionals/me", headers=bearer(owner_token))

    assert (first.status_code, again.status_code) == (201, 200)
    assert_exactly(ProfessionalData, again.json())
    assert again.json() == first.json()


async def test_framework_422_matches_the_validation_problem(
    client: AsyncClient, pro: Member
) -> None:
    response = await client.post(
        f"{API}/professionals/{pro.professional_id}/time-blocks",
        json={"reason": ""},
        headers=bearer(pro.token),
    )

    assert response.status_code == 422
    assert response.headers["content-type"] == PROBLEM
    body = response.json()
    assert_exactly(ValidationProblem, body)
    assert {tuple(item["loc"]) for item in body["errors"]} >= {("body", "starts_at")}


async def test_422_of_a_stored_rule_matches_the_validation_problem(
    client: AsyncClient, owner_token: str
) -> None:
    response = await client.patch(
        f"{API}/business",
        json={"min_advance_minutes": 525600, "max_advance_days": 1},
        headers=bearer(owner_token),
    )

    assert response.status_code == 422
    body = response.json()
    assert_exactly(ValidationProblem, body)
    assert body["errors"][0]["loc"] == ["body", "min_advance_minutes"]
