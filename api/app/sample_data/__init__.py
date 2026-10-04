"""The sample trip document: seed data, test fixture, and schema example."""

from __future__ import annotations

import json
from pathlib import Path
from typing import Any

SAMPLE_TRIP_PATH = Path(__file__).with_name("sample_trip.json")


def load_sample_trip() -> dict[str, Any]:
    """A fresh copy of the sample document, safe for a caller to mutate."""
    data: dict[str, Any] = json.loads(SAMPLE_TRIP_PATH.read_text(encoding="utf-8"))
    return data
