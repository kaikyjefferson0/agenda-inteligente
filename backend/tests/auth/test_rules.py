"""Pure rules and helpers: no database and no HTTP."""

from datetime import UTC, datetime, timedelta
from uuid import uuid4

import jwt
from pydantic import ValidationError
from pytest import mark, raises

from app.core.config import Settings
from app.core.database import get_engine
from app.core.security import (
    build_password_hasher,
    create_access_token,
    decode_access_token,
    hash_opaque_token,
    rate_limit_key,
)
from app.domain.auth import (
    PASSWORD_RESET_TTL,
    REFRESH_ABSOLUTE_TTL,
    REFRESH_IDLE_TTL,
    RefreshTokenState,
    classify_refresh_token,
    is_account_token_usable,
    is_invitation_pending,
    refresh_token_expiry,
)
from app.domain.rate_limits import seconds_until_window_end, window_start
from app.schemas.auth import BusinessRegistration, ResetPasswordRequest

NOW = datetime(2030, 1, 7, 12, 0, tzinfo=UTC)
# Long enough for HS512 too, so that case fails only because of the algorithm.
SECRET = "s" * 64
LATER = NOW + timedelta(days=1)
EARLIER = NOW - timedelta(days=1)


@mark.parametrize(
    ("used_at", "revoked_at", "expires_at", "expected"),
    [
        (None, None, LATER, RefreshTokenState.ACTIVE),
        (None, None, NOW, RefreshTokenState.EXPIRED),
        (None, EARLIER, LATER, RefreshTokenState.REVOKED),
        (EARLIER, None, LATER, RefreshTokenState.REUSED),
        # A used token is reuse even if it was also revoked or has expired.
        (EARLIER, EARLIER, EARLIER, RefreshTokenState.REUSED),
    ],
)
def test_classifies_refresh_token(used_at, revoked_at, expires_at, expected) -> None:
    assert classify_refresh_token(used_at, revoked_at, expires_at, NOW) is expected


@mark.parametrize(
    ("is_professional", "has_password", "is_active", "expected"),
    [
        (True, False, True, True),
        # Accepted: the link was used.
        (True, True, True, False),
        # D96: deactivated before accepting is never pending.
        (True, False, False, False),
        (True, True, False, False),
        # The Owner always has a password, but the role alone already excludes it.
        (False, False, True, False),
        (False, True, True, False),
    ],
)
def test_invitation_is_pending_only_while_it_can_be_accepted(
    is_professional: bool, has_password: bool, is_active: bool, expected: bool
) -> None:
    pending = is_invitation_pending(
        is_professional=is_professional, has_password=has_password, is_active=is_active
    )

    assert pending is expected


def test_refresh_expiry_slides_with_each_use() -> None:
    started_at = NOW - timedelta(days=3)

    assert refresh_token_expiry(started_at, NOW) == NOW + REFRESH_IDLE_TTL


def test_refresh_expiry_stops_at_the_absolute_limit() -> None:
    started_at = NOW - timedelta(days=27)

    expiry = refresh_token_expiry(started_at, NOW)

    assert expiry == started_at + REFRESH_ABSOLUTE_TTL
    assert expiry < NOW + REFRESH_IDLE_TTL


def test_refresh_lifetimes_follow_the_documented_rule() -> None:
    assert REFRESH_IDLE_TTL == timedelta(days=7)
    assert REFRESH_ABSOLUTE_TTL == timedelta(days=30)


def test_account_token_is_refused_at_the_exact_expiry() -> None:
    expires_at = NOW + PASSWORD_RESET_TTL

    assert is_account_token_usable(None, expires_at, NOW)
    assert not is_account_token_usable(None, expires_at, expires_at)
    assert not is_account_token_usable(EARLIER, expires_at, NOW)


def test_rate_limit_window_is_aligned_and_reports_what_remains() -> None:
    window = timedelta(minutes=15)
    now = NOW + timedelta(minutes=7, seconds=30)

    assert window_start(now, window) == NOW
    assert seconds_until_window_end(now, window) == 450


def test_rate_limit_key_hides_the_subject() -> None:
    key = rate_limit_key(SECRET, "login", "10.0.0.1|ana@example.com")

    assert "ana" not in key
    assert "10.0.0.1" not in key
    assert key != rate_limit_key("x" * 32, "login", "10.0.0.1|ana@example.com")


def test_password_hasher_uses_argon2id_with_the_documented_parameters() -> None:
    stored = build_password_hasher().hash("uma-senha-qualquer")

    assert stored.startswith("$argon2id$v=19$m=65536,t=3,p=4$")


def test_opaque_token_hash_is_stable_and_does_not_contain_the_token() -> None:
    assert hash_opaque_token("abc") == hash_opaque_token("abc")
    assert "abc" not in hash_opaque_token("abc")


@mark.parametrize(
    ("password", "valid"),
    [
        ("a" * 11, False),
        ("a" * 12, True),
        ("a" * 128, True),
        ("a" * 129, False),
    ],
)
def test_password_policy_limits_the_length(password: str, valid: bool) -> None:
    if valid:
        ResetPasswordRequest(token="t", new_password=password)
    else:
        with raises(ValidationError):
            ResetPasswordRequest(token="t", new_password=password)


@mark.parametrize("slug", ["ab", "Barbearia", "-corte", "corte-", "a b c", "a--b"])
def test_invalid_slugs_are_refused(slug: str) -> None:
    with raises(ValidationError):
        BusinessRegistration(name="N", slug=slug, timezone="America/Sao_Paulo")


def test_unknown_timezone_is_refused() -> None:
    with raises(ValidationError):
        BusinessRegistration(name="N", slug="valido", timezone="Marte/Olympus")


def test_short_secrets_are_refused() -> None:
    with raises(ValidationError):
        Settings(
            database_url="postgresql+asyncpg://x",
            jwt_secret="curto",
            rate_limit_key_secret="s" * 32,
        )


def test_engine_keeps_statement_parameters_out_of_errors() -> None:
    assert get_engine().sync_engine.hide_parameters is True


def _token(secret: str = SECRET, algorithm: str = "HS256", **overrides) -> str:
    now = datetime.now(UTC)
    claims = {
        "sub": str(uuid4()),
        "sid": str(uuid4()),
        "iss": "agenda-inteligente",
        "iat": now,
        "exp": now + timedelta(minutes=15),
        **overrides,
    }
    claims = {key: value for key, value in claims.items() if value is not None}
    return jwt.encode(claims, secret, algorithm=algorithm)


def test_access_token_lasts_fifteen_minutes() -> None:
    now = datetime.now(UTC).replace(microsecond=0)

    token = create_access_token(uuid4(), uuid4(), now, SECRET)

    claims = jwt.decode(token, options={"verify_signature": False})
    assert claims["exp"] - claims["iat"] == 900


def test_valid_access_token_is_decoded() -> None:
    user_id, family_id = uuid4(), uuid4()

    token = create_access_token(user_id, family_id, datetime.now(UTC), SECRET)

    assert decode_access_token(token, SECRET) == (user_id, family_id)


@mark.parametrize(
    "token",
    [
        _token(secret="z" * 32),
        _token(exp=datetime.now(UTC) - timedelta(seconds=1)),
        _token(iss="outro-emissor"),
        _token(sid=None),
        _token(sub=None),
        _token(algorithm="none", secret=""),
        _token(secret=SECRET, algorithm="HS512"),
        "nao-e-um-jwt",
    ],
    ids=[
        "wrong-signature",
        "expired",
        "wrong-issuer",
        "no-sid",
        "no-sub",
        "alg-none",
        "other-algorithm",
        "garbage",
    ],
)
def test_invalid_access_tokens_are_refused(token: str) -> None:
    with raises(ValueError):
        decode_access_token(token, SECRET)


def test_tampered_access_token_is_refused() -> None:
    header, payload, signature = _token().split(".")
    forged = jwt.encode({"sub": str(uuid4())}, "x" * 32).split(".")[1]

    with raises(ValueError):
        decode_access_token(f"{header}.{forged}.{signature}", SECRET)
    assert payload != forged
