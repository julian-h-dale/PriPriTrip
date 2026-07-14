from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    active,
    deleted,
)
from app.schemas import (
    StayDetail,
    TravelDetail,
    TripPointCreate,
    TripPointPatch,
    TripPointResponse,
)
from app.services import trip_write

router = APIRouter(
    prefix="/trips/{trip_id}/points",
    tags=["trip points"],
)


async def _load_point_responses(
    points: list[TripPointRecord], db: AsyncSession
) -> list[TripPointResponse]:
    """Batch-load a list of points: 4 queries total, not 5 per point (review.md 1C-3)."""
    if not points:
        return []

    stay_ids = {p.stay_detail_id for p in points if p.stay_detail_id}
    travel_ids = {p.travel_detail_id for p in points if p.travel_detail_id}

    stays = {
        s.stay_detail_id: s
        for s in (
            await db.execute(
                select(StayDetailRecord).where(
                    StayDetailRecord.stay_detail_id.in_(stay_ids),
                    active(StayDetailRecord),
                )
            )
        ).scalars().all()
        if s.stay_detail_id in stay_ids and not s.is_deleted and s.deleted_at is None
    } if stay_ids else {}

    travels = {
        t.travel_detail_id: t
        for t in (
            await db.execute(
                select(TravelDetailRecord).where(
                    TravelDetailRecord.travel_detail_id.in_(travel_ids),
                    active(TravelDetailRecord),
                )
            )
        ).scalars().all()
        if t.travel_detail_id in travel_ids and not t.is_deleted and t.deleted_at is None
    } if travel_ids else {}

    point_ids = {p.point_id for p in points}
    locs_by_point: dict[str, list[LocationRecord]] = {}
    locs_by_stay: dict[str, list[LocationRecord]] = {}
    locs_by_travel: dict[str, list[LocationRecord]] = {}
    owner_filter = [LocationRecord.point_id.in_(point_ids)]
    if stays:
        owner_filter.append(LocationRecord.stay_detail_id.in_(stays))
    if travels:
        owner_filter.append(LocationRecord.travel_detail_id.in_(travels))

    all_locations = (
        await db.execute(
            select(LocationRecord)
            .where(or_(*owner_filter))
            .order_by(LocationRecord.sort_order)
        )
    ).scalars().all()
    for loc in all_locations:
        if loc.point_id in point_ids:
            locs_by_point.setdefault(loc.point_id, []).append(loc)
        elif loc.stay_detail_id in stays:
            locs_by_stay.setdefault(loc.stay_detail_id, []).append(loc)
        elif loc.travel_detail_id in travels:
            locs_by_travel.setdefault(loc.travel_detail_id, []).append(loc)

    return [
        TripPointResponse.from_record(
            point,
            locs_by_point.get(point.point_id, []),
            (
                TravelDetail.from_record(
                    travels[point.travel_detail_id],
                    locs_by_travel.get(point.travel_detail_id, []),
                )
                if point.travel_detail_id in travels
                else None
            ),
            (
                StayDetail.from_record(
                    stays[point.stay_detail_id],
                    locs_by_stay.get(point.stay_detail_id, []),
                )
                if point.stay_detail_id in stays
                else None
            ),
        )
        for point in points
    ]


async def _load_point_response(point: TripPointRecord, db: AsyncSession) -> TripPointResponse:
    """One point, through the batched loader (review.md R19).

    This used to be a second, hand-written implementation that fired five queries
    for a single point. Two loaders for one response shape meant two places for the
    soft-delete filter to be forgotten; now there is only one, and it costs four
    queries whether you ask for one point or a hundred.
    """
    [response] = await _load_point_responses([point], db)
    return response



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
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TripPointRecord)
        .where(
            TripPointRecord.trip_id == trip.trip_id,
            active(TripPointRecord),
        )
        .order_by(TripPointRecord.start_local)
    )
    points = result.scalars().all()
    return await _load_point_responses(list(points), db)


@router.get("/deleted", response_model=list[TripPointResponse])
async def list_deleted_points(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TripPointRecord)
        .where(
            TripPointRecord.trip_id == trip.trip_id,
            deleted(TripPointRecord),
        )
        .order_by(TripPointRecord.start_local)
    )
    points = result.scalars().all()
    return await _load_point_responses(list(points), db)


@router.post("", response_model=TripPointResponse, status_code=status.HTTP_201_CREATED)
async def create_point(
    body: TripPointCreate,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    if await db.get(TripPointRecord, body.point_id) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Point already exists")
    day = await db.get(TripDayRecord, body.day_id)
    if day is None or day.is_deleted or day.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Day not found")
    await _validate_detail_refs(trip.trip_id, body.stay_detail_id, body.travel_detail_id, db)

    result = await trip_write.create_point(db, trip, day, body)
    await db.commit()
    await db.refresh(result.record)
    return await _load_point_response(result.record, db)



@router.patch("/{point_id}", response_model=TripPointResponse)
async def patch_point(
    point_id: str,
    body: TripPointPatch,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    point = await db.get(TripPointRecord, point_id)
    if point is None or point.is_deleted or point.deleted_at is not None or point.trip_id != trip.trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")

    await _validate_detail_refs(
        trip.trip_id,
        body.stay_detail_id if "stay_detail_id" in body.model_fields_set else None,
        body.travel_detail_id if "travel_detail_id" in body.model_fields_set else None,
        db,
    )
    await trip_write.update_point(db, trip, point, body)
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)


@router.delete("/{point_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_point(
    point_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    point = await db.get(TripPointRecord, point_id)
    if point is None or point.is_deleted or point.deleted_at is not None or point.trip_id != trip.trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    await trip_write.delete_point(db, trip, point)
    await db.commit()


@router.post("/{point_id}/restore", response_model=TripPointResponse)
async def restore_point(
    point_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    point = await db.get(TripPointRecord, point_id)
    if point is None or point.trip_id != trip.trip_id:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Point not found")
    if point.deleted_at is None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Point is not deleted")
    point.is_deleted = False
    point.deleted_at = None
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)
