import logging
from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
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
from app.schemas import (
    LocationResponse,
    StayDetail,
    TravelDetail,
    TripDayWithPoints,
    TripHeader,
    TripListItem,
    TripPointResponse,
    TripResponse,
)

router = APIRouter(prefix="/trips", tags=["trips"], dependencies=[Depends(require_auth)])


def _point_to_response(
    point: TripPointRecord,
    locations: list,
    travel: TravelDetailRecord | None,
    stay: StayDetailRecord | None,
) -> TripPointResponse:
    travel_detail = None
    if travel:
        travel_detail = TravelDetail(
            mode=travel.mode,
            operator=travel.operator,
            vehicleNumber=travel.vehicle_number,
            cabinClass=travel.cabin_class,
        )
    stay_detail = None
    if stay:
        stay_detail = StayDetail(
            stayType=stay.stay_type,
            checkInTime=stay.check_in_time,
            checkOutTime=stay.check_out_time,
            roomType=stay.room_type,
        )
    return TripPointResponse(
        pointId=point.point_id,
        tripId=point.trip_id,
        dayId=point.day_id,
        type=point.type,
        title=point.title,
        startDateTime=point.start_date_time,
        endDateTime=point.end_date_time,
        confirmationNumber=point.confirmation_number,
        description=point.description,
        imageUrl=point.image_url,
        logoUrl=point.logo_url,
        locations=[
            LocationResponse(
                locationId=loc.location_id,
                pointId=loc.point_id,
                role=loc.role,
                name=loc.name,
                lat=loc.lat,
                lng=loc.lng,
                fullAddress=loc.full_address,
                description=loc.description,
                link=loc.link,
                googlePlaceId=loc.google_place_id,
                googleMapsUri=loc.google_maps_uri,
            )
            for loc in sorted(locations, key=lambda l: l.sort_order)
        ],
        travelDetail=travel_detail,
        stayDetail=stay_detail,
        completed=point.completed,
        completedDateTime=point.completed_date_time,
        deletedAt=point.deleted_at.isoformat() if point.deleted_at else None,
        createdAt=point.created_at.isoformat() if point.created_at else None,
        updatedAt=point.updated_at.isoformat() if point.updated_at else None,
    )


@router.get("", response_model=list[TripListItem])
async def list_trips(db: Session = Depends(get_db)):
    records = db.query(TripRecord).order_by(TripRecord.start_date).all()
    return [
        TripListItem(
            tripId=r.trip_id,
            tripName=r.trip_name,
            startDate=r.start_date,
            endDate=r.end_date,
        )
        for r in records
    ]


@router.get("/{trip_id}", response_model=TripResponse)
async def get_trip(trip_id: str, db: Session = Depends(get_db)):
    record = db.get(TripRecord, trip_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    days = (
        db.query(TripDayRecord)
        .filter(TripDayRecord.trip_id == trip_id, TripDayRecord.deleted_at.is_(None))
        .order_by(TripDayRecord.date, TripDayRecord.is_alternate)
        .all()
    )

    day_ids = [d.day_id for d in days]

    points = (
        db.query(TripPointRecord)
        .filter(TripPointRecord.day_id.in_(day_ids), TripPointRecord.deleted_at.is_(None))
        .order_by(TripPointRecord.start_date_time)
        .all()
        if day_ids
        else []
    )

    point_ids = [p.point_id for p in points]

    locs_by_point: dict = {}
    travel_by_point: dict = {}
    stay_by_point: dict = {}

    if point_ids:
        for loc in db.query(LocationRecord).filter(LocationRecord.point_id.in_(point_ids)).all():
            locs_by_point.setdefault(loc.point_id, []).append(loc)
        for t in db.query(TravelDetailRecord).filter(TravelDetailRecord.point_id.in_(point_ids)).all():
            travel_by_point[t.point_id] = t
        for s in db.query(StayDetailRecord).filter(StayDetailRecord.point_id.in_(point_ids)).all():
            stay_by_point[s.point_id] = s

    points_by_day: dict = {}
    for p in points:
        points_by_day.setdefault(p.day_id, []).append(p)

    assembled_days = [
        TripDayWithPoints(
            dayId=d.day_id,
            tripId=d.trip_id,
            title=d.title,
            date=d.date,
            description=d.description,
            isAlternate=d.is_alternate,
            completed=d.completed,
            deletedAt=d.deleted_at.isoformat() if d.deleted_at else None,
            createdAt=d.created_at.isoformat() if d.created_at else None,
            updatedAt=d.updated_at.isoformat() if d.updated_at else None,
            points=[
                _point_to_response(
                    p,
                    locs_by_point.get(p.point_id, []),
                    travel_by_point.get(p.point_id),
                    stay_by_point.get(p.point_id),
                )
                for p in points_by_day.get(d.day_id, [])
            ],
        )
        for d in days
    ]

    return TripResponse(
        tripId=record.trip_id,
        tripName=record.trip_name,
        startDate=record.start_date,
        endDate=record.end_date,
        days=assembled_days,
    )


@router.post("", status_code=status.HTTP_200_OK)
async def upsert_trip(body: TripHeader, db: Session = Depends(get_db)):
    try:
        record = db.get(TripRecord, body.tripId)
        if record is None:
            db.add(
                TripRecord(
                    trip_id=body.tripId,
                    trip_name=body.tripName,
                    start_date=body.startDate,
                    end_date=body.endDate,
                )
            )
        else:
            record.trip_name = body.tripName
            record.start_date = body.startDate
            record.end_date = body.endDate
            record.updated_at = datetime.now(timezone.utc)
        db.commit()
        return {"status": "ok"}
    except Exception as exc:
        logging.error("POST /trips error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Failed to save trip"
        )


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(trip_id: str, db: Session = Depends(get_db)):
    trip = db.get(TripRecord, trip_id)
    if trip is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")

    # Delete in FK order: locations → travel/stay details → points → days → trip
    point_ids = [
        p.point_id
        for p in db.query(TripPointRecord).filter(TripPointRecord.trip_id == trip_id).all()
    ]
    if point_ids:
        db.query(LocationRecord).filter(LocationRecord.point_id.in_(point_ids)).delete(synchronize_session=False)
        db.query(TravelDetailRecord).filter(TravelDetailRecord.point_id.in_(point_ids)).delete(synchronize_session=False)
        db.query(StayDetailRecord).filter(StayDetailRecord.point_id.in_(point_ids)).delete(synchronize_session=False)
        db.query(TripPointRecord).filter(TripPointRecord.trip_id == trip_id).delete(synchronize_session=False)

    db.query(TripDayRecord).filter(TripDayRecord.trip_id == trip_id).delete(synchronize_session=False)
    db.delete(trip)
    db.commit()
