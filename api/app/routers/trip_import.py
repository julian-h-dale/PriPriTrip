from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text, select, delete
from sqlalchemy.ext.asyncio import AsyncSession
import uuid

from app.auth import require_auth
from app.database import get_db
from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    UserRecord,
)
from app.schemas import ImportResult, TripImport
from app.services.timezones import derive_utc, parse_wall_clock, tzid_from_coords, wall_clock_to_text

router = APIRouter(tags=["import"])


@router.post("/trip/import", response_model=ImportResult, status_code=status.HTTP_200_OK)
async def import_trip(
    body: TripImport,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    trip_id = body.tripId

    # ── 1. Delete existing data for this trip. Locations have ON DELETE CASCADE
    #       from points/stays/travels, so removing those clears their locations.
    await db.execute(delete(TripPointRecord).where(TripPointRecord.trip_id == trip_id))
    await db.execute(delete(TripDayRecord).where(TripDayRecord.trip_id == trip_id))
    await db.execute(delete(StayDetailRecord).where(StayDetailRecord.trip_id == trip_id))
    await db.execute(delete(TravelDetailRecord).where(TravelDetailRecord.trip_id == trip_id))

    # ── 2. Upsert trip header ────────────────────────────────────────────────
    trip = await db.get(TripRecord, trip_id)
    if trip is None:
        trip = TripRecord(trip_id=trip_id, user_id=str(user.id))
        db.add(trip)
    elif trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
    elif trip.is_deleted or trip.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    trip.trip_name = body.tripName
    trip.status = "draft"
    trip.default_timezone_id = body.defaultTimezoneId
    trip.start_date = body.startDate
    trip.end_date = body.endDate
    await db.flush()

    def _location_tzid(loc):
        return loc.timezoneId or tzid_from_coords(loc.lat, loc.lng)

    def _infer_tzid(locations, role=None, fallback=None):
        for loc in locations or []:
            if role and loc.role != role:
                continue
            tzid = _location_tzid(loc)
            if tzid:
                return tzid
        return fallback

    def _infer_stay_tzid_for_date(day_date_text: str):
        day_date = parse_wall_clock(f"{day_date_text}T00:00")
        if day_date is None:
            return None
        for stay in body.stays:
            in_local = parse_wall_clock(stay.checkIn)
            out_local = parse_wall_clock(stay.checkOut)
            if in_local is None or out_local is None:
                continue
            if in_local.date() <= day_date.date() <= out_local.date():
                tzid = stay.checkInTimezoneId or stay.checkOutTimezoneId or _infer_tzid(
                    stay.locations, role="venue", fallback=None
                )
                if tzid:
                    return tzid
        return None

    def _add_locations(locations, *, point_id=None, stay_id=None, travel_id=None):
        for i, loc in enumerate(locations):
            db.add(
                LocationRecord(
                    location_id=loc.locationId,
                    point_id=point_id,
                    stay_detail_id=stay_id,
                    travel_detail_id=travel_id,
                    role=loc.role,
                    sort_order=i,
                    name=loc.name,
                    lat=loc.lat,
                    lng=loc.lng,
                    full_address=loc.fullAddress,
                    description=loc.description,
                    link=loc.link,
                    google_place_id=loc.googlePlaceId,
                    google_maps_uri=loc.googleMapsUri,
                    timezone_id=_location_tzid(loc),
                )
            )

    # ── 3. Insert trip-level stays & travels (with their locations) ──────────
    stays_inserted = 0
    for stay in body.stays:
        check_in_tzid = stay.checkInTimezoneId or _infer_tzid(
            stay.locations, role="venue", fallback=trip.default_timezone_id
        )
        check_out_tzid = stay.checkOutTimezoneId or check_in_tzid
        check_in_local = parse_wall_clock(stay.checkIn)
        check_out_local = parse_wall_clock(stay.checkOut)
        db.add(
            StayDetailRecord(
                stay_detail_id=stay.stayDetailId,
                trip_id=trip_id,
                name=stay.name,
                stay_type=stay.stayType,
                check_in_local=check_in_local,
                check_in_tzid=check_in_tzid,
                check_in_utc=derive_utc(check_in_local, check_in_tzid),
                check_out_local=check_out_local,
                check_out_tzid=check_out_tzid,
                check_out_utc=derive_utc(check_out_local, check_out_tzid),
                check_in=wall_clock_to_text(check_in_local),
                check_out=wall_clock_to_text(check_out_local),
                room_type=stay.roomType,
                confirmation_number=stay.confirmationNumber,
                description=stay.description,
            )
        )
        await db.flush()
        _add_locations(stay.locations, stay_id=stay.stayDetailId)
        stays_inserted += 1

    travels_inserted = 0
    for travel in body.travels:
        departure_tzid = travel.departureTimezoneId or _infer_tzid(
            travel.locations, role="origin", fallback=trip.default_timezone_id
        )
        arrival_tzid = travel.arrivalTimezoneId or _infer_tzid(
            travel.locations, role="destination", fallback=trip.default_timezone_id
        )
        departure_local = parse_wall_clock(travel.departureDateTime)
        arrival_local = parse_wall_clock(travel.arrivalDateTime)
        db.add(
            TravelDetailRecord(
                travel_detail_id=travel.travelDetailId,
                trip_id=trip_id,
                name=travel.name,
                mode=travel.mode,
                operator=travel.operator,
                vehicle_number=travel.vehicleNumber,
                cabin_class=travel.cabinClass,
                departure_local=departure_local,
                departure_tzid=departure_tzid,
                departure_utc=derive_utc(departure_local, departure_tzid),
                arrival_local=arrival_local,
                arrival_tzid=arrival_tzid,
                arrival_utc=derive_utc(arrival_local, arrival_tzid),
                departure_date_time=wall_clock_to_text(departure_local),
                arrival_date_time=wall_clock_to_text(arrival_local),
                confirmation_number=travel.confirmationNumber,
                description=travel.description,
            )
        )
        await db.flush()
        _add_locations(travel.locations, travel_id=travel.travelDetailId)
        travels_inserted += 1

    # ── 4. Insert days & points (points reference stays/travels) ─────────────
    days_inserted = 0
    points_inserted = 0

    for day_data in body.days:
        day = TripDayRecord(
            day_id=day_data.dayId,
            trip_id=trip_id,
            title=day_data.title,
            date=day_data.date,
            description=day_data.description,
            is_alternate=day_data.isAlternate,
            completed=day_data.completed,
        )
        db.add(day)
        await db.flush()
        days_inserted += 1

        for pt in day_data.points:
            point_tzid = pt.startTimezoneId or pt.endTimezoneId or _infer_tzid(
                pt.locations, fallback=None
            )
            if not point_tzid:
                point_tzid = _infer_stay_tzid_for_date(day_data.date)
            if not point_tzid:
                point_tzid = trip.default_timezone_id
            start_local = parse_wall_clock(pt.startDateTime)
            end_local = parse_wall_clock(pt.endDateTime)
            point = TripPointRecord(
                point_id=pt.pointId,
                trip_id=trip_id,
                day_id=day_data.dayId,
                type=pt.type,
                title=pt.title,
                stay_detail_id=pt.stayDetailId,
                travel_detail_id=pt.travelDetailId,
                start_local=start_local,
                start_tzid=pt.startTimezoneId or point_tzid,
                start_utc=derive_utc(start_local, pt.startTimezoneId or point_tzid),
                end_local=end_local,
                end_tzid=pt.endTimezoneId or point_tzid,
                end_utc=derive_utc(end_local, pt.endTimezoneId or point_tzid),
                start_date_time=wall_clock_to_text(start_local),
                end_date_time=wall_clock_to_text(end_local),
                confirmation_number=pt.confirmationNumber,
                description=pt.description,
                image_url=pt.imageUrl,
                logo_url=pt.logoUrl,
                completed=pt.completed,
                completed_date_time=pt.completedDateTime,
            )
            db.add(point)
            await db.flush()
            points_inserted += 1

            _add_locations(pt.locations, point_id=pt.pointId)

    await db.commit()

    return ImportResult(
        status="ok",
        tripId=trip_id,
        daysImported=days_inserted,
        pointsImported=points_inserted,
        staysImported=stays_inserted,
        travelsImported=travels_inserted,
    )
