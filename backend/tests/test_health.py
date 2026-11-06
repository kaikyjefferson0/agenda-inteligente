from httpx import ASGITransport, AsyncClient, Response
from pytest import fixture, mark
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.core.config import get_settings
from app.core.database import get_session
from app.main import app

pytestmark = mark.anyio


@fixture
def anyio_backend() -> str:
    return "asyncio"


async def get_health(database_url: str) -> Response:
    engine = create_async_engine(database_url, poolclass=NullPool)

    async def override_session():
        session: AsyncSession
        async with async_sessionmaker(engine)() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.get("/health")
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def test_health_returns_ok_when_database_is_available() -> None:
    response = await get_health(get_settings().database_url)

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


async def test_health_returns_problem_when_database_is_unavailable() -> None:
    closed_port_url = make_url(get_settings().database_url).set(port=1)

    response = await get_health(closed_port_url.render_as_string(hide_password=False))

    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["status"] == 503
    assert body["code"] == "DATABASE_UNAVAILABLE"
