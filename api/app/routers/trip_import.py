from datetime import date

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.enums import DERIVED_POINT_TYPES, TripStatus
from app.models import (
    active,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    UserRecord,
)
from app.schemas import ImportResult, TripImport
from app.services import trip_write
from app.services.trip_state import promote_to_draft

router = APIRouter(tags=["import"])


@router.post("/trips/{trip_id}/import", response_model=ImportResult, status_code=status.HTTP_200_OK)
async def import_trip(
    trip_id: str,
    body: TripImport,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    # The path is authoritative; body.tripId is still accepted but ignored.

    # ── 1. Authorize BEFORE any destructive write. Never rely on transaction
    #       rollback to undo deletes for an unauthorized caller.
    trip = await db.get(TripRecord, trip_id)
    if trip is not None:
        if trip.user_id != str(user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        if trip.is_deleted or trip.deleted_at is not None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    # ── 2. Delete existing data for this trip (import is a full replace —
    #       hard delete by design, unlike the soft-delete CRUD endpoints).
    #       Locations have ON DELETE CASCADE from points/stays/travels.
    await db.execute(delete(TripPointRecord).where(TripPointRecord.trip_id == trip_id))
    await db.execute(delete(TripDayRecord).where(TripDayRecord.trip_id == trip_id))
    await db.execute(delete(StayDetailRecord).where(StayDetailRecord.trip_id == trip_id))
    await db.execute(delete(TravelDetailRecord).where(TravelDetailRecord.trip_id == trip_id))

    # ── 3. Upsert trip header ────────────────────────────────────────────────
    if trip is None:
        # Born with content, so it is already past `new` — that is what locks
        # itinerary re-import. (Set explicitly: the column default only lands at
        # INSERT, so promote_to_draft would find status=None and do nothing.)
        trip = TripRecord(trip_id=trip_id, user_id=str(user.id), status=TripStatus.DRAFT)
        db.add(trip)
    else:
        # An existing trip gains content — promote it, but never demote it. An
        # import into a trip you are *on* must not knock it out of `active`.
        promote_to_draft(trip)
    trip.trip_name = body.trip_name
    trip.default_timezone_id = body.default_timezone_id
    trip.start_date = body.start_date
    trip.end_date = body.end_date
    await db.flush()

    # ── 4. Days first ────────────────────────────────────────────────────────
    # Order matters now: creating a stay or a travel leg *generates* its check-in /
    # departure points, and a generated point needs a day to land on. If the days
    # were not here yet, the sync would invent placeholder ones and the real days
    # would then collide with them on the one-primary-day-per-date index.
    #
    # One primary day per date. A document that says "Day 3" and "July 25th" in two
    # places, or a model that splits a date into "Arrival" and "Afternoon", must not
    # become two July 25ths — the later one's points move onto the day already there.
    days_inserted = 0
    points_inserted = 0
    primary_by_date: dict[date, str] = {}
    day_for_point: list[tuple[TripDayRecord, list]] = []

    for day_data in body.days:
        if not day_data.is_alternate and day_data.date in primary_by_date:
            day = await db.get(TripDayRecord, primary_by_date[day_data.date])
        else:
            day = TripDayRecord(
                day_id=day_data.day_id,
                trip_id=trip_id,
                title=day_data.title,
                date=day_data.date,
                description=day_data.description,
                is_alternate=day_data.is_alternate,
                completed=day_data.completed,
            )
            db.add(day)
            await db.flush()
            days_inserted += 1
            if not day_data.is_alternate:
                primary_by_date[day_data.date] = day.day_id
        day_for_point.append((day, day_data.points))

    # ── 5. Stays & travels, through the write layer ──────────────────────────
    # An imported stay now gets exactly the same treatment as one the assistant
    # creates or one you type into a form: its timezone comes from the *place*, its
    # locations are resolved to real coordinates, and its generated points are built.
    # The new-trip wizard used to send bare airport names ("ORD") straight to the row
    # with no coordinates at all.
    stays_inserted = 0
    for stay in body.stays:
        await trip_write.create_stay(db, trip, stay)
        stays_inserted += 1

    travels_inserted = 0
    for travel in body.travels:
        await trip_write.create_travel(db, trip, travel)
        travels_inserted += 1

    # ── 6. The authored points ───────────────────────────────────────────────
    for day, points in day_for_point:
        for pt in points:
            # The model still describes check-ins and departures in its output,
            # because that is how a human reads an itinerary. We don't store them:
            # they were generated from the stays and legs above, and writing them
            # here too is what produced two of every point.
            if pt.type in DERIVED_POINT_TYPES:
                continue
            await trip_write.create_point(db, trip, day, pt)
            points_inserted += 1

    await db.flush()

    generated = await db.execute(
        select(func.count())
        .select_from(TripPointRecord)
        .where(
            TripPointRecord.trip_id == trip_id,
            TripPointRecord.is_system_created.is_(True),
            active(TripPointRecord),
        )
    )
    points_inserted += int(generated.scalar_one())

    await db.commit()

    return ImportResult(
        status="ok",
        tripId=trip_id,
        daysImported=days_inserted,
        pointsImported=points_inserted,
        staysImported=stays_inserted,
        travelsImported=travels_inserted,
    )
