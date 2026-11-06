from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    UniqueConstraint,
    text,
    true,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.appointment import Appointment
    from app.models.business import Business
    from app.models.professional import Professional


class Service(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "services"
    __table_args__ = (
        UniqueConstraint("business_id", "id"),
        CheckConstraint("duration_minutes > 0", name="duration_minutes_positive"),
        CheckConstraint(
            "preparation_minutes >= 0", name="preparation_minutes_non_negative"
        ),
        CheckConstraint("price_cents >= 0", name="price_cents_non_negative"),
    )

    business_id: Mapped[UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="RESTRICT")
    )
    name: Mapped[str]
    duration_minutes: Mapped[int]
    preparation_minutes: Mapped[int] = mapped_column(server_default=text("0"))
    price_cents: Mapped[int]
    is_active: Mapped[bool] = mapped_column(server_default=true())

    business: Mapped[Business] = relationship(back_populates="services", lazy="raise")
    professional_services: Mapped[list[ProfessionalService]] = relationship(
        back_populates="service",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,professional_services,service",
    )
    appointments: Mapped[list[Appointment]] = relationship(
        back_populates="service",
        lazy="raise",
        passive_deletes="all",
        overlaps="appointments,business,professional,service",
    )


class ProfessionalService(TimestampMixin, Base):
    __tablename__ = "professional_services"
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
        Index("ix_professional_services_service_id", "service_id"),
    )

    business_id: Mapped[UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="RESTRICT")
    )
    professional_id: Mapped[UUID] = mapped_column(primary_key=True)
    service_id: Mapped[UUID] = mapped_column(primary_key=True)

    business: Mapped[Business] = relationship(
        back_populates="professional_services",
        lazy="raise",
        overlaps="business,professional,professional_services,service",
    )
    professional: Mapped[Professional] = relationship(
        back_populates="professional_services",
        lazy="raise",
        overlaps="business,professional,professional_services,service",
    )
    service: Mapped[Service] = relationship(
        back_populates="professional_services",
        lazy="raise",
        overlaps="business,professional,professional_services,service",
    )
