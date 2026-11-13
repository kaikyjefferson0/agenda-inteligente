import asyncio
from collections.abc import Callable


async def wait_until(condition: Callable[[], bool], timeout: float = 5) -> None:
    """Polls the condition, so no test depends on a fixed sleep."""

    async def poll() -> None:
        while not condition():
            await asyncio.sleep(0.02)

    await asyncio.wait_for(poll(), timeout)
