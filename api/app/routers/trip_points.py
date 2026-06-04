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
    TripPointCreate,
    TripPointPatch,
    TripPointResponse,
    TripPointUpdate,
)

router = APIRouter(
    prefix="/trips/{trip_id}/points",
    tags=["trip points"],
    dependencies=[Depends(require_auth)],
)


def _require_trip(trip_id: str, db: Session) -> TripRecord:
    record = db.get(TripRecord, trip_id)
    if record is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return record


def _load_point_response(point: TripPointRecord, db: Session) -> TripPointResponse:
    locations = (
        db.query(LocationRecord)
        .filter(LocationRecord.point_id == point.point_id)
        .order_by(LocationRecord.sort_order)
        .all()
    )
    travel = db.get(TravelDetailRecord, point.point_id)
    stay = db.get(StayDetailRecord, point.point_id)

    travel_detail = (
        TravelDetail(
            mode=travel.mode,
            operator=travel.operator,
            vehicleNumber=travel.vehicle_number,
            cabinClass=travel.cabin_class,
        )
        if travel
        else None
    )
    stay_detail = (
        StayDetail(
            stayType=stay.stay_type,
            checkInTime=stay.check_in_time,
            checkOutTime=stay.check_out_time,
            roomType=stay.room_type,
        )
        if stay
        else None
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
            for loc in locations
        ],
        travelDetail=travel_detail,
        stayDetail=stay_detail,
        completed=point.completed,
        completedDateTime=point.completed_date_time,
        deletedAt=point.deleted_at.isoformat() if point.deleted_at else None,
        createdAt=point.created_at.isoformat() if point.created_at else None,
        updatedAt=point.updated_at.isoformat() if point.updated_at else None,
    )


def _replace_locations(point_id: str, locations_payload: list, db: Session) -> None:
    db.query(LocationRecord).filter(LocationRecord.point_id == point_id).delete()
    for i, loc in enumerate(locations_payload):
        db.add(
            LocationRecord(
                location_id=loc.locationId,
                point_id=point_id,
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


def _replace_details(
    point_id: str,
    travel_detail,
    stay_detail,
    db: Session,
) -> None:
    existing_travel = db.get(TravelDetailRecord, point_id)
    if existing_travel:
        db.delete(existing_travel)
    existing_stay = db.get(StayDetailRecord, point_id)
    if existing_stay:
        db.delete(existing_stay)

    if travel_detail is not None:
        db.add(
            TravelDetailRecord(
                point_id=point_id,
                mode=travel_detail.mode,
                operator=travel_detail.operator,
                vehicle_number=travel_detail.vehicleNumber,
                cabin_class=travel_detail.cabinClass,
            )
        )
    if stay_detail is not None:
        db.add(
            StayDetailRecord(
                point_id=point_id,
                stay_type=stay_detail.stayType,
                check_in_time=stay_detail.checkInTime,
                check_out_time=stay_detail.checkOutTime,
                room_type=stay_detail.roomType,
            )
        )


@router.get("", response_model=list[TripPointResponse])
async def list_points(trip_id: str, db: Session = Depends(get_db)):
    _require_trip(trip_id, db)
    points = (
        db.query(TripPointRecord)
        .filter(TripPointRecord.trip_id == trip_id, TripPointRecord.deleted_at.is_(None))
        .order_by(TripPointRecord.start_date_time)
        .all()
    )
    return [_load_point_response(p, db) for p in points]


@router.get("/deleted", response_model=list[TripPointResponse])
async def list_deleted_points(trip_id: str, db: Session = Depends(get_db)):
    _require_trip(trip_id, db)
    points = (
        db.query(TripPointRecord)
        .filter(
            TripPointRecord.trip_id == trip_id,
            TripPointRecord.deleted_at.isnot(None),
        )
        .order_by(TripPointRecord.start_date_time)
        .all()
    )
    return [_load_point_response(p, db) for p in points]


@router.post("", response_model=TripPointResponse, status_code=status.HTTP_201_CREATED)
async def create_point(trip_id: str, body: TripPointCreate, db: Session = Depends(get_db)):
    _require_trip(trip_id, db)
    if db.get(TripPointRecord, body.pointId) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Point already exists")
    day = db.get(TripDayRecord, body.dayId)
    if day is None or day.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")

    point = TripPointRecord(
        point_id=body.pointId,
        trip_id=trip_id,
        day_id=body.dayId,
        type=body.type,
        title=body.title,
        start_date_time=body.startDateTime,
        end_date_time=body.endDateTime,
        confirmation_number=body.confirmationNumber,
        description=body.description,
        image_url=body.imageUrl,
        logo_url=body.logoUrl,
        completed=body.completed,
        completed_date_time=body.completedDateTime,
    )
    db.add(point)
    db.flush()
    _replace_locations(body.pointId, body.locations, db)
    _replace_details(body.pointId, body.travelDetail, body.stayDetail, db)
    db.commit()
    db.refresh(point)
    return _load_point_response(point, db)


@router.put("/{point_id}", response_model=TripPointResponse)
async def update_point(trip_id: str, point_id: str, body: TripPointUpdate, db: Session = Depends(get_db)):
    point = db.get(TripPointRecord, point_id)
    if point is None or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    day = db.get(TripDayRecord, body.dayId)
    if day is None or day.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")

    point.day_id = body.dayId
    point.type = body.type
    point.title = body.title
    point.start_date_time = body.startDateTime
    point.end_date_time = body.endDateTime
    point.confirmation_number = body.confirmationNumber
    point.description = body.description
    point.image_url = body.imageUrl
    point.logo_url = body.logoUrl
    point.completed = body.completed
    point.completed_date_time = body.completedDateTime
    point.updated_at = datetime.now(timezone.utc)

    _replace_locations(point_id, body.locations, db)
    _replace_details(point_id, body.travelDetail, body.stayDetail, db)
    db.commit()
    db.refresh(point)
    return _load_point_response(point, db)


@router.patch("/{point_id}", response_model=TripPointResponse)
async def patch_point(trip_id: str, point_id: str, body: TripPointPatch, db: Session = Depends(get_db)):
    point = db.get(TripPointRecord, point_id)
    if point is None or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")

    _scalar_field_map = {
        "dayId": "day_id",
        "type": "type",
        "title": "title",
        "startDateTime": "start_date_time",
        "endDateTime": "end_date_time",
        "confirmationNumber": "confirmation_number",
        "description": "description",
        "imageUrl": "image_url",
        "logoUrl": "logo_url",
        "completed": "completed",
        "completedDateTime": "completed_date_time",
    }
    for pydantic_field, orm_field in _scalar_field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(point, orm_field, getattr(body, pydantic_field))

    if "locations" in body.model_fields_set:
        _replace_locations(point_id, body.locations or [], db)
    if "travelDetail" in body.model_fields_set or "stayDetail" in body.model_fields_set:
        _replace_details(point_id, body.travelDetail, body.stayDetail, db)

    point.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(point)
    return _load_point_response(point, db)


@router.delete("/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_point(trip_id: str, point_id: str, db: Session = Depends(get_db)):
    point = db.get(TripPointRecord, point_id)
    if point is None or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    point.deleted_at = datetime.now(timezone.utc)
    point.updated_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/{point_id}/restore", response_model=TripPointResponse)
async def restore_point(trip_id: str, point_id: str, db: Session = Depends(get_db)):
    point = db.get(TripPointRecord, point_id)
    if point is None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    if point.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Point is not deleted")
    point.deleted_at = None
    point.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(point)
    return _load_point_response(point, db)
