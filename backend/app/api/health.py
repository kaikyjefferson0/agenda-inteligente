import asyncio
import logging
from typing import Annotated

from fastapi import APIRouter, Depends, status
from fastapi.responses import JSONResponse
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_session

logger = logging.getLogger(__name__)

router = APIRouter()

DATABASE_CHECK_TIMEOUT_SECONDS = 3


@router.get("/health")
async def health(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> JSONResponse:
    try:
        async with asyncio.timeout(DATABASE_CHECK_TIMEOUT_SECONDS):
            await session.execute(text("SELECT 1"))
    # OSError covers refused connections and TimeoutError.
    except (SQLAlchemyError, OSError) as exc:
        logger.warning("Database health check failed: %s", type(exc).__name__)
        return JSONResponse(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            media_type="application/problem+json",
            content={
                "type": "https://api.exemplo.com/problems/database-unavailable",
                "title": "Banco de dados indisponível",
                "status": status.HTTP_503_SERVICE_UNAVAILABLE,
                "code": "DATABASE_UNAVAILABLE",
                "detail": "Não foi possível acessar o banco de dados.",
            },
        )
    return JSONResponse(content={"status": "ok", "database": "ok"})
