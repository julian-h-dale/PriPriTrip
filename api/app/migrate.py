"""Bring the database up to the latest schema (Alembic), safely, from anywhere.

    python -m app.migrate            # upgrade to head   (make migrate)
    python -m app.migrate --reset    # delete the SQLite file first (make reset-db)

A database created before Alembic — by the `rebuild` branch's `create_all`,
which is what the first Fly deploy runs — has the tables but no
`alembic_version`. Its schema is exactly migration 0001, so it is *stamped*
at 0001 (recorded as already there) and then upgraded; its data is kept.

The app server never migrates on its own: deploy/start.sh, api/dev.sh and
the seed script call this first.
"""

from __future__ import annotations

import asyncio
import sys
from pathlib import Path

from alembic import command
from alembic.config import Config
from sqlalchemy import inspect
from sqlalchemy.ext.asyncio import create_async_engine

from app.settings import get_app_settings

BASELINE = "0001"
_API_DIR = Path(__file__).resolve().parent.parent


def alembic_config(url: str | None = None, *, quiet: bool = False) -> Config:
    cfg = Config(str(_API_DIR / "alembic.ini"))
    cfg.set_main_option("script_location", str(_API_DIR / "migrations"))
    if url:
        cfg.set_main_option("sqlalchemy.url", url)
    if quiet:
        cfg.attributes["configure_logging"] = False
    return cfg


def _table_names(url: str) -> set[str]:
    async def run() -> set[str]:
        engine = create_async_engine(url)
        try:
            async with engine.connect() as conn:
                return set(await conn.run_sync(lambda c: inspect(c).get_table_names()))
        finally:
            await engine.dispose()

    return asyncio.run(run())


def migrate(url: str | None = None, *, quiet: bool = False) -> None:
    """Upgrade to head, first stamping a pre-Alembic database at the baseline."""
    url = url or get_app_settings().database_url
    cfg = alembic_config(url, quiet=quiet)
    tables = _table_names(url)
    if "alembic_version" not in tables and "trips" in tables:
        command.stamp(cfg, BASELINE)
    command.upgrade(cfg, "head")


def sqlite_file(url: str) -> Path | None:
    """The file behind a file-based SQLite URL, else None."""
    if not url.startswith("sqlite") or ":///" not in url:
        return None
    path = url.split(":///", 1)[1]
    return None if not path or path == ":memory:" else Path(path)


def reset(url: str | None = None) -> None:
    """Delete the dev SQLite database (whichever one DATABASE_URL names —
    a worktree's own, too), then migrate a fresh one."""
    url = url or get_app_settings().database_url
    path = sqlite_file(url)
    if path is None:
        raise SystemExit(f"Refusing to reset a non-file database: {url}")
    path.unlink(missing_ok=True)
    print(f"  deleted {path}")
    migrate(url)


if __name__ == "__main__":
    reset() if "--reset" in sys.argv[1:] else migrate()
