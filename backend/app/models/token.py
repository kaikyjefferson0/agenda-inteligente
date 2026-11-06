from __future__ import annotations

from datetime import datetime
from typing import TYPE_CHECKING
from uuid import UUID

from sqlalchemy import ForeignKey, Index
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.models.base import (
    Base,
    TextEnum,
    TimestampMixin,
    UUIDPrimaryKeyMixin,
    enum_check,
)
from app.models.enums import AccountTokenPurpose

if TYPE_CHECKING:
    from app.models.user import User


class AccountToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "account_tokens"
    __table_args__ = (
        enum_check("purpose", AccountTokenPurpose),
        Index("ix_account_tokens_user_id", "user_id"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    purpose: Mapped[AccountTokenPurpose] = mapped_column(TextEnum(AccountTokenPurpose))
    token_hash: Mapped[str] = mapped_column(unique=True)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]

    user: Mapped[User] = relationship(back_populates="account_tokens", lazy="raise")


class RefreshToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "refresh_tokens"
    __table_args__ = (
        Index("ix_refresh_tokens_family_id", "family_id"),
        Index("ix_refresh_tokens_user_id", "user_id"),
    )

    user_id: Mapped[UUID] = mapped_column(ForeignKey("users.id", ondelete="RESTRICT"))
    family_id: Mapped[UUID]
    token_hash: Mapped[str] = mapped_column(unique=True)
    expires_at: Mapped[datetime]
    used_at: Mapped[datetime | None]
    revoked_at: Mapped[datetime | None]

    user: Mapped[User] = relationship(back_populates="refresh_tokens", lazy="raise")
