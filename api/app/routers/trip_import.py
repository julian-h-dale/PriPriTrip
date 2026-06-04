from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import text
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.database import get_db
from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
)
from app.schemas import ImportResult, TripImport

router = APIRouter(tags=["import"], dependencies=[Depends(require_auth)])


@router.post("/trip/import", response_model=ImportResult, status_code=status.HTTP_200_OK)
def import_trip(body: TripImport, db: Session = Depends(get_db)):
    trip_id = body.tripId

    # ── 1. Delete all existing data for this trip (FK order) ────────────────
    db.execute(
        text(
            "DELETE FROM locations"
            " WHERE point_id IN (SELECT point_id FROM trip_points WHERE trip_id = :tid)"
        ),
        {"tid": trip_id},
    )
    db.execute(
        text(
            "DELETE FROM travel_details"
            " WHERE point_id IN (SELECT point_id FROM trip_points WHERE trip_id = :tid)"
        ),
        {"tid": trip_id},
    )
    db.execute(
        text(
            "DELETE FROM stay_details"
            " WHERE point_id IN (SELECT point_id FROM trip_points WHERE trip_id = :tid)"
        ),
        {"tid": trip_id},
    )
    db.execute(text("DELETE FROM trip_points WHERE trip_id = :tid"), {"tid": trip_id})
    db.execute(text("DELETE FROM trip_days WHERE trip_id = :tid"), {"tid": trip_id})

    # ── 2. Upsert trip header ────────────────────────────────────────────────
    trip = db.get(TripRecord, trip_id)
    if trip is None:
        trip = TripRecord(trip_id=trip_id)
        db.add(trip)
    trip.trip_name = body.tripName
    trip.start_date = body.startDate
    trip.end_date = body.endDate
    db.flush()

    # ── 3. Insert days, points, and all sub-records ──────────────────────────
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
        db.flush()
        days_inserted += 1

        for pt in day_data.points:
            point = TripPointRecord(
                point_id=pt.pointId,
                trip_id=trip_id,
                day_id=day_data.dayId,
                type=pt.type,
                title=pt.title,
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
            db.flush()
            points_inserted += 1

            for loc in pt.locations:
                db.add(
                    LocationRecord(
                        location_id=loc.locationId,
                        point_id=pt.pointId,
                        role=loc.role,
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

            if pt.travelDetail is not None:
                db.add(
                    TravelDetailRecord(
                        point_id=pt.pointId,
                        mode=pt.travelDetail.mode,
                        operator=pt.travelDetail.operator,
                        vehicle_number=pt.travelDetail.vehicleNumber,
                        cabin_class=pt.travelDetail.cabinClass,
                    )
                )

            if pt.stayDetail is not None:
                db.add(
                    StayDetailRecord(
                        point_id=pt.pointId,
                        stay_type=pt.stayDetail.stayType,
                        check_in_time=pt.stayDetail.checkInTime,
                        check_out_time=pt.stayDetail.checkOutTime,
                        room_type=pt.stayDetail.roomType,
                    )
                )

    db.commit()

    return ImportResult(
        status="ok",
        daysImported=days_inserted,
        pointsImported=points_inserted,
    )
