"""CT50 and D24: the token of the customer link never reaches the access log."""

import asyncio
import logging
from datetime import datetime, timedelta
from typing import Any

import uvicorn
from httpx import AsyncClient
from pytest import LogCaptureFixture, mark

from app.core.log_filters import (
    ACCESS_LOGGER,
    CustomerTokenFilter,
    install_customer_token_filter,
    mask_customer_token,
)
from app.main import app
from tests.configuration.helpers import Member
from tests.public.helpers import book, link_path, local_iso

pytestmark = mark.anyio


async def test_ct50_the_token_never_reaches_the_access_log(
    client: AsyncClient,
    caplog: LogCaptureFixture,
    service: dict[str, Any],
    pro: Member,
    monday_10: datetime,
) -> None:
    """A real uvicorn server, which writes the access log as in docker compose.

    The `client` fixture leaves the test database and clock in place for the app.
    """
    _, token = await book(client, service["id"], monday_10)
    caplog.set_level(logging.INFO, logger=ACCESS_LOGGER)
    # log_config=None keeps the loggers as they are, so caplog sees the records.
    server = uvicorn.Server(
        uvicorn.Config(app, host="127.0.0.1", port=0, log_config=None, lifespan="off")
    )
    serving = asyncio.create_task(server.serve())
    try:
        while not server.started:
            await asyncio.sleep(0.01)
        port = server.servers[0].sockets[0].getsockname()[1]
        async with AsyncClient(base_url=f"http://127.0.0.1:{port}") as real:
            responses = [
                await real.get(link_path(token)),
                await real.get(f"{link_path(token)}?origem=email"),
                await real.post(
                    f"{link_path(token)}/reschedule",
                    json={"starts_at": local_iso(monday_10 + timedelta(hours=2))},
                ),
                await real.post(f"{link_path(token)}/cancel"),
            ]
    finally:
        server.should_exit = True
        await serving

    assert [item.status_code for item in responses] == [200, 200, 200, 200]
    lines = [
        record.getMessage() for record in caplog.records if record.name == ACCESS_LOGGER
    ]
    assert len(lines) == len(responses)
    for line in lines:
        assert token not in line
        assert "/public/appointments/***" in line


def test_the_filter_is_installed_once_when_the_app_is_imported() -> None:
    install_customer_token_filter()

    filters = logging.getLogger(ACCESS_LOGGER).filters
    assert [type(item) for item in filters].count(CustomerTokenFilter) == 1


def test_the_filter_rewrites_the_arguments_and_the_message() -> None:
    record = logging.LogRecord(
        ACCESS_LOGGER,
        logging.INFO,
        __file__,
        1,
        '%s - "%s %s HTTP/%s" %d /public/appointments/segredo',
        (
            "127.0.0.1:5000",
            "GET",
            "/api/v1/public/appointments/segredo/cancel",
            "1.1",
            200,
        ),
        None,
    )

    assert CustomerTokenFilter().filter(record) is True
    assert "segredo" not in record.getMessage()
    assert record.args == (
        "127.0.0.1:5000",
        "GET",
        "/api/v1/public/appointments/***/cancel",
        "1.1",
        200,
    )


def test_other_paths_are_left_as_they_are() -> None:
    path = "/api/v1/public/businesses/barbearia-um/appointments?x=1"

    assert mask_customer_token(path) == path
    assert mask_customer_token("/api/v1/public/appointments/abc?x=1") == (
        "/api/v1/public/appointments/***?x=1"
    )
