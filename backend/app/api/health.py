import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.errors import problem_response
from app.core.database import get_session
from app.domain.errors import ErrorCode
from app.schemas.problems import HealthResponse, Problem, ReadyResponse

logger = logging.getLogger(__name__)

router = APIRouter()

DATABASE_CHECK_TIMEOUT_SECONDS = 3


@router.get("/health")
async def health() -> HealthResponse:
    """D118: only the process. The host calls it every few seconds, and a query
    on each call would keep the database from ever suspending."""
    return HealthResponse(status="ok")


@router.get(
    "/ready",
    # Explicit, because the 503 below is returned as a response of its own.
    response_model=ReadyResponse,
    responses={
        status.HTTP_503_SERVICE_UNAVAILABLE: {
            "model": Problem,
            "description": "DATABASE_UNAVAILABLE",
        }
    },
)
async def ready(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> ReadyResponse | JSONResponse:
    """The process and the database, for the manual smoke test after a deploy."""
    try:
        async with asyncio.timeout(DATABASE_CHECK_TIMEOUT_SECONDS):
            await session.execute(text("SELECT 1"))
    # OSError covers refused connections and TimeoutError.
    except (SQLAlchemyError, OSError) as exc:
        logger.warning("Database readiness check failed: %s", type(exc).__name__)
        return problem_response(ErrorCode.DATABASE_UNAVAILABLE)
    return ReadyResponse(status="ok", database="ok")
