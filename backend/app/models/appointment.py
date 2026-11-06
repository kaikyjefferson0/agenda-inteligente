from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    false,
    text,
)
from sqlalchemy.dialects.postgresql import CITEXT, ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    Base,
    TextEnum,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    enum_check,
)
from app.models.enums import AppointmentOrigin, AppointmentStatus

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.professional import Professional
    from app.models.service import Service


class Appointment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "appointments"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id", "professional_id"],
            ["professionals.business_id", "professionals.id"],
            ondelete="RESTRICT",
        ),
        ForeignKeyConstraint(
            ["business_id", "service_id"],
            ["services.business_id", "services.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint(
            "ends_at > starts_at AND blocked_until >= ends_at", name="times_ordered"
        ),
        CheckConstraint("duration_minutes > 0", name="duration_minutes_positive"),
        CheckConstraint(
            "preparation_minutes >= 0", name="preparation_minutes_non_negative"
        ),
        CheckConstraint("price_cents >= 0", name="price_cents_non_negative"),
        enum_check("status", AppointmentStatus),
        enum_check("origin", AppointmentOrigin),
        CheckConstraint(
            "origin <> 'public' "
            "OR (customer_email IS NOT NULL AND customer_phone IS NOT NULL)",
            name="public_requires_contact",
        ),
        CheckConstraint(
            "access_token_hash IS NOT NULL "
            "OR (origin = 'staff' AND customer_email IS NULL)",
            name="access_token_required",
        ),
        CheckConstraint(
            "(idempotency_key IS NULL) = (idempotency_fingerprint IS NULL)",
            name="idempotency_fields_paired",
        ),
        ExcludeConstraint(
            ("professional_id", "="),
            (text("tstzrange(starts_at, blocked_until, '[)')"), "&&"),
            name="appointments_no_overlap",
            using="gist",
            where=text("status <> 'cancelled'"),
        ),
        Index(
            "ix_appointments_business_id_professional_id_starts_at",
            "business_id",
            "professional_id",
            "starts_at",
        ),
        Index("ix_appointments_business_id_starts_at", "business_id", "starts_at"),
        Index(
            "uq_appointments_access_token_hash",
            "access_token_hash",
            unique=True,
            postgresql_where=text("access_token_hash IS NOT NULL"),
        ),
        Index(
            "uq_appointments_business_id_idempotency_key",
            "business_id",
            "idempotency_key",
            unique=True,
            postgresql_where=text("idempotency_key IS NOT NULL"),
        ),
    )

    business_id: Mapped[UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="RESTRICT")
    )
    professional_id: Mapped[UUID]
    service_id: Mapped[UUID]
    starts_at: Mapped[datetime]
    ends_at: Mapped[datetime]
    blocked_until: Mapped[datetime]
    duration_minutes: Mapped[int]
    preparation_minutes: Mapped[int]
    price_cents: Mapped[int]
    customer_name: Mapped[str]
    customer_email: Mapped[str | None] = mapped_column(CITEXT)
    customer_phone: Mapped[str | None]
    status: Mapped[AppointmentStatus] = mapped_column(
        TextEnum(AppointmentStatus), server_default=text("'confirmed'")
    )
    origin: Mapped[AppointmentOrigin] = mapped_column(TextEnum(AppointmentOrigin))
    access_token_hash: Mapped[str | None]
    link_email_skipped: Mapped[bool] = mapped_column(server_default=false())
    idempotency_key: Mapped[str | None]
    idempotency_fingerprint: Mapped[str | None]
    cancelled_at: Mapped[datetime | None]

    business: Mapped[Business] = relationship(
        back_populates="appointments",
        lazy="raise",
        overlaps="appointments,business,professional,service",
    )
    professional: Mapped[Professional] = relationship(
        back_populates="appointments",
        lazy="raise",
        overlaps="appointments,business,professional,service",
    )
    service: Mapped[Service] = relationship(
        back_populates="appointments",
        lazy="raise",
        overlaps="appointments,business,professional,service",
    )
