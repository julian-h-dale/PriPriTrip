from datetime import datetime, timezone

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
    TripPointCreate,
    TripPointPatch,
    TripPointResponse,
    TripPointUpdate,
)
from app.serializers import point_to_response, stay_to_response, travel_to_response

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

    travel_detail = None
    if point.travel_detail_id:
        travel = await db.get(TravelDetailRecord, point.travel_detail_id)
        if travel and not travel.is_deleted and travel.deleted_at is None:
            tlocs = (
                await db.execute(
                    select(LocationRecord).where(
                        LocationRecord.travel_detail_id == travel.travel_detail_id
                    )
                )
            ).scalars().all()
            travel_detail = travel_to_response(travel, tlocs)

    stay_detail = None
    if point.stay_detail_id:
        stay = await db.get(StayDetailRecord, point.stay_detail_id)
        if stay and not stay.is_deleted and stay.deleted_at is None:
            slocs = (
                await db.execute(
                    select(LocationRecord).where(
                        LocationRecord.stay_detail_id == stay.stay_detail_id
                    )
                )
            ).scalars().all()
            stay_detail = stay_to_response(stay, slocs)

    return point_to_response(point, locations, travel_detail, stay_detail)


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


async def _validate_detail_refs(
    trip_id: str,
    stay_detail_id: str | None,
    travel_detail_id: str | None,
    db: AsyncSession,
) -> None:
    """Ensure referenced stay/travel details exist and belong to this trip."""
    if stay_detail_id:
        stay = await db.get(StayDetailRecord, stay_detail_id)
        if stay is None or stay.trip_id != trip_id or stay.is_deleted or stay.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Stay detail not found"
            )
    if travel_detail_id:
        travel = await db.get(TravelDetailRecord, travel_detail_id)
        if travel is None or travel.trip_id != trip_id or travel.is_deleted or travel.deleted_at is not None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND, detail="Travel detail not found"
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
        .where(
            TripPointRecord.trip_id == trip_id,
            TripPointRecord.is_deleted.is_(False),
            TripPointRecord.deleted_at.is_(None),
        )
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
            TripPointRecord.is_deleted.is_(True),
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
    if day is None or day.is_deleted or day.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    await _validate_detail_refs(trip_id, body.stayDetailId, body.travelDetailId, db)

    point = TripPointRecord(
        point_id=body.pointId,
        trip_id=trip_id,
        day_id=body.dayId,
        type=body.type,
        title=body.title,
        stay_detail_id=body.stayDetailId,
        travel_detail_id=body.travelDetailId,
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
    if point is None or point.is_deleted or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    day = await db.get(TripDayRecord, body.dayId)
    if day is None or day.is_deleted or day.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")

    day = await db.get(TripDayRecord, body.dayId)
    if day is None or day.is_deleted or day.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    await _validate_detail_refs(trip_id, body.stayDetailId, body.travelDetailId, db)

    point.day_id = body.dayId
    point.type = body.type
    point.title = body.title
    point.stay_detail_id = body.stayDetailId
    point.travel_detail_id = body.travelDetailId
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
    if point is None or point.is_deleted or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)

    _scalar_field_map = {
        "dayId": "day_id",
        "type": "type",
        "title": "title",
        "stayDetailId": "stay_detail_id",
        "travelDetailId": "travel_detail_id",
        "startDateTime": "start_date_time",
        "endDateTime": "end_date_time",
        "confirmationNumber": "confirmation_number",
        "description": "description",
        "imageUrl": "image_url",
        "logoUrl": "logo_url",
        "completed": "completed",
        "completedDateTime": "completed_date_time",
    }
    await _validate_detail_refs(
        trip_id,
        body.stayDetailId if "stayDetailId" in body.model_fields_set else None,
        body.travelDetailId if "travelDetailId" in body.model_fields_set else None,
        db,
    )
    for pydantic_field, orm_field in _scalar_field_map.items():
        if pydantic_field in body.model_fields_set:
            setattr(point, orm_field, getattr(body, pydantic_field))

    if "locations" in body.model_fields_set:
        await _replace_locations(point_id, body.locations or [], db)

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
    if point is None or point.is_deleted or point.deleted_at is not None or point.trip_id != trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    _require_trip(await db.get(TripRecord, trip_id), trip_id, user)
    point.is_deleted = True
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
    point.is_deleted = False
    point.deleted_at = None
    point.updated_at = datetime.now(timezone.utc)
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)
