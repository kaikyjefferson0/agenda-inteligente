from httpx import ASGITransport, AsyncClient, Response
from pytest import fixture, mark
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine
from sqlalchemy.pool import NullPool

from app.api.security_headers import SECURITY_HEADERS
from app.core.config import get_settings
from app.core.database import get_session
from app.main import app

pytestmark = mark.anyio


@fixture
def anyio_backend() -> str:
    return "asyncio"


def closed_port_url() -> str:
    url = make_url(get_settings().database_url).set(port=1)
    return url.render_as_string(hide_password=False)


async def get_with_database(
    path: str, database_url: str, method: str = "GET"
) -> Response:
    engine = create_async_engine(database_url, poolclass=NullPool)

    async def override_session():
        session: AsyncSession
        async with async_sessionmaker(engine)() as session:
            yield session

    app.dependency_overrides[get_session] = override_session
    try:
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as client:
            return await client.request(method, path)
    finally:
        app.dependency_overrides.clear()
        await engine.dispose()


async def test_health_answers_ok_without_the_database() -> None:
    """D118: the host's health check never wakes the database up."""
    response = await get_with_database("/health", closed_port_url())

    assert response.status_code == 200
    assert response.json() == {"status": "ok"}


async def test_ready_returns_ok_when_database_is_available() -> None:
    response = await get_with_database("/ready", get_settings().database_url)

    assert response.status_code == 200
    assert response.json() == {"status": "ok", "database": "ok"}


async def test_ready_returns_problem_when_database_is_unavailable() -> None:
    response = await get_with_database("/ready", closed_port_url())

    assert response.status_code == 503
    assert response.headers["content-type"] == "application/problem+json"
    body = response.json()
    assert body["status"] == 503
    assert body["code"] == "DATABASE_UNAVAILABLE"


async def test_head_health_answers_ok_without_body_nor_database() -> None:
    """Uptime monitors use HEAD: the status of the GET, no body, no query."""
    response = await get_with_database("/health", closed_port_url(), "HEAD")

    assert response.status_code == 200
    assert response.content == b""


@mark.parametrize(
    ("reachable", "status_code"), [(True, 200), (False, 503)], ids=["up", "down"]
)
async def test_head_ready_has_the_status_of_get_without_body(
    reachable: bool, status_code: int
) -> None:
    url = get_settings().database_url if reachable else closed_port_url()

    head = await get_with_database("/ready", url, "HEAD")
    get = await get_with_database("/ready", url)

    assert head.status_code == get.status_code == status_code
    assert head.content == b""


def test_head_routes_stay_out_of_the_openapi() -> None:
    """The frontend's openapi.json (D51) describes only the GETs."""
    paths = app.openapi()["paths"]

    assert set(paths["/health"]) == {"get"}
    assert set(paths["/ready"]) == {"get"}


@mark.parametrize("path", ["/health", "/docs", "/api/v1/nao-existe"])
async def test_every_response_has_the_security_headers(path: str) -> None:
    """D117: success, the Swagger UI and errors alike."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.get(path)

    for name, value in SECURITY_HEADERS.items():
        assert response.headers[name] == value
    assert "content-security-policy" not in response.headers


async def test_cors_preflight_has_the_security_headers() -> None:
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as client:
        response = await client.options(
            "/api/v1/auth/refresh",
            headers={
                "Origin": "https://atacante.example.com",
                "Access-Control-Request-Method": "POST",
            },
        )

    assert response.headers["X-Frame-Options"] == "DENY"
