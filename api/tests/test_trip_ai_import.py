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
from app.services.trip_ai import AIDay, AILocation, AIPoint, AITrip, to_trip_import


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
        days=[
            AIDay(
                title="May 11 — Arrival",
                date="2026-05-11",
                description="Short",
                points=[
                    AIPoint(
                        type="travel",
                        title="Train: Airport → Bern",
                        startDateTime="2026-05-11T12:15:00+02:00",
                        endDateTime="2026-05-11T13:30:00+02:00",
                        locations=[
                            AILocation(role="origin", name="Zurich Airport"),
                            AILocation(role="destination", name="Bern"),
                        ],
                        travelDetail={"mode": "train"},
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
    assert result.tripId
    day = result.days[0]
    assert day.dayId
    point = day.points[0]
    assert point.dayId == day.dayId
    assert point.pointId
    assert point.locations[0].locationId
    assert point.travelDetail.mode == "train"


# ── single-pass service functions (mocked OpenAI) ─────────────────────────

def _fake_client_returning(ai_trip):
    fake_client = MagicMock()

    def fake_parse(model, messages, response_format):
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

    result = trip_ai.structure_document("some itinerary text", client=fake_client)

    assert isinstance(result, TripImport)
    assert result.tripName == "Test Honeymoon"
    # structure-only = one LLM call
    assert fake_client.beta.chat.completions.parse.call_count == 1


def test_enhance_trip_import_preserves_ids():
    draft = to_trip_import(_sample_ai_trip())

    # Enhanced AITrip mirrors structure but with richer descriptions.
    enhanced_ai = _sample_ai_trip()
    enhanced_ai.days[0].description = "A thrilling arrival day full of alpine views."
    enhanced_ai.days[0].points[0].description = "Smooth scenic train ride."
    fake_client = _fake_client_returning(enhanced_ai)

    result = trip_ai.enhance_trip_import(draft, client=fake_client)

    # one LLM call, IDs preserved, descriptions updated
    assert fake_client.beta.chat.completions.parse.call_count == 1
    assert result.tripId == draft.tripId
    assert result.days[0].dayId == draft.days[0].dayId
    assert result.days[0].points[0].pointId == draft.days[0].points[0].pointId
    assert result.days[0].description == "A thrilling arrival day full of alpine views."
    assert result.days[0].points[0].description == "Smooth scenic train ride."


# ── endpoint ───────────────────────────────────────────────────────────────

class TestAiImportEndpoint:
    def setup_method(self):
        app.dependency_overrides[require_auth] = _fake_user

    def teardown_method(self):
        app.dependency_overrides.clear()

    def test_ai_import_returns_draft(self, monkeypatch):
        monkeypatch.setattr(
            trip_ai, "structure_document", lambda text: to_trip_import(_sample_ai_trip())
        )
        resp = client.post(
            "/trip/ai-import",
            files={"file": ("trip.xlsx", _make_xlsx(),
                            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["tripName"] == "Test Honeymoon"
        assert body["days"][0]["points"][0]["dayId"] == body["days"][0]["dayId"]

    def test_ai_import_rejects_unsupported(self, monkeypatch):
        monkeypatch.setattr(
            trip_ai, "structure_document", lambda text: to_trip_import(_sample_ai_trip())
        )
        resp = client.post(
            "/trip/ai-import",
            files={"file": ("trip.txt", b"hello", "text/plain")},
        )
        assert resp.status_code == 415

    def test_ai_enhance_returns_enhanced_trip(self, monkeypatch):
        draft = to_trip_import(_sample_ai_trip())

        def fake_enhance(trip):
            result = trip.model_copy(deep=True)
            result.days[0].description = "Enhanced narrative."
            return result

        monkeypatch.setattr(trip_ai, "enhance_trip_import", fake_enhance)
        resp = client.post("/trip/ai-enhance", json=draft.model_dump())
        assert resp.status_code == 200
        body = resp.json()
        assert body["tripId"] == draft.tripId
        assert body["days"][0]["description"] == "Enhanced narrative."
