from datetime import datetime
from enum import StrEnum
from uuid import UUID

from sqlalchemy import CheckConstraint, DateTime, MetaData, Text, func
from sqlalchemy.engine import Dialect
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column
from sqlalchemy.types import TypeDecorator

NAMING_CONVENTION = {
    "pk": "pk_%(table_name)s",
    "uq": "uq_%(table_name)s_%(column_0_N_name)s",
    "ix": "ix_%(table_name)s_%(column_0_N_name)s",
    "ck": "ck_%(table_name)s_%(constraint_name)s",
    # Without column names: they would exceed PostgreSQL's 63-character limit on
    # composite keys, and no table has two foreign keys to the same table.
    "fk": "fk_%(table_name)s_%(referred_table_name)s",
}


class Base(DeclarativeBase):
    metadata = MetaData(naming_convention=NAMING_CONVENTION)
    type_annotation_map = {
        str: Text,
        datetime: DateTime(timezone=True),
    }


class TextEnum[E: StrEnum](TypeDecorator[E]):
    """Stores a StrEnum as `text`; `enum_check` adds the matching CHECK."""

    impl = Text
    cache_ok = True

    def __init__(self, enum_class: type[E]) -> None:
        super().__init__()
        self.enum_class = enum_class

    def process_bind_param(self, value: E | str | None, dialect: Dialect) -> str | None:
        return None if value is None else self.enum_class(value).value

    def process_result_value(self, value: str | None, dialect: Dialect) -> E | None:
        return None if value is None else self.enum_class(value)


def enum_check(column: str, enum_class: type[StrEnum]) -> CheckConstraint:
    values = ", ".join(f"'{member.value}'" for member in enum_class)
    return CheckConstraint(f"{column} IN ({values})", name=f"{column}_valid")


class UUIDPrimaryKeyMixin:
    id: Mapped[UUID] = mapped_column(
        primary_key=True, server_default=func.gen_random_uuid(), sort_order=-1
    )


class TimestampMixin:
    # Reads the generated values back on flush: an expired attribute would need
    # a lazy load, which the async session does not allow.
    __mapper_args__ = {"eager_defaults": True}

    created_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), sort_order=1
    )
    updated_at: Mapped[datetime] = mapped_column(
        server_default=func.now(), onupdate=func.now(), sort_order=1
    )
