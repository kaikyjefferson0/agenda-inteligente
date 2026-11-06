from __future__ import annotations

from typing import TYPE_CHECKING

from sqlalchemy import CheckConstraint, false, text
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.appointment import Appointment
    from app.models.professional import Professional
    from app.models.schedule import TimeBlock, WorkingHours
    from app.models.service import ProfessionalService, Service
    from app.models.user import User


class Business(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "businesses"
    __table_args__ = (
        CheckConstraint(
            "slot_step_minutes IN (5, 10, 15, 20, 30, 60)",
            name="slot_step_minutes_allowed",
        ),
        CheckConstraint(
            "min_advance_minutes >= 0", name="min_advance_minutes_non_negative"
        ),
        CheckConstraint("max_advance_days > 0", name="max_advance_days_positive"),
        CheckConstraint(
            "change_deadline_minutes >= 0",
            name="change_deadline_minutes_non_negative",
        ),
    )

    name: Mapped[str]
    slug: Mapped[str] = mapped_column(CITEXT, unique=True)
    timezone: Mapped[str]
    slot_step_minutes: Mapped[int] = mapped_column(server_default=text("15"))
    min_advance_minutes: Mapped[int] = mapped_column(server_default=text("60"))
    max_advance_days: Mapped[int] = mapped_column(server_default=text("30"))
    change_deadline_minutes: Mapped[int] = mapped_column(server_default=text("120"))
    is_demo: Mapped[bool] = mapped_column(server_default=false())

    users: Mapped[list[User]] = relationship(
        back_populates="business", lazy="raise", passive_deletes="all"
    )
    professionals: Mapped[list[Professional]] = relationship(
        back_populates="business",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,professionals,user",
    )
    services: Mapped[list[Service]] = relationship(
        back_populates="business", lazy="raise", passive_deletes="all"
    )
    professional_services: Mapped[list[ProfessionalService]] = relationship(
        back_populates="business",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,professional_services,service",
    )
    working_hours: Mapped[list[WorkingHours]] = relationship(
        back_populates="business",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,working_hours",
    )
    time_blocks: Mapped[list[TimeBlock]] = relationship(
        back_populates="business",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,time_blocks",
    )
    appointments: Mapped[list[Appointment]] = relationship(
        back_populates="business",
        lazy="raise",
        passive_deletes="all",
        overlaps="appointments,business,professional,service",
    )
