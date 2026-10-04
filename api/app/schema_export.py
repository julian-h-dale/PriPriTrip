"""Write (or check) the published trip-document JSON Schema.

    python -m app.schema_export          # regenerate schema/trip.schema.json
    python -m app.schema_export --check  # exit 1 if the committed file is stale

Run via `make schema`. Never hand-edit the output.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

from app.trip_document import trip_json_schema

SCHEMA_PATH = Path(__file__).resolve().parents[2] / "schema" / "trip.schema.json"


def render_schema() -> str:
    return json.dumps(trip_json_schema(), indent=2, ensure_ascii=False) + "\n"


def main(argv: list[str]) -> int:
    rendered = render_schema()
    if "--check" in argv:
        current = SCHEMA_PATH.read_text(encoding="utf-8") if SCHEMA_PATH.exists() else ""
        if current != rendered:
            print(f"{SCHEMA_PATH} is stale — run `make schema`.", file=sys.stderr)
            return 1
        print(f"{SCHEMA_PATH} is up to date.")
        return 0
    SCHEMA_PATH.parent.mkdir(parents=True, exist_ok=True)
    SCHEMA_PATH.write_text(rendered, encoding="utf-8")
    print(f"Wrote {SCHEMA_PATH}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
