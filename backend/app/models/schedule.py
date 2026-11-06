from __future__ import annotations

from datetime import datetime, time
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import (
    CheckConstraint,
    ForeignKey,
    ForeignKeyConstraint,
    Index,
    SmallInteger,
    text,
)
from sqlalchemy.dialects.postgresql import ExcludeConstraint
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.professional import Professional


class WorkingHours(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "working_hours"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id", "professional_id"],
            ["professionals.business_id", "professionals.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint("end_time > start_time", name="end_after_start"),
        CheckConstraint("weekday BETWEEN 0 AND 6", name="weekday_range"),
        Index("ix_working_hours_professional_id_weekday", "professional_id", "weekday"),
    )

    business_id: Mapped[UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="RESTRICT")
    )
    professional_id: Mapped[UUID]
    weekday: Mapped[int] = mapped_column(SmallInteger)
    start_time: Mapped[time]
    end_time: Mapped[time]

    business: Mapped[Business] = relationship(
        back_populates="working_hours",
        lazy="raise",
        overlaps="business,professional,working_hours",
    )
    professional: Mapped[Professional] = relationship(
        back_populates="working_hours",
        lazy="raise",
        overlaps="business,professional,working_hours",
    )


class TimeBlock(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "time_blocks"
    __table_args__ = (
        ForeignKeyConstraint(
            ["business_id", "professional_id"],
            ["professionals.business_id", "professionals.id"],
            ondelete="RESTRICT",
        ),
        CheckConstraint("ends_at > starts_at", name="ends_after_starts"),
        ExcludeConstraint(
            ("professional_id", "="),
            (text("tstzrange(starts_at, ends_at, '[)')"), "&&"),
            name="time_blocks_no_overlap",
            using="gist",
        ),
    )

    business_id: Mapped[UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="RESTRICT")
    )
    professional_id: Mapped[UUID]
    starts_at: Mapped[datetime]
    ends_at: Mapped[datetime]
    reason: Mapped[str]

    business: Mapped[Business] = relationship(
        back_populates="time_blocks",
        lazy="raise",
        overlaps="business,professional,time_blocks",
    )
    professional: Mapped[Professional] = relationship(
        back_populates="time_blocks",
        lazy="raise",
        overlaps="business,professional,time_blocks",
    )
