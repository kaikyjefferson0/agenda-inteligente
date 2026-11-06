from datetime import datetime
from typing import Any

from sqlalchemy import CheckConstraint, Index, func, text
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column

from app.models.base import Base, TextEnum, UUIDPrimaryKeyMixin, enum_check
from app.models.enums import EmailOutboxStatus


class EmailOutbox(UUIDPrimaryKeyMixin, Base):
    __tablename__ = "email_outbox"
    __table_args__ = (
        enum_check("status", EmailOutboxStatus),
        CheckConstraint("attempts >= 0", name="attempts_non_negative"),
        CheckConstraint(
            "status <> 'pending' OR (to_email IS NOT NULL AND payload IS NOT NULL)",
            name="pending_requires_recipient_and_payload",
        ),
        CheckConstraint(
            "status = 'pending' OR payload IS NULL",
            name="finished_requires_no_payload",
        ),
        Index(
            "ix_email_outbox_next_attempt_at",
            "next_attempt_at",
            postgresql_where=text("status = 'pending'"),
        ),
    )

    created_at: Mapped[datetime] = mapped_column(server_default=func.now())
    to_email: Mapped[str | None]
    template: Mapped[str]
    # none_as_null: erasing the payload must store SQL NULL, not the JSON `null`.
    payload: Mapped[dict[str, Any] | None] = mapped_column(JSONB(none_as_null=True))
    status: Mapped[EmailOutboxStatus] = mapped_column(
        TextEnum(EmailOutboxStatus), server_default=text("'pending'")
    )
    attempts: Mapped[int] = mapped_column(server_default=text("0"))
    next_attempt_at: Mapped[datetime] = mapped_column(server_default=func.now())
    sent_at: Mapped[datetime | None]
    last_error: Mapped[str | None]


class RateLimitCounter(Base):
    __tablename__ = "rate_limit_counters"

    key: Mapped[str] = mapped_column(primary_key=True)
    window_start: Mapped[datetime] = mapped_column(primary_key=True)
    count: Mapped[int] = mapped_column(server_default=text("0"))
