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
from app.services.detail_points import (
    sync_stay_generated_points,
    sync_travel_generated_points,
)
from app.services.locations import location_rows
from app.services.trip_state import promote_to_draft
from app.services.timezones import derive_utc, infer_tzid_from_locations, parse_wall_clock

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

    def _infer_stay_tzid_for_date(day_date_text: str):
        day_date = parse_wall_clock(f"{day_date_text}T00:00")
        if day_date is None:
            return None
        for stay in body.stays:
            in_local = parse_wall_clock(stay.check_in)
            out_local = parse_wall_clock(stay.check_out)
            if in_local is None or out_local is None:
                continue
            if in_local.date() <= day_date.date() <= out_local.date():
                tzid = stay.check_in_timezone_id or stay.check_out_timezone_id or infer_tzid_from_locations(
                    stay.locations, role="venue", fallback=None
                )
                if tzid:
                    return tzid
        return None

    def _add_locations(locations, *, point_id=None, stay_id=None, travel_id=None):
        for row in location_rows(
            locations, point_id=point_id, stay_detail_id=stay_id, travel_detail_id=travel_id
        ):
            db.add(row)

    # ── 4. Insert trip-level stays & travels (with their locations) ──────────
    stays_inserted = 0
    stay_records: list[StayDetailRecord] = []
    for stay in body.stays:
        check_in_tzid = stay.check_in_timezone_id or infer_tzid_from_locations(
            stay.locations, role="venue", fallback=trip.default_timezone_id
        )
        check_out_tzid = stay.check_out_timezone_id or check_in_tzid
        check_in_local = parse_wall_clock(stay.check_in)
        check_out_local = parse_wall_clock(stay.check_out)
        stay_record = StayDetailRecord(
            stay_detail_id=stay.stay_detail_id,
            trip_id=trip_id,
            name=stay.name,
            stay_type=stay.stay_type,
            check_in_local=check_in_local,
            check_in_tzid=check_in_tzid,
            check_in_utc=derive_utc(check_in_local, check_in_tzid),
            check_out_local=check_out_local,
            check_out_tzid=check_out_tzid,
            check_out_utc=derive_utc(check_out_local, check_out_tzid),
            room_type=stay.room_type,
            confirmation_number=stay.confirmation_number,
            description=stay.description,
        )
        db.add(stay_record)
        await db.flush()
        _add_locations(stay.locations, stay_id=stay.stay_detail_id)
        stay_records.append(stay_record)
        stays_inserted += 1

    travels_inserted = 0
    travel_records: list[TravelDetailRecord] = []
    for travel in body.travels:
        departure_tzid = travel.departure_timezone_id or infer_tzid_from_locations(
            travel.locations, role="origin", fallback=trip.default_timezone_id
        )
        arrival_tzid = travel.arrival_timezone_id or infer_tzid_from_locations(
            travel.locations, role="destination", fallback=trip.default_timezone_id
        )
        departure_local = parse_wall_clock(travel.departure_date_time)
        arrival_local = parse_wall_clock(travel.arrival_date_time)
        travel_record = TravelDetailRecord(
            travel_detail_id=travel.travel_detail_id,
            trip_id=trip_id,
            name=travel.name,
            mode=travel.mode,
            operator=travel.operator,
            vehicle_number=travel.vehicle_number,
            cabin_class=travel.cabin_class,
            departure_local=departure_local,
            departure_tzid=departure_tzid,
            departure_utc=derive_utc(departure_local, departure_tzid),
            arrival_local=arrival_local,
            arrival_tzid=arrival_tzid,
            arrival_utc=derive_utc(arrival_local, arrival_tzid),
            confirmation_number=travel.confirmation_number,
            description=travel.description,
        )
        db.add(travel_record)
        await db.flush()
        _add_locations(travel.locations, travel_id=travel.travel_detail_id)
        travel_records.append(travel_record)
        travels_inserted += 1

    # ── 5. Insert days & points (points reference stays/travels) ─────────────
    days_inserted = 0
    points_inserted = 0

    # One primary day per date. A document that says "Day 3" and "July 25th"
    # in two places, or a model that splits a date into "Arrival" and
    # "Afternoon", must not become two July 25ths on the timeline — the later
    # one's points move onto the day that is already there.
    primary_by_date: dict[date, str] = {}

    for day_data in body.days:
        day_id = day_data.day_id
        if not day_data.is_alternate and day_data.date in primary_by_date:
            day_id = primary_by_date[day_data.date]
        else:
            db.add(
                TripDayRecord(
                    day_id=day_id,
                    trip_id=trip_id,
                    title=day_data.title,
                    date=day_data.date,
                    description=day_data.description,
                    is_alternate=day_data.is_alternate,
                    completed=day_data.completed,
                )
            )
            await db.flush()
            days_inserted += 1
            if not day_data.is_alternate:
                primary_by_date[day_data.date] = day_id

        for pt in day_data.points:
            # The model still describes check-ins and departures in its output,
            # because that is how a human reads an itinerary. We don't store
            # them: they are generated from the stay and travel rows below, so
            # writing them here too is what produced two of every point.
            if pt.type in DERIVED_POINT_TYPES:
                continue

            point_tzid = pt.start_timezone_id or pt.end_timezone_id or infer_tzid_from_locations(
                pt.locations, fallback=None
            )
            if not point_tzid:
                point_tzid = _infer_stay_tzid_for_date(day_data.date)
            if not point_tzid:
                point_tzid = trip.default_timezone_id
            start_local = parse_wall_clock(pt.start_date_time)
            end_local = parse_wall_clock(pt.end_date_time)
            point = TripPointRecord(
                point_id=pt.point_id,
                trip_id=trip_id,
                day_id=day_id,  # the day we kept, which may not be the one it arrived on
                type=pt.type,
                title=pt.title,
                stay_detail_id=pt.stay_detail_id,
                travel_detail_id=pt.travel_detail_id,
                start_local=start_local,
                start_tzid=pt.start_timezone_id or point_tzid,
                start_utc=derive_utc(start_local, pt.start_timezone_id or point_tzid),
                end_local=end_local,
                end_tzid=pt.end_timezone_id or point_tzid,
                end_utc=derive_utc(end_local, pt.end_timezone_id or point_tzid),
                confirmation_number=pt.confirmation_number,
                description=pt.description,
                image_url=pt.image_url,
                logo_url=pt.logo_url,
                is_system_created=pt.is_system_created,
                completed=pt.completed,
                completed_date_time=pt.completed_date_time,
            )
            db.add(point)
            await db.flush()
            points_inserted += 1

            _add_locations(pt.locations, point_id=pt.point_id)

    # ── 6. Generate the check-in/check-out/departure/arrival points ───────────
    # The single writer for those four types. It runs last because it needs the
    # days to exist, and it gives each point the place it happens at — the
    # flight's origin airport, the hotel's address — by copying from the parent.
    for stay_record in stay_records:
        await sync_stay_generated_points(db, stay=stay_record)
    for travel_record in travel_records:
        await sync_travel_generated_points(db, travel=travel_record)
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
