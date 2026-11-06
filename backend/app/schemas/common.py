from typing import Annotated
from zoneinfo import available_timezones

from pydantic import AfterValidator, BaseModel, ConfigDict, StringConstraints

SLUG_PATTERN = r"^[a-z0-9]+(?:-[a-z0-9]+)*$"


def _validate_timezone(value: str) -> str:
    if value not in available_timezones():
        raise ValueError("timezone must be a valid IANA name")
    return value


def reject_null_character(value: str) -> str:
    """PostgreSQL text cannot hold it, so it would otherwise end as a 500."""
    if "\x00" in value:
        raise ValueError("must not contain a null character")
    return value


Name = Annotated[
    str,
    StringConstraints(strip_whitespace=True, min_length=1, max_length=120),
    AfterValidator(reject_null_character),
]
Slug = Annotated[
    str, StringConstraints(min_length=3, max_length=63, pattern=SLUG_PATTERN)
]
TimeZoneName = Annotated[str, AfterValidator(_validate_timezone)]


class RequestModel(BaseModel):
    """Refuses unknown fields, such as a business_id sent by the client.

    In a partial update, declare `name: Name = Field(default=cast(Name, None))`:
    the field may be left out, but an explicit null fails, and the routes apply
    only what `model_dump(exclude_unset=True)` returns. The cast exists only for
    the type checker: an omitted field holds None at runtime, so read these
    models through `model_dump`, never through their attributes.
    """

    model_config = ConfigDict(extra="forbid")


class ResponseModel(BaseModel):
    model_config = ConfigDict(from_attributes=True)
