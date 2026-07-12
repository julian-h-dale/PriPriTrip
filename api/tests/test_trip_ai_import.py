import asyncio
import io
from unittest.mock import MagicMock

import pytest
from fastapi.testclient import TestClient
from openpyxl import Workbook

from app.auth import require_auth
from app.main import app
from app.schemas import TripImport
from app.services import trip_ai
from app.services.document_ingest import extract_text
from app.services.trip_ai import (
    AIDay,
    AILocation,
    AIPoint,
    AIStay,
    AITravel,
    AITrip,
    to_trip_import,
)


client = TestClient(app)


def _fake_user():
    user = MagicMock()
    user.id = "user_123"
    return user


def _sample_ai_trip() -> AITrip:
    return AITrip(
        tripName="Test Honeymoon",
        startDate="2026-05-10",
        endDate="2026-05-11",
        stays=[
            AIStay(
                ref="stay-1",
                name="Hotel Goldener Schlüssel",
                stayType="hotel",
                checkIn="2026-05-11T15:00:00",
                checkOut="2026-05-12T11:00:00",
                locations=[AILocation(role="venue", name="Hotel Goldener Schlüssel")],
            )
        ],
        travels=[
            AITravel(
                ref="travel-1",
                name="Train to Bern",
                mode="train",
                departureDateTime="2026-05-11T12:15:00",
                arrivalDateTime="2026-05-11T13:30:00",
                locations=[
                    AILocation(role="origin", name="Zurich Airport"),
                    AILocation(role="destination", name="Bern"),
                ],
            )
        ],
        days=[
            AIDay(
                title="May 11 — Arrival",
                date="2026-05-11",
                description="Short",
                points=[
                    AIPoint(
                        type="departure",
                        title="Depart Zurich Airport",
                        travelRef="travel-1",
                        startDateTime="2026-05-11T12:15:00",
                        endDateTime="2026-05-11T12:15:00",
                    ),
                    AIPoint(
                        type="check-in",
                        title="Check in",
                        stayRef="stay-1",
                        startDateTime="2026-05-11T15:00:00",
                        endDateTime="2026-05-11T15:30:00",
                    ),
                ],
            )
        ],
    )


# ── document_ingest ──────────────────────────────────────────────────────

def _make_xlsx() -> bytes:
    wb = Workbook()
    ws = wb.active
    ws.title = "Itinerary"
    ws.append(["Date", "Title", "Type"])
    ws.append(["2026-05-11", "Train to Bern", "travel"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


def test_extract_text_xlsx():
    text = extract_text("trip.xlsx", _make_xlsx())
    assert "Sheet: Itinerary" in text
    assert "Train to Bern" in text
    assert "| Date | Title | Type |" in text


def test_extract_text_unsupported():
    with pytest.raises(Exception) as exc:
        extract_text("trip.txt", b"hello")
    assert getattr(exc.value, "status_code", None) == 415


# ── to_trip_import ─────────────────────────────────────────────────────────

def test_to_trip_import_assigns_ids_and_links():
    result = to_trip_import(_sample_ai_trip())
    assert isinstance(result, TripImport)
    assert result.trip_id
    # Trip-level stays/travels hoisted out of points
    assert len(result.stays) == 1
    assert len(result.travels) == 1
    stay = result.stays[0]
    travel = result.travels[0]
    assert stay.name == "Hotel Goldener Schlüssel"
    assert travel.mode == "train"
    assert stay.locations[0].location_id

    day = result.days[0]
    assert day.day_id
    dep_point = day.points[0]
    checkin_point = day.points[1]
    assert dep_point.day_id == day.day_id
    # Points reference the hoisted details by generated id
    assert dep_point.travel_detail_id == travel.travel_detail_id
    assert checkin_point.stay_detail_id == stay.stay_detail_id


# ── single-pass service functions (mocked OpenAI) ─────────────────────────

def _fake_client_returning(ai_trip):
    fake_client = MagicMock()

    async def fake_parse(model, messages, response_format):
        completion = MagicMock()
        completion.usage.total_tokens = 100
        completion.choices[0].finish_reason = "stop"
        completion.choices[0].message.refusal = None
        completion.choices[0].message.parsed = ai_trip
        return completion

    fake_client.beta.chat.completions.parse.side_effect = fake_parse
    return fake_client


def test_structure_document_single_call():
    fake_client = _fake_client_returning(_sample_ai_trip())

    result = asyncio.run(trip_ai.structure_document("some itinerary text", client=fake_client))

    assert isinstance(result, TripImport)
    assert result.trip_name == "Test Honeymoon"
    # structure-only = one LLM call
    assert fake_client.beta.chat.completions.parse.call_count == 1


def test_enhance_trip_import_preserves_ids():
    draft = to_trip_import(_sample_ai_trip())

    # Enhanced AITrip mirrors structure but with richer descriptions.
    enhanced_ai = _sample_ai_trip()
    enhanced_ai.days[0].description = "A thrilling arrival day full of alpine views."
    enhanced_ai.days[0].points[0].description = "Smooth scenic train ride."
    fake_client = _fake_client_returning(enhanced_ai)

    result = asyncio.run(trip_ai.enhance_trip_import(draft, client=fake_client))

    # one LLM call, IDs preserved, descriptions updated
    assert fake_client.beta.chat.completions.parse.call_count == 1
    assert result.trip_id == draft.trip_id
    assert result.days[0].day_id == draft.days[0].day_id
    assert result.days[0].points[0].point_id == draft.days[0].points[0].point_id
    assert result.days[0].description == "A thrilling arrival day full of alpine views."
    assert result.days[0].points[0].description == "Smooth scenic train ride."


# ── endpoint ───────────────────────────────────────────────────────────────

class TestAiImportEndpoint:
    def setup_method(self):
        app.dependency_overrides[require_auth] = _fake_user

    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_ai_import_returns_draft(self, monkeypatch):
        async def fake_structure(text):
            return to_trip_import(_sample_ai_trip())

        monkeypatch.setattr(trip_ai, "structure_document", fake_structure)
        resp = client.post(
            "/trips/ai-import",
            files={"file": ("trip.xlsx", _make_xlsx(),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["tripName"] == "Test Honeymoon"
        assert body["days"][0]["points"][0]["dayId"] == body["days"][0]["dayId"]

    def test_ai_import_rejects_unsupported(self, monkeypatch):
        async def fake_structure(text):
            return to_trip_import(_sample_ai_trip())

        monkeypatch.setattr(trip_ai, "structure_document", fake_structure)
        resp = client.post(
            "/trips/ai-import",
            files={"file": ("trip.txt", b"hello", "text/plain")},
        )
        assert resp.status_code == 415

    def test_ai_enhance_returns_enhanced_trip(self, monkeypatch):
        draft = to_trip_import(_sample_ai_trip())

        async def fake_enhance(trip):
            result = trip.model_copy(deep=True)
            result.days[0].description = "Enhanced narrative."
            return result

        monkeypatch.setattr(trip_ai, "enhance_trip_import", fake_enhance)
        resp = client.post("/trips/ai-enhance", json=draft.model_dump(mode="json", by_alias=True))
        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == draft.trip_id
        assert body["days"][0]["description"] == "Enhanced narrative."
