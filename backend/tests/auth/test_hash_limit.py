"""At most MAX_CONCURRENT_HASHES Argon2 hashes at once (64 MiB each, 512 MB box)."""

import threading
import time

import anyio
from argon2 import PasswordHasher
from pytest import MonkeyPatch, mark

from app.core import security

pytestmark = mark.anyio

WORK_SECONDS = 0.05
BURST = 10


class SlowHasher(PasswordHasher):
    """Holds each call for a while and records how many run at the same time."""

    def __init__(self) -> None:
        super().__init__(time_cost=1, memory_cost=8, parallelism=1)
        self._lock = threading.Lock()
        self.running = 0
        self.peak = 0
        self.calls = 0

    def _work(self) -> None:
        with self._lock:
            self.running += 1
            self.calls += 1
            self.peak = max(self.peak, self.running)
        time.sleep(WORK_SECONDS)
        with self._lock:
            self.running -= 1

    def hash(self, password: str | bytes, *, salt: bytes | None = None) -> str:
        self._work()
        return super().hash(password, salt=salt)

    def verify(self, hash: str | bytes, password: str | bytes) -> bool:
        self._work()
        return super().verify(hash, password)


def slow_hasher(monkeypatch: MonkeyPatch) -> SlowHasher:
    hasher = SlowHasher()
    monkeypatch.setattr(security, "_hasher", hasher)
    monkeypatch.setattr(security, "_dummy_hash", None)
    return hasher


def test_the_limit_is_two() -> None:
    assert security.MAX_CONCURRENT_HASHES == 2


async def test_a_burst_of_hashes_runs_two_at_a_time(monkeypatch: MonkeyPatch) -> None:
    hasher = slow_hasher(monkeypatch)

    async with anyio.create_task_group() as group:
        for index in range(BURST):
            group.start_soon(security.hash_password, f"senha-{index}")

    assert hasher.calls == BURST
    assert hasher.peak == security.MAX_CONCURRENT_HASHES


async def test_verifications_and_the_dummy_hash_share_the_limit(
    monkeypatch: MonkeyPatch,
) -> None:
    """Logins with and without an account, and a new hash, all in the same queue."""
    stored = await security.hash_password("senha-certa")
    hasher = slow_hasher(monkeypatch)
    results: list[bool] = []

    async def verify(stored_hash: str | None, password: str) -> None:
        results.append(await security.verify_password(stored_hash, password))

    async with anyio.create_task_group() as group:
        for _ in range(4):
            group.start_soon(verify, stored, "senha-certa")
            group.start_soon(verify, None, "senha-certa")
        group.start_soon(security.hash_password, "outra-senha")

    assert sorted(results) == [False] * 4 + [True] * 4
    assert hasher.peak == security.MAX_CONCURRENT_HASHES
