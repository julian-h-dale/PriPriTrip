from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import delete, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.enums import DERIVED_POINT_TYPES
from app.services.detail_points import generated_point_conflict
from app.models import (
    active,
    deleted,
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
)
from app.schemas import (
    StayDetail,
    TravelDetail,
    TripPointCreate,
    TripPointPatch,
    TripPointResponse,
)
from app.services.locations import location_rows
from app.services.timezones import (
    derive_utc,
    infer_tzid_from_locations,
    parse_wall_clock,
    tzid_from_coords,
    wall_clock_to_text,
)

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
            travel_detail = TravelDetail.from_record(travel, tlocs)

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
            stay_detail = StayDetail.from_record(stay, slocs)

    return TripPointResponse.from_record(point, locations, travel_detail, stay_detail)


async def _replace_locations(point_id: str, locations_payload: list, db: AsyncSession) -> None:
    await db.execute(delete(LocationRecord).where(LocationRecord.point_id == point_id))
    for row in location_rows(locations_payload, point_id=point_id):
        db.add(row)


async def _infer_tzid_from_day_stay(
    db: AsyncSession,
    *,
    trip_id: str,
    day_id: str,
    fallback: str | None,
) -> str | None:
    day = await db.get(TripDayRecord, day_id)
    if day is None:
        return fallback

    stays_result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip_id,
            active(StayDetailRecord),
        )
    )
    for stay in stays_result.scalars().all():
        if stay.check_in_local is None or stay.check_out_local is None:
            continue
        if stay.check_in_local.date() <= day.date <= stay.check_out_local.date():
            locs = await db.execute(
                select(LocationRecord).where(LocationRecord.stay_detail_id == stay.stay_detail_id)
            )
            for loc in locs.scalars().all():
                tzid = loc.timezone_id or tzid_from_coords(loc.lat, loc.lng)
                if tzid:
                    return tzid
            if stay.check_in_tzid:
                return stay.check_in_tzid
    return fallback


async def _infer_point_tzid(
    db: AsyncSession,
    *,
    trip: TripRecord,
    day_id: str,
    locations_payload: list,
    explicit_tzid: str | None,
) -> str:
    if explicit_tzid:
        return explicit_tzid

    fallback = trip.default_timezone_id

    tzid = infer_tzid_from_locations(locations_payload, fallback=None)
    if tzid:
        return tzid

    tzid = await _infer_tzid_from_day_stay(db, trip_id=trip.trip_id, day_id=day_id, fallback=None)
    if tzid:
        return tzid

    return fallback or "UTC"


def _reject_derived_type(point_type: str | None) -> None:
    """Only 'activity' points are authored; the rest are generated.

    See app.enums.DERIVED_POINT_TYPES — detail_points.py is their single writer,
    and a second one is what put two departures on every flight.
    """
    if point_type in DERIVED_POINT_TYPES:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"A {point_type!r} point is generated from the stay or travel leg it belongs "
                f"to and cannot be created directly. Create the stay or the travel leg with "
                f"its times, and the point appears on the timeline by itself."
            ),
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
    _reject_derived_type(body.type)
    await _validate_detail_refs(trip.trip_id, body.stay_detail_id, body.travel_detail_id, db)

    point = TripPointRecord(
        point_id=body.point_id,
        trip_id=trip.trip_id,
        day_id=body.day_id,
        type=body.type,
        title=body.title,
        stay_detail_id=body.stay_detail_id,
        travel_detail_id=body.travel_detail_id,
        confirmation_number=body.confirmation_number,
        description=body.description,
        image_url=body.image_url,
        logo_url=body.logo_url,
        is_system_created=body.is_system_created,
        completed=body.completed,
        completed_date_time=body.completed_date_time,
    )
    db.add(point)
    await db.flush()
    inferred_tzid = await _infer_point_tzid(
        db,
        trip=trip,
        day_id=body.day_id,
        locations_payload=body.locations,
        explicit_tzid=body.start_timezone_id or body.end_timezone_id,
    )
    point.start_local = parse_wall_clock(body.start_date_time)
    point.start_tzid = body.start_timezone_id or inferred_tzid
    point.start_utc = derive_utc(point.start_local, point.start_tzid)
    point.end_local = parse_wall_clock(body.end_date_time)
    point.end_tzid = body.end_timezone_id or inferred_tzid
    point.end_utc = derive_utc(point.end_local, point.end_tzid)
    await _replace_locations(body.point_id, body.locations, db)
    await db.commit()
    await db.refresh(point)
    return await _load_point_response(point, db)



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

    # Field names match the ORM columns 1:1 now that schemas are snake_case.
    _scalar_fields = (
        "day_id",
        "type",
        "title",
        "stay_detail_id",
        "travel_detail_id",
        "start_date_time",
        "end_date_time",
        "confirmation_number",
        "description",
        "image_url",
        "logo_url",
        "is_system_created",
        "completed",
        "completed_date_time",
    )
    _reject_derived_type(body.type)
    conflict = generated_point_conflict(point, body.model_fields_set)
    if conflict:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=conflict)

    await _validate_detail_refs(
        trip.trip_id,
        body.stay_detail_id if "stay_detail_id" in body.model_fields_set else None,
        body.travel_detail_id if "travel_detail_id" in body.model_fields_set else None,
        db,
    )
    for field in _scalar_fields:
        if field in body.model_fields_set:
            setattr(point, field, getattr(body, field))

    effective_day_id = point.day_id
    effective_locations = body.locations if "locations" in body.model_fields_set else (
        (await db.execute(select(LocationRecord).where(LocationRecord.point_id == point_id))).scalars().all()
    )
    inferred_tzid = await _infer_point_tzid(
        db,
        trip=trip,
        day_id=effective_day_id,
        locations_payload=effective_locations,
        explicit_tzid=(
            body.start_timezone_id
            if "start_timezone_id" in body.model_fields_set
            else point.start_tzid
        ) or (
            body.end_timezone_id
            if "end_timezone_id" in body.model_fields_set
            else point.end_tzid
        ),
    )

    start_text = (
        body.start_date_time
        if "start_date_time" in body.model_fields_set
        else wall_clock_to_text(point.start_local)
    )
    end_text = (
        body.end_date_time
        if "end_date_time" in body.model_fields_set
        else wall_clock_to_text(point.end_local)
    )

    point.start_local = parse_wall_clock(start_text)
    point.start_tzid = (
        body.start_timezone_id if "start_timezone_id" in body.model_fields_set else point.start_tzid
    ) or inferred_tzid
    point.start_utc = derive_utc(point.start_local, point.start_tzid)
    point.end_local = parse_wall_clock(end_text)
    point.end_tzid = (
        body.end_timezone_id if "end_timezone_id" in body.model_fields_set else point.end_tzid
    ) or inferred_tzid
    point.end_utc = derive_utc(point.end_local, point.end_tzid)

    if "locations" in body.model_fields_set:
        await _replace_locations(point_id, body.locations or [], db)

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
    if point.is_system_created:
        parent = "stay" if point.stay_detail_id else "travel leg"
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=(
                f"{point.title!r} is generated from its {parent} and would come straight back "
                f"on the next sync. Delete the {parent}, or clear the time it is generated from."
            ),
        )
    point.is_deleted = True
    point.deleted_at = datetime.now(timezone.utc)
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
