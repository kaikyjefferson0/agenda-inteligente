from collections.abc import AsyncIterator, Callable
from dataclasses import dataclass
from datetime import UTC, datetime, time, timedelta
from typing import Any
from uuid import uuid4

from pytest import fixture, mark, raises
from sqlalchemy import select, text
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine
from sqlalchemy.pool import NullPool

from app.models import (
    AccountToken,
    AccountTokenPurpose,
    Appointment,
    AppointmentOrigin,
    AppointmentStatus,
    Base,
    Business,
    EmailOutbox,
    EmailOutboxStatus,
    Professional,
    ProfessionalService,
    RateLimitCounter,
    RefreshToken,
    Service,
    TimeBlock,
    User,
    UserRole,
    WorkingHours,
)

pytestmark = mark.anyio

NOT_NULL_VIOLATION = "23502"
T0 = datetime(2030, 1, 7, 12, 0, tzinfo=UTC)


@fixture
def anyio_backend() -> str:
    return "asyncio"


@fixture
async def session(migrated_database_url: str) -> AsyncIterator[AsyncSession]:
    """Runs each test in a transaction that is never committed."""
    engine = create_async_engine(migrated_database_url, poolclass=NullPool)
    async with AsyncSession(engine) as db_session:
        yield db_session
        await db_session.rollback()
    await engine.dispose()


@dataclass
class Tenant:
    business: Business
    user: User
    professional: Professional
    service: Service


async def make_user(session: AsyncSession, business: Business) -> User:
    user = User(
        business_id=business.id,
        name="Pessoa",
        email=f"{uuid4()}@example.com",
        role=UserRole.PROFESSIONAL,
    )
    session.add(user)
    await session.flush()
    return user


async def make_tenant(session: AsyncSession) -> Tenant:
    business = Business(name="Negócio", slug=str(uuid4()), timezone="America/Sao_Paulo")
    session.add(business)
    await session.flush()
    user = await make_user(session, business)
    professional = Professional(business_id=business.id, user_id=user.id)
    service = Service(
        business_id=business.id, name="Corte", duration_minutes=30, price_cents=5000
    )
    session.add_all([professional, service])
    await session.flush()
    return Tenant(business, user, professional, service)


@fixture
async def tenant(session: AsyncSession) -> Tenant:
    return await make_tenant(session)


@fixture
async def other_tenant(session: AsyncSession) -> Tenant:
    return await make_tenant(session)


def build_appointment(tenant: Tenant, **overrides: Any) -> Appointment:
    values: dict[str, Any] = {
        "business_id": tenant.business.id,
        "professional_id": tenant.professional.id,
        "service_id": tenant.service.id,
        "starts_at": T0,
        "ends_at": T0 + timedelta(minutes=30),
        "blocked_until": T0 + timedelta(minutes=40),
        "duration_minutes": 30,
        "preparation_minutes": 10,
        "price_cents": 5000,
        "customer_name": "Cliente",
        "customer_email": "cliente@example.com",
        "customer_phone": "+5511999999999",
        "origin": AppointmentOrigin.PUBLIC,
        "access_token_hash": str(uuid4()),
    }
    return Appointment(**(values | overrides))


def build_time_block(tenant: Tenant, **overrides: Any) -> TimeBlock:
    values: dict[str, Any] = {
        "business_id": tenant.business.id,
        "professional_id": tenant.professional.id,
        "starts_at": T0,
        "ends_at": T0 + timedelta(hours=1),
        "reason": "Folga",
    }
    return TimeBlock(**(values | overrides))


def build_working_hours(tenant: Tenant, **overrides: Any) -> WorkingHours:
    values: dict[str, Any] = {
        "business_id": tenant.business.id,
        "professional_id": tenant.professional.id,
        "weekday": 0,
        "start_time": time(9),
        "end_time": time(18),
    }
    return WorkingHours(**(values | overrides))


def build_service(tenant: Tenant, **overrides: Any) -> Service:
    values: dict[str, Any] = {
        "business_id": tenant.business.id,
        "name": "Barba",
        "duration_minutes": 20,
        "price_cents": 3000,
    }
    return Service(**(values | overrides))


def build_business(tenant: Tenant, **overrides: Any) -> Business:
    values: dict[str, Any] = {
        "name": "Outro",
        "slug": str(uuid4()),
        "timezone": "America/Sao_Paulo",
    }
    return Business(**(values | overrides))


def build_outbox(tenant: Tenant, **overrides: Any) -> EmailOutbox:
    values: dict[str, Any] = {
        "to_email": "cliente@example.com",
        "template": "appointment_created",
        "payload": {"link": "https://app.example.com/x"},
    }
    return EmailOutbox(**(values | overrides))


def build_user(tenant: Tenant, **overrides: Any) -> User:
    values: dict[str, Any] = {
        "business_id": tenant.business.id,
        "name": "Pessoa",
        "email": f"{uuid4()}@example.com",
        "role": UserRole.PROFESSIONAL,
    }
    return User(**(values | overrides))


def driver_error(error: IntegrityError) -> Any:
    return error.orig.__cause__


async def assert_rejected_by(
    session: AsyncSession, constraint: str, *rows: Any
) -> None:
    with raises(IntegrityError) as caught:
        session.add_all(rows)
        await session.flush()
    assert driver_error(caught.value).constraint_name == constraint


async def assert_sql_rejected_by(
    session: AsyncSession, constraint: str, statement: str, **params: Any
) -> None:
    with raises(IntegrityError) as caught:
        await session.execute(text(statement), params)
    assert driver_error(caught.value).constraint_name == constraint


# Baseline: without it, a rejection below could come from invalid test data.


async def test_valid_rows_are_accepted(session: AsyncSession, tenant: Tenant) -> None:
    session.add_all(
        [
            ProfessionalService(
                business_id=tenant.business.id,
                professional_id=tenant.professional.id,
                service_id=tenant.service.id,
            ),
            build_working_hours(tenant),
            build_time_block(tenant),
            build_appointment(
                tenant,
                starts_at=T0 + timedelta(days=1),
                ends_at=T0 + timedelta(days=1, minutes=30),
                blocked_until=T0 + timedelta(days=1, minutes=40),
            ),
            build_outbox(tenant),
        ]
    )
    await session.flush()


async def test_defaults_come_from_the_database(
    session: AsyncSession, tenant: Tenant
) -> None:
    appointment = build_appointment(tenant)
    outbox = build_outbox(tenant)
    counter = RateLimitCounter(key="hmac", window_start=T0)
    session.add_all([appointment, outbox, counter])
    await session.flush()

    business = tenant.business
    assert (
        business.slot_step_minutes,
        business.min_advance_minutes,
        business.max_advance_days,
        business.change_deadline_minutes,
        business.is_demo,
    ) == (15, 60, 30, 120, False)
    assert tenant.user.is_active is True
    assert tenant.professional.is_bookable is True
    assert (tenant.service.preparation_minutes, tenant.service.is_active) == (0, True)
    assert appointment.status is AppointmentStatus.CONFIRMED
    assert appointment.link_email_skipped is False
    assert (outbox.status, outbox.attempts) == (EmailOutboxStatus.PENDING, 0)
    assert outbox.next_attempt_at is not None
    assert counter.count == 0
    assert tenant.business.created_at.tzinfo is not None


# Composite foreign keys across businesses


async def test_professional_cannot_use_user_of_another_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    foreign_user = await make_user(session, other_tenant.business)
    await assert_rejected_by(
        session,
        "fk_professionals_users",
        Professional(business_id=tenant.business.id, user_id=foreign_user.id),
    )


async def test_professional_service_rejects_professional_of_another_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    await assert_rejected_by(
        session,
        "fk_professional_services_professionals",
        ProfessionalService(
            business_id=tenant.business.id,
            professional_id=other_tenant.professional.id,
            service_id=tenant.service.id,
        ),
    )


async def test_professional_service_rejects_service_of_another_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    await assert_rejected_by(
        session,
        "fk_professional_services_services",
        ProfessionalService(
            business_id=tenant.business.id,
            professional_id=tenant.professional.id,
            service_id=other_tenant.service.id,
        ),
    )


async def test_working_hours_reject_professional_of_another_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    await assert_rejected_by(
        session,
        "fk_working_hours_professionals",
        build_working_hours(tenant, professional_id=other_tenant.professional.id),
    )


async def test_time_block_rejects_professional_of_another_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    await assert_rejected_by(
        session,
        "fk_time_blocks_professionals",
        build_time_block(tenant, professional_id=other_tenant.professional.id),
    )


async def test_appointment_rejects_professional_of_another_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    await assert_rejected_by(
        session,
        "fk_appointments_professionals",
        build_appointment(tenant, professional_id=other_tenant.professional.id),
    )


async def test_appointment_rejects_service_of_another_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    await assert_rejected_by(
        session,
        "fk_appointments_services",
        build_appointment(tenant, service_id=other_tenant.service.id),
    )


# ON DELETE RESTRICT


async def test_delete_of_business_with_dependents_is_rejected(
    session: AsyncSession, tenant: Tenant
) -> None:
    with raises(IntegrityError) as caught:
        await session.delete(tenant.business)
        await session.flush()
    assert driver_error(caught.value).constraint_name.startswith("fk_")


async def test_delete_of_service_with_appointment_is_rejected(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_appointment(tenant))
    await session.flush()
    with raises(IntegrityError) as caught:
        await session.delete(tenant.service)
        await session.flush()
    assert driver_error(caught.value).constraint_name == "fk_appointments_services"


# UNIQUE


async def test_slug_is_unique_ignoring_case(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_business(tenant, slug="Barbearia-Demo"))
    await session.flush()
    await assert_rejected_by(
        session, "uq_businesses_slug", build_business(tenant, slug="barbearia-DEMO")
    )


async def test_email_is_unique_across_businesses_ignoring_case(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    session.add(build_user(tenant, email="Pessoa@Example.com"))
    await session.flush()
    await assert_rejected_by(
        session, "uq_users_email", build_user(other_tenant, email="pessoa@example.COM")
    )


async def test_user_has_at_most_one_professional(
    session: AsyncSession, tenant: Tenant
) -> None:
    await assert_rejected_by(
        session,
        "uq_professionals_user_id",
        Professional(business_id=tenant.business.id, user_id=tenant.user.id),
    )


async def test_token_hashes_are_unique(session: AsyncSession, tenant: Tenant) -> None:
    def account_token() -> AccountToken:
        return AccountToken(
            user_id=tenant.user.id,
            purpose=AccountTokenPurpose.INVITE,
            token_hash="same",
            expires_at=T0,
        )

    session.add(account_token())
    await session.flush()
    await assert_rejected_by(session, "uq_account_tokens_token_hash", account_token())


async def test_refresh_token_hash_is_unique(
    session: AsyncSession, tenant: Tenant
) -> None:
    def refresh_token() -> RefreshToken:
        return RefreshToken(
            user_id=tenant.user.id,
            family_id=uuid4(),
            token_hash="same",
            expires_at=T0,
        )

    session.add(refresh_token())
    await session.flush()
    await assert_rejected_by(session, "uq_refresh_tokens_token_hash", refresh_token())


async def test_access_token_hash_is_unique_when_not_null(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_appointment(tenant, access_token_hash="same"))
    await session.flush()
    later = T0 + timedelta(days=1)
    await assert_rejected_by(
        session,
        "uq_appointments_access_token_hash",
        build_appointment(
            tenant,
            access_token_hash="same",
            starts_at=later,
            ends_at=later + timedelta(minutes=30),
            blocked_until=later + timedelta(minutes=30),
        ),
    )


async def test_several_manual_appointments_may_have_no_token(
    session: AsyncSession, tenant: Tenant
) -> None:
    for day in (1, 2):
        start = T0 + timedelta(days=day)
        session.add(
            build_appointment(
                tenant,
                starts_at=start,
                ends_at=start + timedelta(minutes=30),
                blocked_until=start + timedelta(minutes=30),
                origin=AppointmentOrigin.STAFF,
                customer_email=None,
                customer_phone=None,
                access_token_hash=None,
            )
        )
    await session.flush()


async def test_idempotency_key_is_unique_per_business(
    session: AsyncSession, tenant: Tenant, other_tenant: Tenant
) -> None:
    keyed = {"idempotency_key": "key", "idempotency_fingerprint": "hash"}
    session.add_all(
        [
            build_appointment(tenant, **keyed),
            build_appointment(other_tenant, **keyed),
        ]
    )
    await session.flush()
    later = T0 + timedelta(days=1)
    await assert_rejected_by(
        session,
        "uq_appointments_business_id_idempotency_key",
        build_appointment(
            tenant,
            starts_at=later,
            ends_at=later + timedelta(minutes=30),
            blocked_until=later + timedelta(minutes=30),
            **keyed,
        ),
    )


async def test_professional_service_primary_key_rejects_duplicates(
    session: AsyncSession, tenant: Tenant
) -> None:
    statement = """
        INSERT INTO professional_services (business_id, professional_id, service_id)
        VALUES (:business_id, :professional_id, :service_id)
    """
    params = {
        "business_id": tenant.business.id,
        "professional_id": tenant.professional.id,
        "service_id": tenant.service.id,
    }
    await session.execute(text(statement), params)
    await assert_sql_rejected_by(
        session, "pk_professional_services", statement, **params
    )


async def test_rate_limit_primary_key_rejects_duplicates(
    session: AsyncSession,
) -> None:
    statement = """
        INSERT INTO rate_limit_counters (key, window_start) VALUES ('hmac', :start)
    """
    await session.execute(text(statement), {"start": T0})
    await assert_sql_rejected_by(session, "pk_rate_limit_counters", statement, start=T0)


# NOT NULL


@mark.parametrize(
    ("build", "column"),
    [
        (build_business, "timezone"),
        (build_user, "name"),
        (build_user, "email"),
        (build_user, "role"),
        (build_service, "duration_minutes"),
        (build_service, "price_cents"),
        (build_time_block, "reason"),
        (build_working_hours, "weekday"),
        (build_appointment, "customer_name"),
        (build_appointment, "duration_minutes"),
        (build_appointment, "origin"),
        (build_outbox, "template"),
    ],
)
async def test_required_columns_reject_null(
    session: AsyncSession,
    tenant: Tenant,
    build: Callable[..., Base],
    column: str,
) -> None:
    with raises(IntegrityError) as caught:
        session.add(build(tenant, **{column: None}))
        await session.flush()
    assert caught.value.orig.sqlstate == NOT_NULL_VIOLATION
    assert driver_error(caught.value).column_name == column


async def test_password_hash_is_null_until_the_invite_is_accepted(
    session: AsyncSession, tenant: Tenant
) -> None:
    assert tenant.user.password_hash is None


# CHECK


@mark.parametrize(
    ("build", "overrides", "constraint"),
    [
        (
            build_business,
            {"slot_step_minutes": 7},
            "ck_businesses_slot_step_minutes_allowed",
        ),
        (
            build_business,
            {"min_advance_minutes": -1},
            "ck_businesses_min_advance_minutes_non_negative",
        ),
        (
            build_business,
            {"max_advance_days": 0},
            "ck_businesses_max_advance_days_positive",
        ),
        (
            build_business,
            {"change_deadline_minutes": -1},
            "ck_businesses_change_deadline_minutes_non_negative",
        ),
        (
            build_service,
            {"duration_minutes": 0},
            "ck_services_duration_minutes_positive",
        ),
        (
            build_service,
            {"preparation_minutes": -1},
            "ck_services_preparation_minutes_non_negative",
        ),
        (build_service, {"price_cents": -1}, "ck_services_price_cents_non_negative"),
        (
            build_working_hours,
            {"start_time": time(18), "end_time": time(18)},
            "ck_working_hours_end_after_start",
        ),
        (build_working_hours, {"weekday": 7}, "ck_working_hours_weekday_range"),
        (build_working_hours, {"weekday": -1}, "ck_working_hours_weekday_range"),
        (build_time_block, {"ends_at": T0}, "ck_time_blocks_ends_after_starts"),
        (
            build_appointment,
            {"ends_at": T0, "blocked_until": T0},
            "ck_appointments_times_ordered",
        ),
        (
            build_appointment,
            {"blocked_until": T0 + timedelta(minutes=10)},
            "ck_appointments_times_ordered",
        ),
        (
            build_appointment,
            {"duration_minutes": 0},
            "ck_appointments_duration_minutes_positive",
        ),
        (
            build_appointment,
            {"preparation_minutes": -1},
            "ck_appointments_preparation_minutes_non_negative",
        ),
        (
            build_appointment,
            {"price_cents": -1},
            "ck_appointments_price_cents_non_negative",
        ),
        (
            build_appointment,
            {"customer_email": None},
            "ck_appointments_public_requires_contact",
        ),
        (
            build_appointment,
            {"customer_phone": None},
            "ck_appointments_public_requires_contact",
        ),
        (
            build_appointment,
            {"access_token_hash": None},
            "ck_appointments_access_token_required",
        ),
        (
            build_appointment,
            {"origin": AppointmentOrigin.STAFF, "access_token_hash": None},
            "ck_appointments_access_token_required",
        ),
        (
            build_appointment,
            {"idempotency_key": "key"},
            "ck_appointments_idempotency_fields_paired",
        ),
        (
            build_appointment,
            {"idempotency_fingerprint": "hash"},
            "ck_appointments_idempotency_fields_paired",
        ),
        (build_outbox, {"attempts": -1}, "ck_email_outbox_attempts_non_negative"),
        (
            build_outbox,
            {"to_email": None},
            "ck_email_outbox_pending_requires_recipient_and_payload",
        ),
        (
            build_outbox,
            {"payload": None},
            "ck_email_outbox_pending_requires_recipient_and_payload",
        ),
        (
            build_outbox,
            {"status": EmailOutboxStatus.SENT},
            "ck_email_outbox_finished_requires_no_payload",
        ),
    ],
)
async def test_check_constraints_reject_invalid_values(
    session: AsyncSession,
    tenant: Tenant,
    build: Callable[..., Base],
    overrides: dict[str, Any],
    constraint: str,
) -> None:
    await assert_rejected_by(session, constraint, build(tenant, **overrides))


async def test_manual_appointment_without_contact_is_accepted(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(
        build_appointment(
            tenant,
            origin=AppointmentOrigin.STAFF,
            customer_email=None,
            customer_phone=None,
            access_token_hash=None,
        )
    )
    await session.flush()


async def test_finished_outbox_message_stores_sql_null_payload(
    session: AsyncSession, tenant: Tenant
) -> None:
    message = build_outbox(tenant)
    session.add(message)
    await session.flush()

    message.status = EmailOutboxStatus.SENT
    message.payload = None
    message.to_email = None
    await session.flush()

    payload_is_null = await session.scalar(
        text("SELECT payload IS NULL FROM email_outbox WHERE id = :id"),
        {"id": message.id},
    )
    assert payload_is_null is True


@mark.parametrize(
    ("table", "column", "value", "constraint"),
    [
        ("users", "role", "admin", "ck_users_role_valid"),
        ("appointments", "status", "pending", "ck_appointments_status_valid"),
        ("appointments", "origin", "phone", "ck_appointments_origin_valid"),
    ],
)
async def test_enum_columns_reject_unknown_values(
    session: AsyncSession,
    tenant: Tenant,
    table: str,
    column: str,
    value: str,
    constraint: str,
) -> None:
    # Raw SQL: TextEnum would refuse the value before it reached the database.
    session.add_all([build_appointment(tenant), build_outbox(tenant)])
    await session.flush()
    await assert_sql_rejected_by(
        session, constraint, f"UPDATE {table} SET {column} = :value", value=value
    )


async def test_outbox_status_rejects_unknown_values(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_outbox(tenant))
    await session.flush()
    # Clears the payload so that only the status constraint is violated.
    await assert_sql_rejected_by(
        session,
        "ck_email_outbox_status_valid",
        "UPDATE email_outbox SET status = 'queued', payload = NULL",
    )


async def test_account_token_purpose_rejects_unknown_values(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(
        AccountToken(
            user_id=tenant.user.id,
            purpose=AccountTokenPurpose.PASSWORD_RESET,
            token_hash="hash",
            expires_at=T0,
        )
    )
    await session.flush()
    await assert_sql_rejected_by(
        session,
        "ck_account_tokens_purpose_valid",
        "UPDATE account_tokens SET purpose = 'magic_link'",
    )


async def test_enum_values_are_loaded_as_enum_members(
    session: AsyncSession, tenant: Tenant
) -> None:
    role = await session.scalar(select(User.role).where(User.id == tenant.user.id))
    assert role is UserRole.PROFESSIONAL


# EXCLUDE


async def test_overlapping_appointments_are_rejected(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_appointment(tenant))
    await session.flush()
    # Starts during the preparation time of the first one.
    start = T0 + timedelta(minutes=35)
    await assert_rejected_by(
        session,
        "appointments_no_overlap",
        build_appointment(
            tenant,
            starts_at=start,
            ends_at=start + timedelta(minutes=30),
            blocked_until=start + timedelta(minutes=30),
        ),
    )


async def test_appointment_may_start_exactly_when_the_block_ends(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_appointment(tenant))
    await session.flush()
    start = T0 + timedelta(minutes=40)
    session.add(
        build_appointment(
            tenant,
            starts_at=start,
            ends_at=start + timedelta(minutes=30),
            blocked_until=start + timedelta(minutes=30),
        )
    )
    await session.flush()


async def test_cancelled_appointment_frees_the_slot(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_appointment(tenant, status=AppointmentStatus.CANCELLED))
    await session.flush()
    session.add(build_appointment(tenant))
    await session.flush()


@mark.parametrize("status", [AppointmentStatus.COMPLETED, AppointmentStatus.NO_SHOW])
async def test_final_status_other_than_cancelled_keeps_the_slot(
    session: AsyncSession, tenant: Tenant, status: AppointmentStatus
) -> None:
    session.add(build_appointment(tenant, status=status))
    await session.flush()
    await assert_rejected_by(
        session, "appointments_no_overlap", build_appointment(tenant)
    )


async def test_same_time_with_different_professionals_is_accepted(
    session: AsyncSession, tenant: Tenant
) -> None:
    user = await make_user(session, tenant.business)
    second = Professional(business_id=tenant.business.id, user_id=user.id)
    session.add(second)
    await session.flush()
    session.add_all(
        [
            build_appointment(tenant),
            build_appointment(tenant, professional_id=second.id),
        ]
    )
    await session.flush()


async def test_overlapping_time_blocks_are_rejected(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_time_block(tenant))
    await session.flush()
    await assert_rejected_by(
        session,
        "time_blocks_no_overlap",
        build_time_block(
            tenant,
            starts_at=T0 + timedelta(minutes=30),
            ends_at=T0 + timedelta(hours=2),
        ),
    )


async def test_time_block_may_start_exactly_when_another_ends(
    session: AsyncSession, tenant: Tenant
) -> None:
    session.add(build_time_block(tenant))
    await session.flush()
    session.add(
        build_time_block(
            tenant,
            starts_at=T0 + timedelta(hours=1),
            ends_at=T0 + timedelta(hours=2),
        )
    )
    await session.flush()


# updated_at


async def test_updated_at_changes_on_orm_update(migrated_database_url: str) -> None:
    # Commits for real: now() is constant inside a single transaction.
    engine = create_async_engine(migrated_database_url, poolclass=NullPool)
    async with AsyncSession(engine, expire_on_commit=False) as db_session:
        business = Business(name="A", slug=str(uuid4()), timezone="UTC")
        db_session.add(business)
        await db_session.commit()
        first_update = business.updated_at

        business.name = "B"
        await db_session.commit()
        assert business.updated_at > first_update
        assert business.created_at == first_update

        await db_session.delete(business)
        await db_session.commit()
    await engine.dispose()
