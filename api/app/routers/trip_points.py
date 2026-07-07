from datetime import datetime, timezone
import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, delete
from sqlalchemy.ext.asyncio import AsyncSession

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
)


def _require_trip(trip: TripRecord | None, trip_id: str, user: UserRecord) -> TripRecord:
    if trip is None or trip.user_id != str(user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Trip not found")
    return trip


async def _load_point_response(point: TripPointRecord, db: AsyncSession) -> TripPointResponse:
    loc_result = await db.execute(
        select(LocationRecord)
        .where(LocationRecord.point_id == point.point_id)
        .order_by(LocationRecord.sort_order)
    )
    locations = loc_result.scalars().all()
    travel = (
        await db.execute(
            select(TravelDetailRecord).where(TravelDetailRecord.point_id == point.point_id)
        )
    ).scalar_one_or_none()
    stay = (
        await db.execute(
            select(StayDetailRecord).where(StayDetailRecord.point_id == point.point_id)
        )
    ).scalar_one_or_none()

    travel_detail = (
        TravelDetail(
            travelDetailId=travel.travel_detail_id,
            tripId=travel.trip_id,
            pointId=travel.point_id,
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
            stayDetailId=stay.stay_detail_id,
            tripId=stay.trip_id,
            pointId=stay.point_id,
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


async def _replace_locations(point_id: str, locations_payload: list, db: AsyncSession) -> None:
    await db.execute(delete(LocationRecord).where(LocationRecord.point_id == point_id))
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


async def _replace_details(
    point_id: str,
    trip_id: str,
    travel_detail,
    stay_detail,
    db: AsyncSession,
) -> None:
    # Preserve existing detail IDs across point saves so standalone detail
    # references stay stable.
    existing_travel = (
        await db.execute(
            select(TravelDetailRecord).where(TravelDetailRecord.point_id == point_id)
        )
    ).scalar_one_or_none()
    existing_stay = (
        await db.execute(
            select(StayDetailRecord).where(StayDetailRecord.point_id == point_id)
        )
    ).scalar_one_or_none()

    travel_id = existing_travel.travel_detail_id if existing_travel else str(uuid.uuid4())
    stay_id = existing_stay.stay_detail_id if existing_stay else str(uuid.uuid4())

    if existing_travel:
        await db.delete(existing_travel)
    if existing_stay:
        await db.delete(existing_stay)
    await db.flush()

    if travel_detail is not None:
        db.add(
            TravelDetailRecord(
                travel_detail_id=travel_id,
                trip_id=trip_id,
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
                stay_detail_id=stay_id,
                trip_id=trip_id,
                point_id=point_id,
                stay_type=stay_detail.stayType,
                check_in_time=stay_detail.checkInTime,
                check_out_time=stay_detail.checkOutTime,
                room_type=stay_detail.roomType,
            )
        )


@router.get("", response_model=list[TripPointResponse])
async def list_points(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    result = await db.execute(
        select(TripPointRecord)
        .where(TripPointRecord.trip_id == trip_id, TripPointRecord.deleted_at.is_(None))
        .order_by(TripPointRecord.start_date_time)
    )
    points = result.scalars().all()
    return [await _load_point_response(p, db) for p in points]


@router.get("/deleted", response_model=list[TripPointResponse])
async def list_deleted_points(
    trip_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    result = await db.execute(
        select(TripPointRecord)
        .where(
            TripPointRecord.trip_id == trip_id,
            TripPointRecord.deleted_at.isnot(None),
        )
        .order_by(TripPointRecord.start_date_time)
    )
    points = result.scalars().all()
    return [await _load_point_response(p, db) for p in points]


@router.post("", response_model=TripPointResponse, status_code=status.HTTP_201_CREATED)
async def create_point(
    trip_id: str,
    body: TripPointCreate,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    if await db.get(TripPointRecord, body.pointId) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Point already exists")
    day = await db.get(TripDayRecord, body.dayId)
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
    await db.flush()
    await _replace_locations(body.pointId, body.locations, db)
    await _replace_details(body.pointId, trip_id, body.travelDetail, body.stayDetail, db)
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)


@router.put("/{point_id}", response_model=TripPointResponse)
async def update_point(
    trip_id: str,
    point_id: str,
    body: TripPointUpdate,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    point = await db.get(TripPointRecord, point_id)
    if point is None or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    day = await db.get(TripDayRecord, body.dayId)
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

    await _replace_locations(point_id, body.locations, db)
    await _replace_details(point_id, trip_id, body.travelDetail, body.stayDetail, db)
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)


@router.patch("/{point_id}", response_model=TripPointResponse)
async def patch_point(
    trip_id: str,
    point_id: str,
    body: TripPointPatch,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    point = await db.get(TripPointRecord, point_id)
    if point is None or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)

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
        await _replace_locations(point_id, body.locations or [], db)
    if "travelDetail" in body.model_fields_set or "stayDetail" in body.model_fields_set:
        await _replace_details(point_id, trip_id, body.travelDetail, body.stayDetail, db)

    point.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)


@router.delete("/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_point(
    trip_id: str,
    point_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    point = await db.get(TripPointRecord, point_id)
    if point is None or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    point.deleted_at = datetime.now(timezone.utc)
    point.updated_at = datetime.now(timezone.utc)
    await db.commit()


@router.post("/{point_id}/restore", response_model=TripPointResponse)
async def restore_point(
    trip_id: str,
    point_id: str,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    point = await db.get(TripPointRecord, point_id)
    if point is None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    if point.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Point is not deleted")
    point.deleted_at = None
    point.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)
