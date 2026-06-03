"""
init_db.py — Drop all tables and recreate the schema from SQLAlchemy models.
Called by dev.sh on every local start after the Postgres container is wiped.
"""
import sys

from app.database import Base, engine
import app.models  # noqa: F401 — registers all models against Base


def main() -> None:
    print("Creating schema...")
    Base.metadata.create_all(bind=engine)
    table_names = ", ".join(sorted(Base.metadata.tables.keys()))
    print(f"Tables created: {table_names}")


if __name__ == "__main__":
    try:
        main()
    except Exception as exc:
        print(f"ERROR: {exc}", file=sys.stderr)
        sys.exit(1)
