import logging
import re

ACCESS_LOGGER = "uvicorn.access"
MASK = "***"
# The segment right after the prefix of the customer link, up to the next
# separator, wherever the path appears in the record.
CUSTOMER_TOKEN_IN_PATH = re.compile(r"(/public/appointments/)[^/?#\s\"']+")


def mask_customer_token(text: str) -> str:
    return CUSTOMER_TOKEN_IN_PATH.sub(rf"\g<1>{MASK}", text)


class CustomerTokenFilter(logging.Filter):
    """D24: the access log records the path, and the path holds the token.

    Rewrites the record before any handler formats it, so no handler, format or
    destination ever receives the token.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if isinstance(record.msg, str):
            record.msg = mask_customer_token(record.msg)
        if isinstance(record.args, tuple):
            record.args = tuple(
                mask_customer_token(arg) if isinstance(arg, str) else arg
                for arg in record.args
            )
        return True


def install_customer_token_filter() -> None:
    """Idempotent. Uvicorn configures its loggers before importing the app.

    A filter on the logger survives that configuration, which only replaces the
    handlers and the level.
    """
    logger = logging.getLogger(ACCESS_LOGGER)
    if not any(isinstance(item, CustomerTokenFilter) for item in logger.filters):
        logger.addFilter(CustomerTokenFilter())
