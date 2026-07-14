"""CRUD endpoints for travel and stay details as first-class trip entities.

Stays and travels live directly under a trip (siblings of days). Timeline points
(check-in/check-out, departure/arrival) reference them by id.

**There are no domain rules in this file.** Timezone inference, UTC derivation,
location resolution, generated-point syncing and `promote_to_draft` all live in
`services/trip_write.py` — the same functions the chat assistant's executor calls.
These handlers do the HTTP-specific work only: authorize, 404, call the write
layer, serialize, commit.

That split is the point. These rules used to be implemented here *and* in the
executor, and the two copies drifted into real bugs (review.md R1–R4).
"""

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import (
    active,
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripRecord,
)
from app.schemas import (
    StayDetail,
    StayDetailImport,
    StayDetailPatch,
    TravelDetail,
    TravelDetailImport,
    TravelDetailPatch,
)
from app.services import trip_write

router = APIRouter(prefix="/trips/{trip_id}", tags=["trip details"])


async def _detail_locations(db: AsyncSession, *, stay_id=None, travel_id=None) -> list:
    if stay_id is not None:
        cond = LocationRecord.stay_detail_id == stay_id
    else:
        cond = LocationRecord.travel_detail_id == travel_id
    result = await db.execute(
        select(LocationRecord).where(cond).order_by(LocationRecord.sort_order)
    )
    return list(result.scalars().all())


async def _locations_by_owner(db: AsyncSession, *, stay_ids=None, travel_ids=None) -> dict[str, list]:
    """One query for a whole list's locations, grouped by owner id."""
    owner_ids = set(stay_ids or travel_ids or ())
    if not owner_ids:
        return {}
    column = LocationRecord.stay_detail_id if stay_ids else LocationRecord.travel_detail_id
    result = await db.execute(
        select(LocationRecord).where(column.in_(owner_ids)).order_by(LocationRecord.sort_order)
    )
    grouped: dict[str, list] = {}
    for loc in result.scalars().all():
        owner_id = loc.stay_detail_id if stay_ids else loc.travel_detail_id
        if owner_id in owner_ids:
            grouped.setdefault(owner_id, []).append(loc)
    return grouped


async def _require(db: AsyncSession, model, record_id: str, trip_id: str, noun: str):
    rec = await db.get(model, record_id)
    if rec is None or rec.trip_id != trip_id or rec.is_deleted or rec.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"{noun} not found")
    return rec


# ── Travel details ────────────────────────────────────────────────────────

@router.get("/travel-details", response_model=list[TravelDetail])
async def list_travel_details(
    trip_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(TravelDetailRecord).where(
            TravelDetailRecord.trip_id == trip_id,
            active(TravelDetailRecord),
        )
    )
    records = list(result.scalars().all())
    locs = await _locations_by_owner(db, travel_ids=[r.travel_detail_id for r in records])
    return [TravelDetail.from_record(r, locs.get(r.travel_detail_id, [])) for r in records]


@router.post("/travel-details", response_model=TravelDetail, status_code=status.HTTP_201_CREATED)
async def create_travel_detail(
    trip_id: str,
    body: TravelDetailImport,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await trip_write.create_travel(db, trip, body)
    await db.commit()
    await db.refresh(result.record)
    locs = await _detail_locations(db, travel_id=result.record.travel_detail_id)
    return TravelDetail.from_record(result.record, locs)


@router.get("/travel-details/{travel_detail_id}", response_model=TravelDetail)
async def get_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require(db, TravelDetailRecord, travel_detail_id, trip_id, "Travel detail")
    locs = await _detail_locations(db, travel_id=travel_detail_id)
    return TravelDetail.from_record(rec, locs)


@router.patch("/travel-details/{travel_detail_id}", response_model=TravelDetail)
async def patch_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    body: TravelDetailPatch,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require(db, TravelDetailRecord, travel_detail_id, trip_id, "Travel detail")
    await trip_write.update_travel(db, trip, rec, body)
    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, travel_id=travel_detail_id)
    return TravelDetail.from_record(rec, locs)


@router.delete("/travel-details/{travel_detail_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_travel_detail(
    trip_id: str,
    travel_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require(db, TravelDetailRecord, travel_detail_id, trip_id, "Travel detail")
    await trip_write.delete_travel(db, trip, rec)
    await db.commit()


# ── Stay details ──────────────────────────────────────────────────────────

@router.get("/stay-details", response_model=list[StayDetail])
async def list_stay_details(
    trip_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await db.execute(
        select(StayDetailRecord).where(
            StayDetailRecord.trip_id == trip_id,
            active(StayDetailRecord),
        )
    )
    records = list(result.scalars().all())
    locs = await _locations_by_owner(db, stay_ids=[r.stay_detail_id for r in records])
    return [StayDetail.from_record(r, locs.get(r.stay_detail_id, [])) for r in records]


@router.post("/stay-details", response_model=StayDetail, status_code=status.HTTP_201_CREATED)
async def create_stay_detail(
    trip_id: str,
    body: StayDetailImport,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    result = await trip_write.create_stay(db, trip, body)
    await db.commit()
    await db.refresh(result.record)
    locs = await _detail_locations(db, stay_id=result.record.stay_detail_id)
    return StayDetail.from_record(result.record, locs)


@router.get("/stay-details/{stay_detail_id}", response_model=StayDetail)
async def get_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require(db, StayDetailRecord, stay_detail_id, trip_id, "Stay detail")
    locs = await _detail_locations(db, stay_id=stay_detail_id)
    return StayDetail.from_record(rec, locs)


@router.patch("/stay-details/{stay_detail_id}", response_model=StayDetail)
async def patch_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    body: StayDetailPatch,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require(db, StayDetailRecord, stay_detail_id, trip_id, "Stay detail")
    await trip_write.update_stay(db, trip, rec, body)
    await db.commit()
    await db.refresh(rec)
    locs = await _detail_locations(db, stay_id=stay_detail_id)
    return StayDetail.from_record(rec, locs)


@router.delete("/stay-details/{stay_detail_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_stay_detail(
    trip_id: str,
    stay_detail_id: str,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    rec = await _require(db, StayDetailRecord, stay_detail_id, trip_id, "Stay detail")
    await trip_write.delete_stay(db, trip, rec)
    await db.commit()
