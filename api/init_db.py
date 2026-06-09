"""
init_db.py — Drop all tables and recreate the schema from SQLAlchemy models.
Called by dev.sh on every local start after the Postgres container is wiped.
"""
import asyncio
import sys

from app.database import Base, engine
import app.models  # noqa: F401 — registers all models against Base


async def main() -> None:
    print("Creating schema...")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    table_names = ", ".join(sorted(Base.metadata.tables.keys()))
    print(f"Tables created: {table_names}")
    await engine.dispose()


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
