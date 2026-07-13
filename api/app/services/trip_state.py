"""Shared trip-state helpers for the chat tool loop and the trip routes.

`assembled_trip` is the single loader for a whole trip. It used to be one of
two near-identical hand-rolled assemblies (the other lived in routers/trip.py),
each issuing ~7 queries and stitching the graph together with dicts. Now the
relationships do it — and because the soft-delete filter is baked into the
joins, no caller can forget it (review.md 1C-3).
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.enums import PROMOTABLE_TO_DRAFT, TripStatus
from app.services.trip_status import effective_status
from app.models import (
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    active,
)
from app.schemas import (
    StayDetail,
    TravelDetail,
    TripDayWithPoints,
    TripPointResponse,
    TripResponse,
    VerifyResult,
)


class WorkflowOutcome(BaseModel):
    assistantMessage: str
    complete: bool = False
    verify: Optional[VerifyResult] = None
    structuredContent: Optional[dict] = None


def promote_to_draft(trip: TripRecord) -> None:
    """A trip has gained content, so it is no longer `new`.

    The **only** legal transition here is `new → draft`. It is a promotion, never
    a reset, and that matters: `trip.status = "draft"` used to be written raw in
    five places, so uploading a booking confirmation while you were *on* a trip
    would knock it out of `active` — the What's Next screen would silently
    disappear mid-trip and nothing would explain why.

    Leaving `new` is what locks itinerary re-import (`trip.status != "new"`), so
    the promotion still has to happen; it just must not travel backwards.
    """
    if trip.status in PROMOTABLE_TO_DRAFT:
        trip.status = TripStatus.DRAFT


def mark_trip_draft_after_chat_completion(trip: TripRecord) -> None:
    # Completing the chat-driven new-trip flow moves the trip out of "new"
    # so itinerary uploads are no longer allowed.
    promote_to_draft(trip)


async def _count_active_rows(db: AsyncSession, model, trip_id: str) -> int:
    result = await db.execute(
        select(func.count())
        .select_from(model)
        .where(
            model.trip_id == trip_id,
            active(model),
        )
    )
    return int(result.scalar_one() or 0)


async def trip_summary(db: AsyncSession, trip: TripRecord) -> dict[str, Any]:
    return {
        "tripId": trip.trip_id,
        "tripName": trip.trip_name,
        # The *stored* status, not the clock-derived one. "Active" is a
        # presentation concern — it tells the UI which screen to render, and the
        # model neither renders anything nor behaves differently mid-trip.
        #
        # Feeding it the derived value would also make the eval harness depend on
        # the real wall clock: four scenarios seed a trip whose dates ARE
        # appCurrentDate, so on that one day of the year the model would suddenly
        # see "active" and the suite's world would silently change. When the
        # assistant eventually needs to know you're mid-trip ("my flight is
        # delayed"), that deserves an explicit isUnderway flag computed from
        # appCurrentDate — not a repurposed status field.
        "status": trip.status,
        "startDate": trip.start_date.isoformat() if trip.start_date else None,
        "endDate": trip.end_date.isoformat() if trip.end_date else None,
        "startLocationName": trip.start_location_name,
        "destinationLocationName": trip.destination_location_name,
        "defaultTimezoneId": trip.default_timezone_id,
        "daysCount": await _count_active_rows(db, TripDayRecord, trip.trip_id),
        "pointsCount": await _count_active_rows(db, TripPointRecord, trip.trip_id),
        "staysCount": await _count_active_rows(db, StayDetailRecord, trip.trip_id),
        "travelsCount": await _count_active_rows(db, TravelDetailRecord, trip.trip_id),
    }


def _loader_options():
    """Eager-load the whole trip graph in a fixed number of queries.

    A point's stay/travel is deliberately NOT eager-loaded: every live stay and
    travel on the trip is already loaded above, so the point just looks its own
    up by id. Loading them again per point would cost four more round-trips for
    data we already have.
    """
    return (
        selectinload(TripRecord.stays).selectinload(StayDetailRecord.locations),
        selectinload(TripRecord.travels).selectinload(TravelDetailRecord.locations),
        selectinload(TripRecord.days)
        .selectinload(TripDayRecord.points)
        .selectinload(TripPointRecord.locations),
    )


async def assembled_trip(db: AsyncSession, trip: TripRecord) -> TripResponse:
    """The full trip graph as a TripResponse.

    One query per level (not per row): trip, stays, travels, days, points, and
    their locations. The relationships already exclude soft-deleted rows.
    """
    loaded = (
        await db.execute(
            select(TripRecord)
            .where(TripRecord.trip_id == trip.trip_id)
            .options(*_loader_options())
        )
    ).scalar_one()

    stays = {
        stay.stay_detail_id: StayDetail.from_record(stay, stay.locations)
        for stay in loaded.stays
    }
    travels = {
        travel.travel_detail_id: TravelDetail.from_record(travel, travel.locations)
        for travel in loaded.travels
    }

    days = [
        TripDayWithPoints.from_record(
            day,
            points=[
                TripPointResponse.from_record(
                    point,
                    point.locations,
                    # Already loaded at trip level — a soft-deleted detail is
                    # simply absent from these, which is the behaviour we want.
                    travels.get(point.travel_detail_id),
                    stays.get(point.stay_detail_id),
                )
                for point in day.points
            ],
        )
        for day in loaded.days
    ]

    return TripResponse(
        trip_id=loaded.trip_id,
        trip_name=loaded.trip_name,
        status=effective_status(loaded),
        status_intent=loaded.status or TripStatus.NEW,
        start_location_name=loaded.start_location_name,
        destination_location_name=loaded.destination_location_name,
        default_timezone_id=loaded.default_timezone_id,
        start_date=loaded.start_date,
        end_date=loaded.end_date,
        stays=list(stays.values()),
        travels=list(travels.values()),
        days=days,
    )
