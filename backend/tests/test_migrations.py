import asyncio
import warnings

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine
from sqlalchemy.orm import configure_mappers
from sqlalchemy.pool import NullPool

from app.models import Base
from tests.conftest import recreate_database, run_alembic

TABLES = {
    "businesses",
    "users",
    "professionals",
    "account_tokens",
    "refresh_tokens",
    "services",
    "professional_services",
    "working_hours",
    "time_blocks",
    "appointments",
    "email_outbox",
    "rate_limit_counters",
}
EXTENSIONS = {"citext", "btree_gist"}

TABLES_QUERY = "SELECT tablename FROM pg_tables WHERE schemaname = 'public'"
EXTENSIONS_QUERY = "SELECT extname FROM pg_extension WHERE extname <> 'plpgsql'"
SCHEMA_QUERIES = (
    """
    SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default
    FROM information_schema.columns WHERE table_schema = 'public'
    """,
    """
    SELECT conrelid::regclass::text, conname, pg_get_constraintdef(oid)
    FROM pg_constraint WHERE connamespace = 'public'::regnamespace
    """,
    "SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public'",
)


def fetch_rows(database_url: str, *queries: str) -> list[set[tuple]]:
    async def fetch() -> list[set[tuple]]:
        engine = create_async_engine(database_url, poolclass=NullPool)
        async with engine.connect() as connection:
            results = [await connection.execute(text(query)) for query in queries]
            rows = [{tuple(row) for row in result} for result in results]
        await engine.dispose()
        return rows

    return asyncio.run(fetch())


def fetch_names(database_url: str, query: str) -> set[str]:
    return {row[0] for row in fetch_rows(database_url, query)[0]}


def alembic_ok(database_url: str, *args: str) -> str:
    result = run_alembic(database_url, *args)
    assert result.returncode == 0, result.stdout + result.stderr
    return result.stdout


def test_upgrade_downgrade_upgrade_on_a_clean_database() -> None:
    database_url = recreate_database("agenda_migrations_test")
    assert fetch_names(database_url, TABLES_QUERY) == set()

    alembic_ok(database_url, "upgrade", "head")
    assert fetch_names(database_url, TABLES_QUERY) == TABLES | {"alembic_version"}
    assert fetch_names(database_url, EXTENSIONS_QUERY) == EXTENSIONS
    assert "0001 (head)" in alembic_ok(database_url, "current")
    first_schema = fetch_rows(database_url, *SCHEMA_QUERIES)

    alembic_ok(database_url, "downgrade", "base")
    assert fetch_names(database_url, TABLES_QUERY) == {"alembic_version"}
    assert fetch_names(database_url, EXTENSIONS_QUERY) == set()
    assert "0001" not in alembic_ok(database_url, "current")

    alembic_ok(database_url, "upgrade", "head")
    assert fetch_names(database_url, TABLES_QUERY) == TABLES | {"alembic_version"}
    assert "0001 (head)" in alembic_ok(database_url, "current")
    assert fetch_rows(database_url, *SCHEMA_QUERIES) == first_schema


def test_models_match_the_migration(migrated_database_url: str) -> None:
    alembic_ok(migrated_database_url, "check")


def test_check_and_exclude_constraints_match_the_models(
    migrated_database_url: str,
) -> None:
    # `alembic check` does not compare CHECK or EXCLUDE constraints.
    declared = {
        str(constraint.name)
        for table in Base.metadata.tables.values()
        for constraint in table.constraints
        if type(constraint).__name__ in {"CheckConstraint", "ExcludeConstraint"}
    }
    existing = fetch_names(
        migrated_database_url,
        """
        SELECT conname FROM pg_constraint
        WHERE contype IN ('c', 'x') AND connamespace = 'public'::regnamespace
        """,
    )
    assert existing == declared


def test_every_foreign_key_uses_on_delete_restrict(
    migrated_database_url: str,
) -> None:
    foreign_keys = fetch_rows(
        migrated_database_url,
        """
        SELECT conname, confdeltype::text FROM pg_constraint
        WHERE contype = 'f' AND connamespace = 'public'::regnamespace
        """,
    )[0]
    assert len(foreign_keys) == 16
    assert {delete_rule for _, delete_rule in foreign_keys} == {"r"}


def test_mappers_configure_without_warnings() -> None:
    with warnings.catch_warnings():
        warnings.simplefilter("error")
        configure_mappers()
