from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import (
    active,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    UserRecord,
)
from app.schemas import (
    TripHeader,
    TripHeaderResponse,
    TripListItem,
    TripResponse,
    VerifyResult,
)
from app.services.detail_points import reconcile_trip_days
from app.services.trip_state import assembled_trip
from app.services.trip_verify import verify_trip

router = APIRouter(prefix="/trips", tags=["trips"])


@router.get("", response_model=list[TripListItem])
async def list_trips(
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    result = await db.execute(
        select(TripRecord)
        .where(
            TripRecord.user_id == str(user.id),
            active(TripRecord),
        )
        .order_by(TripRecord.start_date)
    )
    records = result.scalars().all()
    return [TripListItem.model_validate(r) for r in records]


@router.get("/{trip_id}", response_model=TripResponse)
async def get_trip(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    return await _load_trip(trip, db)


async def _load_trip(record: TripRecord, db: AsyncSession) -> TripResponse:
    # One loader for the whole app: the chat loop and these routes had grown
    # two near-identical hand-rolled assemblies (review.md 1C-3).
    return await assembled_trip(db, record)


@router.get("/{trip_id}/verify", response_model=VerifyResult)
async def verify_trip_endpoint(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    assembled = await _load_trip(trip, db)
    return verify_trip(assembled)


@router.put("/{trip_id}", response_model=TripHeaderResponse, status_code=status.HTTP_200_OK)
async def upsert_trip(
    trip_id: str,
    body: TripHeader,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    # The path is authoritative; body.tripId is still accepted but ignored.
    record = await db.get(TripRecord, trip_id)
    if record is None:
        record = TripRecord(
            trip_id=trip_id,
            user_id=str(user.id),
            trip_name=body.trip_name,
            start_location_name=body.start_location_name,
            destination_location_name=body.destination_location_name,
            default_timezone_id=body.default_timezone_id,
            start_date=body.start_date,
            end_date=body.end_date,
        )
        db.add(record)
    else:
        if record.user_id != str(user.id):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Forbidden")
        if bool(record.is_deleted) or record.deleted_at is not None:
            record.is_deleted = False
            record.deleted_at = None
        record.trip_name = body.trip_name
        record.start_location_name = body.start_location_name
        record.destination_location_name = body.destination_location_name
        record.default_timezone_id = body.default_timezone_id
        record.start_date = body.start_date
        record.end_date = body.end_date

    # A trip's dates and its day rows are the same fact, so they are reconciled
    # together — otherwise a trip saved here has a date range and an empty
    # timeline, and the first flight to land on one of those dates silently
    # invents the day it needed. The chat executor already did this on a date
    # change; the REST path did not.
    await db.flush()
    await reconcile_trip_days(db, record)
    await db.commit()
    return TripHeaderResponse(
        trip_id=record.trip_id,
        trip_name=record.trip_name,
        start_date=record.start_date,
        end_date=record.end_date,
        status=record.status or "new",
    )


@router.delete("/{trip_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_trip(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    trip_id = trip.trip_id
    now = datetime.now(timezone.utc)
    trip.is_deleted = True
    trip.deleted_at = now

    # One UPDATE per child table rather than a SELECT + row-by-row mutation
    # (review.md 1C-3). The session is discarded right after the commit, so
    # there is nothing in the identity map worth synchronizing.
    for model in (TravelDetailRecord, StayDetailRecord, TripPointRecord, TripDayRecord):
        await db.execute(
            update(model)
            .where(model.trip_id == trip_id, active(model))
            .values(is_deleted=True, deleted_at=now, updated_at=now)
            .execution_options(synchronize_session=False)
        )

    await db.commit()
