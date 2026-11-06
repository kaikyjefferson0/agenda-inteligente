from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, ForeignKeyConstraint, UniqueConstraint, true
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.appointment import Appointment
    from app.models.business import Business
    from app.models.schedule import TimeBlock, WorkingHours
    from app.models.service import ProfessionalService
    from app.models.user import User


class Professional(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "professionals"
    __table_args__ = (
        UniqueConstraint("business_id", "id"),
        ForeignKeyConstraint(
            ["business_id", "user_id"],
            ["users.business_id", "users.id"],
            ondelete="RESTRICT",
        ),
    )

    business_id: Mapped[UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="RESTRICT")
    )
    user_id: Mapped[UUID] = mapped_column(unique=True)
    is_bookable: Mapped[bool] = mapped_column(server_default=true())

    business: Mapped[Business] = relationship(
        back_populates="professionals",
        lazy="raise",
        overlaps="business,professional,professionals,user",
    )
    user: Mapped[User] = relationship(
        back_populates="professional",
        lazy="raise",
        overlaps="business,professional,professionals,user",
    )
    professional_services: Mapped[list[ProfessionalService]] = relationship(
        back_populates="professional",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,professional_services,service",
    )
    working_hours: Mapped[list[WorkingHours]] = relationship(
        back_populates="professional",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,working_hours",
    )
    time_blocks: Mapped[list[TimeBlock]] = relationship(
        back_populates="professional",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,time_blocks",
    )
    appointments: Mapped[list[Appointment]] = relationship(
        back_populates="professional",
        lazy="raise",
        passive_deletes="all",
        overlaps="appointments,business,professional,service",
    )
