"""Initial schema: extensions, the 12 tables, constraints and indexes.

Revision ID: 0001
Revises:
Create Date: 2026-11-06 02:10:13.374526

"""

from collections.abc import Sequence

import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "0001"
down_revision: str | Sequence[str] | None = None
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS citext")
    op.execute("CREATE EXTENSION IF NOT EXISTS btree_gist")
    op.create_table(
        "businesses",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("slug", postgresql.CITEXT(), nullable=False),
        sa.Column("timezone", sa.Text(), nullable=False),
        sa.Column(
            "slot_step_minutes",
            sa.Integer(),
            server_default=sa.text("15"),
            nullable=False,
        ),
        sa.Column(
            "min_advance_minutes",
            sa.Integer(),
            server_default=sa.text("60"),
            nullable=False,
        ),
        sa.Column(
            "max_advance_days",
            sa.Integer(),
            server_default=sa.text("30"),
            nullable=False,
        ),
        sa.Column(
            "change_deadline_minutes",
            sa.Integer(),
            server_default=sa.text("120"),
            nullable=False,
        ),
        sa.Column(
            "is_demo", sa.Boolean(), server_default=sa.text("false"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "change_deadline_minutes >= 0",
            name=op.f("ck_businesses_change_deadline_minutes_non_negative"),
        ),
        sa.CheckConstraint(
            "max_advance_days > 0", name=op.f("ck_businesses_max_advance_days_positive")
        ),
        sa.CheckConstraint(
            "min_advance_minutes >= 0",
            name=op.f("ck_businesses_min_advance_minutes_non_negative"),
        ),
        sa.CheckConstraint(
            "slot_step_minutes IN (5, 10, 15, 20, 30, 60)",
            name=op.f("ck_businesses_slot_step_minutes_allowed"),
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_businesses")),
        sa.UniqueConstraint("slug", name=op.f("uq_businesses_slug")),
    )
    op.create_table(
        "users",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("email", postgresql.CITEXT(), nullable=False),
        sa.Column("password_hash", sa.Text(), nullable=True),
        sa.Column("role", sa.Text(), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "role IN ('owner', 'professional')", name=op.f("ck_users_role_valid")
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            name=op.f("fk_users_businesses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_users")),
        sa.UniqueConstraint("business_id", "id", name=op.f("uq_users_business_id_id")),
        sa.UniqueConstraint("email", name=op.f("uq_users_email")),
    )
    op.create_table(
        "professionals",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column(
            "is_bookable", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "user_id"],
            ["users.business_id", "users.id"],
            name=op.f("fk_professionals_users"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            name=op.f("fk_professionals_businesses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_professionals")),
        sa.UniqueConstraint(
            "business_id", "id", name=op.f("uq_professionals_business_id_id")
        ),
        sa.UniqueConstraint("user_id", name=op.f("uq_professionals_user_id")),
    )
    op.create_table(
        "account_tokens",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("purpose", sa.Text(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "purpose IN ('invite', 'password_reset')",
            name=op.f("ck_account_tokens_purpose_valid"),
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_account_tokens_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_account_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_account_tokens_token_hash")),
    )
    op.create_index(
        "ix_account_tokens_user_id", "account_tokens", ["user_id"], unique=False
    )
    op.create_table(
        "refresh_tokens",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("user_id", sa.Uuid(), nullable=False),
        sa.Column("family_id", sa.Uuid(), nullable=False),
        sa.Column("token_hash", sa.Text(), nullable=False),
        sa.Column("expires_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("used_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("revoked_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["user_id"],
            ["users.id"],
            name=op.f("fk_refresh_tokens_users"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_refresh_tokens")),
        sa.UniqueConstraint("token_hash", name=op.f("uq_refresh_tokens_token_hash")),
    )
    op.create_index(
        "ix_refresh_tokens_family_id", "refresh_tokens", ["family_id"], unique=False
    )
    op.create_index(
        "ix_refresh_tokens_user_id", "refresh_tokens", ["user_id"], unique=False
    )
    op.create_table(
        "services",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("name", sa.Text(), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column(
            "preparation_minutes",
            sa.Integer(),
            server_default=sa.text("0"),
            nullable=False,
        ),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column(
            "is_active", sa.Boolean(), server_default=sa.text("true"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "duration_minutes > 0", name=op.f("ck_services_duration_minutes_positive")
        ),
        sa.CheckConstraint(
            "preparation_minutes >= 0",
            name=op.f("ck_services_preparation_minutes_non_negative"),
        ),
        sa.CheckConstraint(
            "price_cents >= 0", name=op.f("ck_services_price_cents_non_negative")
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            name=op.f("fk_services_businesses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_services")),
        sa.UniqueConstraint(
            "business_id", "id", name=op.f("uq_services_business_id_id")
        ),
    )
    op.create_table(
        "professional_services",
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("professional_id", sa.Uuid(), nullable=False),
        sa.Column("service_id", sa.Uuid(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "professional_id"],
            ["professionals.business_id", "professionals.id"],
            name=op.f("fk_professional_services_professionals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "service_id"],
            ["services.business_id", "services.id"],
            name=op.f("fk_professional_services_services"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            name=op.f("fk_professional_services_businesses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint(
            "professional_id", "service_id", name=op.f("pk_professional_services")
        ),
    )
    op.create_index(
        "ix_professional_services_service_id",
        "professional_services",
        ["service_id"],
        unique=False,
    )
    op.create_table(
        "working_hours",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("professional_id", sa.Uuid(), nullable=False),
        sa.Column("weekday", sa.SmallInteger(), nullable=False),
        sa.Column("start_time", sa.Time(), nullable=False),
        sa.Column("end_time", sa.Time(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.CheckConstraint(
            "end_time > start_time", name=op.f("ck_working_hours_end_after_start")
        ),
        sa.CheckConstraint(
            "weekday BETWEEN 0 AND 6", name=op.f("ck_working_hours_weekday_range")
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "professional_id"],
            ["professionals.business_id", "professionals.id"],
            name=op.f("fk_working_hours_professionals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            name=op.f("fk_working_hours_businesses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_working_hours")),
    )
    op.create_index(
        "ix_working_hours_professional_id_weekday",
        "working_hours",
        ["professional_id", "weekday"],
        unique=False,
    )
    op.create_table(
        "time_blocks",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("professional_id", sa.Uuid(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("reason", sa.Text(), nullable=False),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        postgresql.ExcludeConstraint(
            (sa.column("professional_id"), "="),
            (sa.text("tstzrange(starts_at, ends_at, '[)')"), "&&"),
            using="gist",
            name="time_blocks_no_overlap",
        ),
        sa.CheckConstraint(
            "ends_at > starts_at", name=op.f("ck_time_blocks_ends_after_starts")
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "professional_id"],
            ["professionals.business_id", "professionals.id"],
            name=op.f("fk_time_blocks_professionals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            name=op.f("fk_time_blocks_businesses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_time_blocks")),
    )
    op.create_table(
        "appointments",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column("business_id", sa.Uuid(), nullable=False),
        sa.Column("professional_id", sa.Uuid(), nullable=False),
        sa.Column("service_id", sa.Uuid(), nullable=False),
        sa.Column("starts_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("ends_at", sa.DateTime(timezone=True), nullable=False),
        sa.Column("blocked_until", sa.DateTime(timezone=True), nullable=False),
        sa.Column("duration_minutes", sa.Integer(), nullable=False),
        sa.Column("preparation_minutes", sa.Integer(), nullable=False),
        sa.Column("price_cents", sa.Integer(), nullable=False),
        sa.Column("customer_name", sa.Text(), nullable=False),
        sa.Column("customer_email", postgresql.CITEXT(), nullable=True),
        sa.Column("customer_phone", sa.Text(), nullable=True),
        sa.Column(
            "status", sa.Text(), server_default=sa.text("'confirmed'"), nullable=False
        ),
        sa.Column("origin", sa.Text(), nullable=False),
        sa.Column("access_token_hash", sa.Text(), nullable=True),
        sa.Column(
            "link_email_skipped",
            sa.Boolean(),
            server_default=sa.text("false"),
            nullable=False,
        ),
        sa.Column("idempotency_key", sa.Text(), nullable=True),
        sa.Column("idempotency_fingerprint", sa.Text(), nullable=True),
        sa.Column("cancelled_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column(
            "updated_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        postgresql.ExcludeConstraint(
            (sa.column("professional_id"), "="),
            (sa.text("tstzrange(starts_at, blocked_until, '[)')"), "&&"),
            where=sa.text("status <> 'cancelled'"),
            using="gist",
            name="appointments_no_overlap",
        ),
        sa.CheckConstraint(
            "access_token_hash IS NOT NULL "
            "OR (origin = 'staff' AND customer_email IS NULL)",
            name=op.f("ck_appointments_access_token_required"),
        ),
        sa.CheckConstraint(
            "origin <> 'public' "
            "OR (customer_email IS NOT NULL AND customer_phone IS NOT NULL)",
            name=op.f("ck_appointments_public_requires_contact"),
        ),
        sa.CheckConstraint(
            "origin IN ('public', 'staff')", name=op.f("ck_appointments_origin_valid")
        ),
        sa.CheckConstraint(
            "status IN ('confirmed', 'cancelled', 'completed', 'no_show')",
            name=op.f("ck_appointments_status_valid"),
        ),
        sa.CheckConstraint(
            "(idempotency_key IS NULL) = (idempotency_fingerprint IS NULL)",
            name=op.f("ck_appointments_idempotency_fields_paired"),
        ),
        sa.CheckConstraint(
            "duration_minutes > 0",
            name=op.f("ck_appointments_duration_minutes_positive"),
        ),
        sa.CheckConstraint(
            "ends_at > starts_at AND blocked_until >= ends_at",
            name=op.f("ck_appointments_times_ordered"),
        ),
        sa.CheckConstraint(
            "preparation_minutes >= 0",
            name=op.f("ck_appointments_preparation_minutes_non_negative"),
        ),
        sa.CheckConstraint(
            "price_cents >= 0", name=op.f("ck_appointments_price_cents_non_negative")
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "professional_id"],
            ["professionals.business_id", "professionals.id"],
            name=op.f("fk_appointments_professionals"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id", "service_id"],
            ["services.business_id", "services.id"],
            name=op.f("fk_appointments_services"),
            ondelete="RESTRICT",
        ),
        sa.ForeignKeyConstraint(
            ["business_id"],
            ["businesses.id"],
            name=op.f("fk_appointments_businesses"),
            ondelete="RESTRICT",
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_appointments")),
    )
    op.create_index(
        "ix_appointments_business_id_professional_id_starts_at",
        "appointments",
        ["business_id", "professional_id", "starts_at"],
        unique=False,
    )
    op.create_index(
        "ix_appointments_business_id_starts_at",
        "appointments",
        ["business_id", "starts_at"],
        unique=False,
    )
    op.create_index(
        "uq_appointments_access_token_hash",
        "appointments",
        ["access_token_hash"],
        unique=True,
        postgresql_where=sa.text("access_token_hash IS NOT NULL"),
    )
    op.create_index(
        "uq_appointments_business_id_idempotency_key",
        "appointments",
        ["business_id", "idempotency_key"],
        unique=True,
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.create_table(
        "email_outbox",
        sa.Column(
            "id", sa.Uuid(), server_default=sa.text("gen_random_uuid()"), nullable=False
        ),
        sa.Column(
            "created_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("to_email", sa.Text(), nullable=True),
        sa.Column("template", sa.Text(), nullable=False),
        sa.Column(
            "payload",
            postgresql.JSONB(none_as_null=True, astext_type=sa.Text()),
            nullable=True,
        ),
        sa.Column(
            "status", sa.Text(), server_default=sa.text("'pending'"), nullable=False
        ),
        sa.Column(
            "attempts", sa.Integer(), server_default=sa.text("0"), nullable=False
        ),
        sa.Column(
            "next_attempt_at",
            sa.DateTime(timezone=True),
            server_default=sa.text("now()"),
            nullable=False,
        ),
        sa.Column("sent_at", sa.DateTime(timezone=True), nullable=True),
        sa.Column("last_error", sa.Text(), nullable=True),
        sa.CheckConstraint(
            "status <> 'pending' OR (to_email IS NOT NULL AND payload IS NOT NULL)",
            name=op.f("ck_email_outbox_pending_requires_recipient_and_payload"),
        ),
        sa.CheckConstraint(
            "status = 'pending' OR payload IS NULL",
            name=op.f("ck_email_outbox_finished_requires_no_payload"),
        ),
        sa.CheckConstraint(
            "status IN ('pending', 'sent', 'failed')",
            name=op.f("ck_email_outbox_status_valid"),
        ),
        sa.CheckConstraint(
            "attempts >= 0", name=op.f("ck_email_outbox_attempts_non_negative")
        ),
        sa.PrimaryKeyConstraint("id", name=op.f("pk_email_outbox")),
    )
    op.create_index(
        "ix_email_outbox_next_attempt_at",
        "email_outbox",
        ["next_attempt_at"],
        unique=False,
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.create_table(
        "rate_limit_counters",
        sa.Column("key", sa.Text(), nullable=False),
        sa.Column("window_start", sa.DateTime(timezone=True), nullable=False),
        sa.Column("count", sa.Integer(), server_default=sa.text("0"), nullable=False),
        sa.PrimaryKeyConstraint(
            "key", "window_start", name=op.f("pk_rate_limit_counters")
        ),
    )


def downgrade() -> None:
    op.drop_table("rate_limit_counters")
    op.drop_index(
        "ix_email_outbox_next_attempt_at",
        table_name="email_outbox",
        postgresql_where=sa.text("status = 'pending'"),
    )
    op.drop_table("email_outbox")
    op.drop_index(
        "uq_appointments_business_id_idempotency_key",
        table_name="appointments",
        postgresql_where=sa.text("idempotency_key IS NOT NULL"),
    )
    op.drop_index(
        "uq_appointments_access_token_hash",
        table_name="appointments",
        postgresql_where=sa.text("access_token_hash IS NOT NULL"),
    )
    op.drop_index("ix_appointments_business_id_starts_at", table_name="appointments")
    op.drop_index(
        "ix_appointments_business_id_professional_id_starts_at",
        table_name="appointments",
    )
    op.drop_table("appointments")
    op.drop_table("time_blocks")
    op.drop_index(
        "ix_working_hours_professional_id_weekday", table_name="working_hours"
    )
    op.drop_table("working_hours")
    op.drop_index(
        "ix_professional_services_service_id", table_name="professional_services"
    )
    op.drop_table("professional_services")
    op.drop_table("services")
    op.drop_index("ix_refresh_tokens_user_id", table_name="refresh_tokens")
    op.drop_index("ix_refresh_tokens_family_id", table_name="refresh_tokens")
    op.drop_table("refresh_tokens")
    op.drop_index("ix_account_tokens_user_id", table_name="account_tokens")
    op.drop_table("account_tokens")
    op.drop_table("professionals")
    op.drop_table("users")
    op.drop_table("businesses")
    op.execute("DROP EXTENSION IF EXISTS btree_gist")
    op.execute("DROP EXTENSION IF EXISTS citext")
