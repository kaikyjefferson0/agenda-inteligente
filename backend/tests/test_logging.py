"""The INFO of the app in the host's log, once, without personal data."""

import io
import logging
import runpy
from collections.abc import Iterator

from pytest import fixture, mark

import app.main  # noqa: F401  (configures the logging on import, as under uvicorn)
from app.core.logging import APP_LOGGER, configure_app_logging

UVICORN_LOGGERS = ("uvicorn", "uvicorn.error", "uvicorn.access")


def app_handlers() -> list[logging.Handler]:
    return logging.getLogger(APP_LOGGER).handlers


@fixture
def output() -> Iterator[io.StringIO]:
    """What the handler of the app writes, at INFO as in production.

    The handler holds the stdout of the import, so the stream is swapped here;
    the level is set because caplog in other tests may have changed it.
    """
    logger = logging.getLogger(APP_LOGGER)
    [handler] = app_handlers()
    assert isinstance(handler, logging.StreamHandler)
    level = logger.level
    buffer = io.StringIO()
    previous = handler.setStream(buffer)
    logger.setLevel(logging.INFO)
    yield buffer
    logger.setLevel(level)
    handler.setStream(previous)


def test_an_info_of_a_job_reaches_stdout_once(output: io.StringIO) -> None:
    logging.getLogger("app.jobs.email_worker").info("email worker started")

    lines = output.getvalue().splitlines()

    assert lines == ["INFO app.jobs.email_worker email worker started"]


def test_debug_stays_out(output: io.StringIO) -> None:
    logging.getLogger("app.jobs.cleanup").debug("detail")

    assert output.getvalue() == ""


def test_a_second_call_adds_no_handler() -> None:
    before = list(app_handlers())

    configure_app_logging()
    configure_app_logging(with_time=True)

    assert app_handlers() == before
    assert len(before) == 1


def test_root_and_uvicorn_loggers_are_left_alone() -> None:
    """No handler on the root, and uvicorn keeps its own configuration: no
    line of uvicorn passes through the handler of the app, nor the reverse."""
    root = logging.getLogger()
    [handler] = app_handlers()

    assert handler not in root.handlers
    for name in UVICORN_LOGGERS:
        assert handler not in logging.getLogger(name).handlers


def test_a_customer_link_in_a_message_is_masked(output: io.StringIO) -> None:
    """D24, one more guard: a path with the token never reaches the output."""
    logging.getLogger("app.api.errors").warning(
        "failed at %s", "/api/v1/public/appointments/token-secreto-123/cancel"
    )

    out = output.getvalue()

    assert "token-secreto-123" not in out
    assert "/public/appointments/***/cancel" in out


# The modules were already imported by app.main, as runpy warns: harmless here.
@mark.filterwarnings("ignore::RuntimeWarning:runpy")
@mark.parametrize(
    "module",
    [
        "app.jobs.email_worker",
        "app.jobs.restore_demo",
        "app.scripts.prepare_e2e_database",
    ],
)
def test_the_scripts_log_under_app_even_with_python_m(module: str) -> None:
    """Under `python -m`, __name__ is "__main__", which is not below `app`.

    Run with another name, so __name__ differs from the module without the
    `if __name__ == "__main__"` block starting the script.
    """
    namespace = runpy.run_module(module, run_name="__not_main__")

    assert namespace["__name__"] == "__not_main__"
    assert namespace["logger"].name == module
