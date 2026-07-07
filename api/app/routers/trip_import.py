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
    trip.trip_name = body.tripName
    trip.start_date = body.startDate
    trip.end_date = body.endDate
    await db.flush()

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
                )
            )

    # ── 3. Insert trip-level stays & travels (with their locations) ──────────
    stays_inserted = 0
    for stay in body.stays:
        db.add(
            StayDetailRecord(
                stay_detail_id=stay.stayDetailId,
                trip_id=trip_id,
                name=stay.name,
                stay_type=stay.stayType,
                check_in=stay.checkIn,
                check_out=stay.checkOut,
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
        db.add(
            TravelDetailRecord(
                travel_detail_id=travel.travelDetailId,
                trip_id=trip_id,
                name=travel.name,
                mode=travel.mode,
                operator=travel.operator,
                vehicle_number=travel.vehicleNumber,
                cabin_class=travel.cabinClass,
                departure_date_time=travel.departureDateTime,
                arrival_date_time=travel.arrivalDateTime,
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
            point = TripPointRecord(
                point_id=pt.pointId,
                trip_id=trip_id,
                day_id=day_data.dayId,
                type=pt.type,
                title=pt.title,
                stay_detail_id=pt.stayDetailId,
                travel_detail_id=pt.travelDetailId,
                start_date_time=pt.startDateTime,
                end_date_time=pt.endDateTime,
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
