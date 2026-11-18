import hashlib
import hmac
import secrets
from datetime import datetime, timedelta
from uuid import UUID

import jwt
from anyio import CapacityLimiter, to_thread
from argon2 import PasswordHasher
from argon2.exceptions import InvalidHashError, VerificationError

ACCESS_TOKEN_TTL = timedelta(minutes=15)
JWT_ALGORITHM = "HS256"
JWT_ISSUER = "agenda-inteligente"
OPAQUE_TOKEN_BYTES = 32
# Each Argon2 hash holds 64 MiB while it runs. The default limiter of anyio lets
# 40 threads run at once (2.5 GiB) on an instance of 512 MB; 2 hold 128 MiB. On
# the 0.1 CPU of the free plan simultaneous hashes only share the processor, so
# the queue costs the last login of a burst almost nothing.
MAX_CONCURRENT_HASHES = 2


def build_password_hasher() -> PasswordHasher:
    """Argon2id with the library defaults: 64 MiB, 3 passes and 4 lanes."""
    return PasswordHasher()


_hasher = build_password_hasher()
_dummy_hash: str | None = None
# Shared by hash_password and verify_password, the dummy hash included.
_hash_slots = CapacityLimiter(MAX_CONCURRENT_HASHES)


async def hash_password(password: str) -> str:
    # Argon2 takes tens of milliseconds, too long for the event loop.
    return await to_thread.run_sync(_hasher.hash, password, limiter=_hash_slots)


async def verify_password(stored_hash: str | None, password: str) -> bool:
    """Checks a password, spending the same work when there is no hash.

    Without a stored hash it verifies against a dummy one and returns False, so
    the response time does not reveal whether the account exists.
    """
    global _dummy_hash
    candidate = stored_hash
    if candidate is None:
        if _dummy_hash is None:
            _dummy_hash = await hash_password(secrets.token_urlsafe(OPAQUE_TOKEN_BYTES))
        candidate = _dummy_hash
    try:
        await to_thread.run_sync(
            _hasher.verify, candidate, password, limiter=_hash_slots
        )
    except VerificationError, InvalidHashError:
        return False
    return stored_hash is not None


def password_needs_rehash(stored_hash: str) -> bool:
    return _hasher.check_needs_rehash(stored_hash)


def generate_opaque_token() -> str:
    return secrets.token_urlsafe(OPAQUE_TOKEN_BYTES)


def hash_opaque_token(token: str) -> str:
    """SHA-256 is enough here: the token already has 256 bits of entropy."""
    return hashlib.sha256(token.encode()).hexdigest()


def rate_limit_key(secret: str, name: str, subject: str) -> str:
    """Keeps IP addresses and e-mails out of the counters table."""
    message = f"{name}:{subject}".encode()
    return hmac.new(secret.encode(), message, hashlib.sha256).hexdigest()


def create_access_token(
    user_id: UUID, family_id: UUID, now: datetime, secret: str
) -> str:
    claims = {
        "sub": str(user_id),
        "sid": str(family_id),
        "iss": JWT_ISSUER,
        "iat": now,
        "exp": now + ACCESS_TOKEN_TTL,
    }
    return jwt.encode(claims, secret, algorithm=JWT_ALGORITHM)


def decode_access_token(token: str, secret: str) -> tuple[UUID, UUID]:
    """Returns (user_id, family_id). Raises ValueError for any invalid token."""
    try:
        claims = jwt.decode(
            token,
            secret,
            algorithms=[JWT_ALGORITHM],
            issuer=JWT_ISSUER,
            options={"require": ["sub", "sid", "iss", "iat", "exp"]},
        )
        return UUID(claims["sub"]), UUID(claims["sid"])
    except jwt.InvalidTokenError as exc:
        raise ValueError("invalid access token") from exc
