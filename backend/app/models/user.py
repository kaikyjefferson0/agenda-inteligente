from __future__ import annotations

from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, UniqueConstraint, true
from sqlalchemy.dialects.postgresql import CITEXT
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    Base,
    TextEnum,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    enum_check,
)
from app.models.enums import UserRole

if TYPE_CHECKING:
    from app.models.business import Business
    from app.models.professional import Professional
    from app.models.token import AccountToken, RefreshToken


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"
    __table_args__ = (
        UniqueConstraint("business_id", "id"),
        enum_check("role", UserRole),
    )

    business_id: Mapped[UUID] = mapped_column(
        ForeignKey("businesses.id", ondelete="RESTRICT")
    )
    name: Mapped[str]
    email: Mapped[str] = mapped_column(CITEXT, unique=True)
    password_hash: Mapped[str | None]
    role: Mapped[UserRole] = mapped_column(TextEnum(UserRole))
    is_active: Mapped[bool] = mapped_column(server_default=true())

    business: Mapped[Business] = relationship(back_populates="users", lazy="raise")
    professional: Mapped[Professional | None] = relationship(
        back_populates="user",
        lazy="raise",
        passive_deletes="all",
        overlaps="business,professional,professionals,user",
    )
    account_tokens: Mapped[list[AccountToken]] = relationship(
        back_populates="user", lazy="raise", passive_deletes="all"
    )
    refresh_tokens: Mapped[list[RefreshToken]] = relationship(
        back_populates="user", lazy="raise", passive_deletes="all"
    )
