"""Shared trip-state helpers for the chat tool loop.

Extracted from the legacy batch workflows (new_trip_workflow.py /
trip_assistant_workflow.py) when those were deleted — the tool loop is the
only chat path now.
"""

from __future__ import annotations

from typing import Any, Optional

from pydantic import BaseModel
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    active,
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
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


def mark_trip_draft_after_chat_completion(trip: TripRecord) -> None:
    # Completing the chat-driven new-trip flow moves the trip out of "new"
    # so itinerary uploads are no longer allowed.
    if trip.status != "draft":
        trip.status = "draft"


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
        "status": trip.status,
        "startDate": trip.start_date,
        "endDate": trip.end_date,
        "startLocationName": trip.start_location_name,
        "destinationLocationName": trip.destination_location_name,
        "defaultTimezoneId": trip.default_timezone_id,
        "daysCount": await _count_active_rows(db, TripDayRecord, trip.trip_id),
        "pointsCount": await _count_active_rows(db, TripPointRecord, trip.trip_id),
        "staysCount": await _count_active_rows(db, StayDetailRecord, trip.trip_id),
        "travelsCount": await _count_active_rows(db, TravelDetailRecord, trip.trip_id),
    }


async def assembled_trip(db: AsyncSession, trip: TripRecord) -> TripResponse:
    stay_records = (
        await db.execute(
            select(StayDetailRecord).where(
                StayDetailRecord.trip_id == trip.trip_id,
                active(StayDetailRecord),
            )
        )
    ).scalars().all()
    travel_records = (
        await db.execute(
            select(TravelDetailRecord).where(
                TravelDetailRecord.trip_id == trip.trip_id,
                active(TravelDetailRecord),
            )
        )
    ).scalars().all()
    day_records = (
        await db.execute(
            select(TripDayRecord).where(
                TripDayRecord.trip_id == trip.trip_id,
                active(TripDayRecord),
            )
        )
    ).scalars().all()

    locs_by_stay: dict[str, list] = {}
    locs_by_travel: dict[str, list] = {}
    locs_by_point: dict[str, list] = {}

    for loc in (
        await db.execute(select(LocationRecord).where(LocationRecord.stay_detail_id.in_([s.stay_detail_id for s in stay_records])))
    ).scalars().all() if stay_records else []:
        locs_by_stay.setdefault(loc.stay_detail_id, []).append(loc)
    for loc in (
        await db.execute(select(LocationRecord).where(LocationRecord.travel_detail_id.in_([t.travel_detail_id for t in travel_records])))
    ).scalars().all() if travel_records else []:
        locs_by_travel.setdefault(loc.travel_detail_id, []).append(loc)

    points = (
        await db.execute(
            select(TripPointRecord).where(
                TripPointRecord.trip_id == trip.trip_id,
                active(TripPointRecord),
            )
        )
    ).scalars().all()
    if points:
        for loc in (
            await db.execute(select(LocationRecord).where(LocationRecord.point_id.in_([p.point_id for p in points])))
        ).scalars().all():
            locs_by_point.setdefault(loc.point_id, []).append(loc)

    stays = {s.stay_detail_id: StayDetail.from_record(s, locs_by_stay.get(s.stay_detail_id, [])) for s in stay_records}
    travels = {t.travel_detail_id: TravelDetail.from_record(t, locs_by_travel.get(t.travel_detail_id, [])) for t in travel_records}

    points_by_day: dict[str, list] = {}
    for point in points:
        points_by_day.setdefault(point.day_id, []).append(point)

    days = [
        TripDayWithPoints.from_record(
            day,
            points=[
                TripPointResponse.from_record(
                    point,
                    locs_by_point.get(point.point_id, []),
                    travels.get(point.travel_detail_id) if point.travel_detail_id else None,
                    stays.get(point.stay_detail_id) if point.stay_detail_id else None,
                )
                for point in points_by_day.get(day.day_id, [])
            ],
        )
        for day in sorted(day_records, key=lambda item: item.date)
    ]

    return TripResponse(
        trip_id=trip.trip_id,
        trip_name=trip.trip_name,
        status=trip.status,
        start_location_name=trip.start_location_name,
        destination_location_name=trip.destination_location_name,
        default_timezone_id=trip.default_timezone_id,
        start_date=trip.start_date,
        end_date=trip.end_date,
        stays=list(stays.values()),
        travels=list(travels.values()),
        days=days,
    )
