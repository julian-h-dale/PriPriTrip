"""Alembic migrations: the schema they build is the models' schema, and a
database from before Alembic (the rebuild deploy) upgrades with its data."""

from __future__ import annotations

import asyncio
from pathlib import Path
from typing import Any

import pytest
from alembic import command
from alembic.autogenerate import compare_metadata
from alembic.runtime.migration import MigrationContext
from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

from app.migrate import BASELINE, alembic_config, migrate, reset
from app.models import Base

# The latest migration: bump it with each new one.
HEAD = "0012"


def _url(tmp_path: Path) -> str:
    return f"sqlite+aiosqlite:///{tmp_path / 'app.db'}"


def _run(url: str, statements: list[str]) -> list[Any]:
    async def go() -> list[Any]:
        engine = create_async_engine(url)
        rows: list[Any] = []
        async with engine.begin() as conn:
            for sql in statements:
                result = await conn.execute(text(sql))
                if result.returns_rows:
                    rows = list(result.all())
        await engine.dispose()
        return rows

    return asyncio.run(go())


def _diffs(url: str) -> list[Any]:
    async def go() -> list[Any]:
        engine = create_async_engine(url)
        async with engine.connect() as conn:
            diffs = await conn.run_sync(
                lambda c: compare_metadata(
                    MigrationContext.configure(c, opts={"compare_type": True}), Base.metadata
                )
            )
        await engine.dispose()
        return diffs

    return asyncio.run(go())


def test_migrations_build_exactly_the_models_schema(tmp_path: Path) -> None:
    """Fails when a model changes without a migration (or vice versa)."""
    url = _url(tmp_path)
    migrate(url, quiet=True)
    assert _diffs(url) == []
    assert _run(url, ["SELECT version_num FROM alembic_version"]) == [(HEAD,)]


def test_a_pre_alembic_database_is_stamped_and_upgraded_with_its_data(tmp_path: Path) -> None:
    """The rebuild deploy's database: baseline tables, data, no alembic_version."""
    url = _url(tmp_path)
    command.upgrade(alembic_config(url, quiet=True), BASELINE)
    _run(
        url,
        [
            "DROP TABLE alembic_version",  # create_all never made one
            "INSERT INTO users (id, email, hashed_password, is_active, is_superuser, is_verified,"
            " name, timezone) VALUES ('11111111111111111111111111111111', 'u@x.com', 'x', 1, 0,"
            " 1, '', 'UTC')",
            "INSERT INTO trips (id, user_id, name, start_date, end_date, timezone, is_deleted)"
            " VALUES ('22222222222222222222222222222222', '11111111111111111111111111111111',"
            " 'Okinawa', '2026-10-29', '2026-11-13', 'Asia/Tokyo', 0)",
            "INSERT INTO memories (id, trip_id, user_id, text, zone, created_at, is_deleted)"
            " VALUES ('33333333333333333333333333333333', '22222222222222222222222222222222',"
            " '11111111111111111111111111111111', 'kept', 'Asia/Tokyo',"
            " '2026-10-30 12:00:00.000000', 0)",
            # A day with an activity on it: a migration that rebuilt `days`
            # would trip the activity's foreign key (0006 must not).
            "INSERT INTO days (id, trip_id, date, is_deleted) VALUES"
            " ('44444444444444444444444444444444', '22222222222222222222222222222222',"
            " '2026-10-30', 0)",
            "INSERT INTO items (id, day_id, position, title, is_deleted) VALUES"
            " ('55555555555555555555555555555555', '44444444444444444444444444444444', 0,"
            " 'Kokusai Street', 0)",
        ],
    )

    migrate(url, quiet=True)

    assert _run(url, ["SELECT version_num FROM alembic_version"]) == [(HEAD,)]
    assert _run(url, ["SELECT name FROM trips"]) == [("Okinawa",)]
    # Before Phase 29, created_at was the server's stamp: it becomes received_at.
    assert _run(url, ["SELECT text, received_at FROM memories"]) == [
        ("kept", "2026-10-30 12:00:00.000000")
    ]
    # Every memory written before Phase 46 is private.
    assert _run(url, ["SELECT is_public FROM memories"]) == [(0,)]
    assert _run(url, ["SELECT view_code FROM trips"]) == [(None,)]
    # Existing accounts don't have to change their password (Phase 54).
    assert _run(url, ["SELECT must_change_password FROM users"]) == [(0,)]
    # Existing entries start at version 1, with no editor yet.
    assert _run(url, ["SELECT title, version, updated_by FROM items"]) == [
        ("Kokusai Street", 1, None)
    ]
    assert _run(url, ["SELECT version FROM days"]) == [(1,)]
    assert _diffs(url) == []


def test_migrate_is_idempotent_and_downgrade_round_trips(tmp_path: Path) -> None:
    url = _url(tmp_path)
    migrate(url, quiet=True)
    migrate(url, quiet=True)  # nothing to do the second time
    command.downgrade(alembic_config(url, quiet=True), BASELINE)
    assert "received_at" not in str(_run(url, ["PRAGMA table_info(memories)"]))
    migrate(url, quiet=True)
    assert _diffs(url) == []


def test_reset_only_deletes_a_file_database(tmp_path: Path) -> None:
    with pytest.raises(SystemExit):
        reset("sqlite+aiosqlite:///:memory:")
