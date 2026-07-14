"""Uploading the same confirmation to a second trip.

`POST /trips/{id}/ai-documents` caches extractions by content hash, so the same
PDF is only ever sent to OpenAI once. Worth having — but the cached payload was
being reused *verbatim*, including the stayDetailId minted for the first trip.
Those rows exist, so the save step's "this id is already in the database" check
skipped every record, and the second trip imported nothing at all while cheerfully
reporting `Imported 0 travel and 0 stay records`.

Found by driving the real UI with the same hotel PDF twice. The extracted
*content* is worth caching; the identities are not.
"""

from __future__ import annotations

import io

import pytest
from openpyxl import Workbook

from app.schemas import StayDetailImport
from app.services import trip_ai
from app.services.trip_ai import AIDocumentDraft
from tests.factories import as_date, make_trip

pytestmark = pytest.mark.asyncio


def _booking_file() -> bytes:
    """A real .xlsx, so document_ingest actually parses it."""
    wb = Workbook()
    ws = wb.active
    ws.append(["Hotel", "Check-in", "Check-out", "Confirmation"])
    ws.append(["Hotel Goldener Schlüssel", "2026-05-11", "2026-05-14", "58204SG008394"])
    buf = io.BytesIO()
    wb.save(buf)
    return buf.getvalue()


@pytest.fixture
def one_stay(monkeypatch):
    """Pin the AI to a single stay, and count how often it is actually called."""
    calls = {"n": 0}

    async def _extract(_document_text, client=None):
        calls["n"] += 1
        return AIDocumentDraft(
            stays=[
                StayDetailImport(
                    name="Hotel Goldener Schlüssel",
                    stayType="hotel",
                    checkIn="2026-05-11T15:00",
                    checkOut="2026-05-14T11:00",
                    confirmationNumber="58204SG008394",
                )
            ],
            travels=[],
        )

    monkeypatch.setattr(trip_ai, "extract_document_records", _extract)
    return calls


async def _upload(client, trip_id: str, data: bytes):
    return await client.post(
        f"/trips/{trip_id}/ai-documents",
        files={"file": ("booking.xlsx", data, "application/vnd.ms-excel")},
        data={"workflowMode": "detail_import"},
    )


async def _save(client, extraction: dict, trip_id: str):
    return await client.post(
        f"/ai-documents/{extraction['documentId']}/save",
        json={"tripId": trip_id, "stays": extraction["stays"], "travels": extraction["travels"]},
    )


class TestTheSameDocumentOnTwoTrips:
    async def test_the_second_trip_actually_gets_the_stay(self, client, db, user, one_stay):
        data = _booking_file()
        trip_a = await make_trip(db, user, trip_name="Trip A",
                                 start_date=as_date("2026-05-10"), end_date=as_date("2026-05-15"))
        trip_b = await make_trip(db, user, trip_name="Trip B",
                                 start_date=as_date("2026-06-10"), end_date=as_date("2026-06-15"))
        await db.commit()

        first = (await _upload(client, trip_a.trip_id, data)).json()
        saved_a = (await _save(client, first, trip_a.trip_id)).json()
        assert saved_a["staysSaved"] == 1

        second = (await _upload(client, trip_b.trip_id, data)).json()
        saved_b = (await _save(client, second, trip_b.trip_id)).json()

        # This was 0.
        assert saved_b["staysSaved"] == 1

        trip = (await client.get(f"/trips/{trip_b.trip_id}")).json()
        assert [s["name"] for s in trip["stays"]] == ["Hotel Goldener Schlüssel"]
        assert trip["stays"][0]["confirmationNumber"] == "58204SG008394"

    async def test_the_two_stays_are_separate_records(self, client, db, user, one_stay):
        data = _booking_file()
        trip_a = await make_trip(db, user, trip_name="Trip A")
        trip_b = await make_trip(db, user, trip_name="Trip B")
        await db.commit()

        first = (await _upload(client, trip_a.trip_id, data)).json()
        await _save(client, first, trip_a.trip_id)
        second = (await _upload(client, trip_b.trip_id, data)).json()
        await _save(client, second, trip_b.trip_id)

        a = (await client.get(f"/trips/{trip_a.trip_id}")).json()
        b = (await client.get(f"/trips/{trip_b.trip_id}")).json()

        assert a["stays"][0]["stayDetailId"] != b["stays"][0]["stayDetailId"]
        # Each stay belongs to its own trip — no cross-trip leakage.
        assert a["stays"][0]["tripId"] == trip_a.trip_id
        assert b["stays"][0]["tripId"] == trip_b.trip_id

    async def test_the_model_is_only_called_once(self, client, db, user, one_stay):
        """The cache is the point. Re-minting ids must not cost a second call."""
        data = _booking_file()
        trip_a = await make_trip(db, user, trip_name="Trip A")
        trip_b = await make_trip(db, user, trip_name="Trip B")
        await db.commit()

        await _upload(client, trip_a.trip_id, data)
        await _upload(client, trip_b.trip_id, data)

        assert one_stay["n"] == 1

    async def test_the_second_upload_is_served_from_cache(self, client, db, user, one_stay):
        data = _booking_file()
        trip_a = await make_trip(db, user, trip_name="Trip A")
        trip_b = await make_trip(db, user, trip_name="Trip B")
        await db.commit()

        first = (await _upload(client, trip_a.trip_id, data)).json()
        second = (await _upload(client, trip_b.trip_id, data)).json()

        assert first["cached"] is False
        assert second["cached"] is True
        assert second["tripId"] == trip_b.trip_id


class TestReSavingTheSameTrip:
    async def test_saving_the_same_document_twice_does_not_duplicate(
        self, client, db, user, one_stay
    ):
        """The id-collision skip still has a job: idempotency *within* a trip."""
        data = _booking_file()
        trip = await make_trip(db, user)
        await db.commit()

        extraction = (await _upload(client, trip.trip_id, data)).json()
        first = (await _save(client, extraction, trip.trip_id)).json()
        second = (await _save(client, extraction, trip.trip_id)).json()

        assert first["staysSaved"] == 1
        assert second["staysSaved"] == 0  # already there

        trip_body = (await client.get(f"/trips/{trip.trip_id}")).json()
        assert len(trip_body["stays"]) == 1
