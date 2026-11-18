import logging
import sys

from app.core.log_filters import CustomerTokenFilter

APP_LOGGER = "app"
# Under the API, the host (Render) stamps each line with the date and time.
APP_LOG_FORMAT = "%(levelname)s %(name)s %(message)s"
# The scripts run in a terminal or in their own container, which do not.
SCRIPT_LOG_FORMAT = "%(asctime)s %(levelname)s %(name)s %(message)s"


class _AppHandler(logging.StreamHandler):  # type: ignore[type-arg]
    """Marks the handler of this module, so a second call finds it."""


def configure_app_logging(*, with_time: bool = False) -> None:
    """The INFO of the loggers of `app.*` (worker, restoration, cleanup...) on stdout.

    Uvicorn configures only its own loggers, which do not propagate to the
    root, and the root has no handler: without this, an INFO of the app is
    dropped and a WARNING comes out bare through the last-resort handler.

    One handler on `app`, and nothing on the root nor on the loggers of
    uvicorn, so no line comes out twice. `app` still propagates, so the root
    stays free for whoever wants every log (pytest's caplog does). The scripts
    call this instead of `logging.basicConfig`, which would add a root handler
    and print each line twice.

    The messages never hold e-mails, tokens nor the database URL (D40, D49);
    the filter of the customer link (D24) is one more guard for a path that
    ends up in a message. Idempotent.
    """
    logger = logging.getLogger(APP_LOGGER)
    logger.setLevel(logging.INFO)
    if any(isinstance(handler, _AppHandler) for handler in logger.handlers):
        return
    handler = _AppHandler(sys.stdout)
    handler.setFormatter(
        logging.Formatter(SCRIPT_LOG_FORMAT if with_time else APP_LOG_FORMAT)
    )
    handler.addFilter(CustomerTokenFilter())
    logger.addHandler(handler)
