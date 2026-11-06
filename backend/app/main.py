from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import router as auth_router
from app.api.business import router as business_router
from app.api.catalog import router as catalog_router
from app.api.errors import register_error_handlers
from app.api.health import router as health_router
from app.api.professionals import router as professionals_router
from app.api.public import router as public_router
from app.api.time_blocks import router as time_blocks_router
from app.core.config import get_settings

API_PREFIX = "/api/v1"

app = FastAPI(title="Agenda Inteligente API", version="0.1.0")
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"],
    allow_headers=[
        "Authorization",
        "Content-Type",
        "Idempotency-Key",
        "X-Requested-With",
    ],
    expose_headers=["Retry-After"],
)
register_error_handlers(app)
app.include_router(health_router)
app.include_router(auth_router, prefix=API_PREFIX)
app.include_router(business_router, prefix=API_PREFIX)
app.include_router(catalog_router, prefix=API_PREFIX)
app.include_router(professionals_router, prefix=API_PREFIX)
app.include_router(time_blocks_router, prefix=API_PREFIX)
app.include_router(public_router, prefix=API_PREFIX)
