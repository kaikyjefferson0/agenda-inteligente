from datetime import datetime

from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import RateLimitCounter


async def increment(session: AsyncSession, key: str, window_start: datetime) -> int:
    """Atomically adds one to the counter and returns the new value."""
    statement = insert(RateLimitCounter).values(
        key=key, window_start=window_start, count=1
    )
    statement = statement.on_conflict_do_update(
        index_elements=[RateLimitCounter.key, RateLimitCounter.window_start],
        set_={"count": RateLimitCounter.count + 1},
    ).returning(RateLimitCounter.count)
    count = await session.scalar(statement)
    if count is None:
        raise RuntimeError("rate limit counter was not returned")
    return count
