#!/usr/bin/env python3
"""
Convert an app trip JSON (days/points model) into a realistic, flat itinerary
spreadsheet (.xlsx) that resembles something a user would actually upload.

The goal is a TEST FIXTURE for the AI import pipeline, so it deliberately:
  - drops internal UUIDs (dayId/pointId/locationId)
  - drops enrichment fields (lat/lng, googlePlaceId, googleMapsUri, fullAddress)
  - drops long descriptions (the AI "enhance" pass is expected to fill these in)

It keeps the factual scaffolding a traveller would type: dates, titles, times,
travel mode / stay type, confirmation numbers and location names.

Usage:
    python3 data/json_to_xlsx.py [input.json] [output.xlsx]

Defaults: data/trip.json -> data/trip_example.xlsx
"""

import json
import sys
from pathlib import Path

from openpyxl import Workbook
from openpyxl.styles import Alignment, Font, PatternFill
from openpyxl.utils import get_column_letter


HEADERS = [
    "Date",
    "Day",
    "Type",
    "Title",
    "Start Time",
    "End Time",
    "Travel Mode",
    "Stay Type",
    "Confirmation #",
    "Locations",
]


def _time_only(dt: str | None) -> str:
    """Return HH:MM from an ISO datetime, or '' if missing."""
    if not dt:
        return ""
    # e.g. "2026-05-11T12:15:00+02:00" -> "12:15"
    try:
        return dt.split("T", 1)[1][:5]
    except IndexError:
        return ""


def _locations(point: dict) -> str:
    parts = []
    for loc in point.get("locations", []):
        name = loc.get("name", "").strip()
        if not name:
            continue
        role = loc.get("role")
        parts.append(f"{name} ({role})" if role else name)
    return "; ".join(parts)


def build_rows(trip: dict) -> list[list[str]]:
    rows: list[list[str]] = []
    for day in trip.get("days", []):
        day_title = day.get("title", "")
        date = day.get("date", "")
        points = day.get("points", [])
        if not points:
            rows.append([date, day_title, "", "", "", "", "", "", "", ""])
            continue
        for point in points:
            travel = point.get("travelDetail") or {}
            stay = point.get("stayDetail") or {}
            rows.append(
                [
                    date,
                    day_title,
                    point.get("type", ""),
                    point.get("title", ""),
                    _time_only(point.get("startDateTime")),
                    _time_only(point.get("endDateTime")),
                    travel.get("mode", "") or "",
                    stay.get("stayType", "") or "",
                    point.get("confirmationNumber") or "",
                    _locations(point),
                ]
            )
    return rows


def write_workbook(trip: dict, rows: list[list[str]], out_path: Path) -> None:
    wb = Workbook()

    # ── Trip summary sheet ────────────────────────────────────────────────
    summary = wb.active
    summary.title = "Trip"
    summary["A1"] = "Trip Name"
    summary["B1"] = trip.get("tripName", "")
    summary["A2"] = "Start Date"
    summary["B2"] = trip.get("startDate", "")
    summary["A3"] = "End Date"
    summary["B3"] = trip.get("endDate", "")
    for r in range(1, 4):
        summary[f"A{r}"].font = Font(bold=True)
    summary.column_dimensions["A"].width = 16
    summary.column_dimensions["B"].width = 48

    # ── Itinerary sheet (flat, user-style) ────────────────────────────────
    ws = wb.create_sheet("Itinerary")
    header_fill = PatternFill("solid", fgColor="D9E1F2")
    for col, title in enumerate(HEADERS, start=1):
        cell = ws.cell(row=1, column=col, value=title)
        cell.font = Font(bold=True)
        cell.fill = header_fill

    for row in rows:
        ws.append(row)

    widths = [12, 26, 10, 40, 11, 11, 13, 12, 18, 50]
    for i, w in enumerate(widths, start=1):
        ws.column_dimensions[get_column_letter(i)].width = w
    for cells in ws.iter_rows(min_row=1):
        for cell in cells:
            cell.alignment = Alignment(vertical="top", wrap_text=True)
    ws.freeze_panes = "A2"

    wb.save(out_path)


def main() -> None:
    in_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("data/trip.json")
    out_path = Path(sys.argv[2]) if len(sys.argv) > 2 else Path("data/trip_example.xlsx")

    trip = json.loads(in_path.read_text(encoding="utf-8"))
    rows = build_rows(trip)
    write_workbook(trip, rows, out_path)
    print(f"Wrote {out_path} ({len(rows)} itinerary rows across {len(trip.get('days', []))} days)")


if __name__ == "__main__":
    main()
