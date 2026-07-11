from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import (
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    UserRecord,
)
from app.schemas import ImportResult, TripImport
from app.services.locations import location_rows
from app.services.timezones import derive_utc, infer_tzid_from_locations, parse_wall_clock, wall_clock_to_text

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
        trip = TripRecord(trip_id=trip_id, user_id=str(user.id))
        db.add(trip)
    trip.trip_name = body.trip_name
    trip.status = "draft"
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
    for stay in body.stays:
        check_in_tzid = stay.check_in_timezone_id or infer_tzid_from_locations(
            stay.locations, role="venue", fallback=trip.default_timezone_id
        )
        check_out_tzid = stay.check_out_timezone_id or check_in_tzid
        check_in_local = parse_wall_clock(stay.check_in)
        check_out_local = parse_wall_clock(stay.check_out)
        db.add(
            StayDetailRecord(
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
                check_in=wall_clock_to_text(check_in_local),
                check_out=wall_clock_to_text(check_out_local),
                room_type=stay.room_type,
                confirmation_number=stay.confirmation_number,
                description=stay.description,
            )
        )
        await db.flush()
        _add_locations(stay.locations, stay_id=stay.stay_detail_id)
        stays_inserted += 1

    travels_inserted = 0
    for travel in body.travels:
        departure_tzid = travel.departure_timezone_id or infer_tzid_from_locations(
            travel.locations, role="origin", fallback=trip.default_timezone_id
        )
        arrival_tzid = travel.arrival_timezone_id or infer_tzid_from_locations(
            travel.locations, role="destination", fallback=trip.default_timezone_id
        )
        departure_local = parse_wall_clock(travel.departure_date_time)
        arrival_local = parse_wall_clock(travel.arrival_date_time)
        db.add(
            TravelDetailRecord(
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
                departure_date_time=wall_clock_to_text(departure_local),
                arrival_date_time=wall_clock_to_text(arrival_local),
                confirmation_number=travel.confirmation_number,
                description=travel.description,
            )
        )
        await db.flush()
        _add_locations(travel.locations, travel_id=travel.travel_detail_id)
        travels_inserted += 1

    # ── 5. Insert days & points (points reference stays/travels) ─────────────
    days_inserted = 0
    points_inserted = 0

    for day_data in body.days:
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

        for pt in day_data.points:
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
                day_id=day_data.day_id,
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
                start_date_time=wall_clock_to_text(start_local),
                end_date_time=wall_clock_to_text(end_local),
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

    await db.commit()

    return ImportResult(
        status="ok",
        tripId=trip_id,
        daysImported=days_inserted,
        pointsImported=points_inserted,
        staysImported=stays_inserted,
        travelsImported=travels_inserted,
    )
