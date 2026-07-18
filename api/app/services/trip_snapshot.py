"""Trip snapshots — the "cheap insurance" restore point.

A snapshot is a lossless, point-in-time copy of a whole trip subtree, taken in
the *same transaction* as a destructive/coarse mutation so the mutation can
always be undone. This module owns three things and nothing else:

    snapshot_trip(db, trip, reason, created_by)  -> capture the subtree
    restore_trip(db, trip, snapshot)             -> replace the subtree with a capture
    list_snapshots(db, trip_id)                  -> the restore points, newest first

It does not decide *when* to snapshot — the callers (import replace, the merge
apply endpoint, whole-trip delete, the restore endpoint, the manual button) do.
Nothing here commits; the caller owns the transaction, exactly like trip_write.

Fidelity: the payload is the raw column values (DB view, not the API projection),
including soft-deleted rows and the original ids, so a restore is faithful and
point→stay/travel references survive.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any

from sqlalchemy import delete, inspect, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripDayRecord,
    TripPointRecord,
    TripRecord,
    TripSnapshotRecord,
)

# Bump when the payload shape changes in a way an older restore couldn't read.
SNAPSHOT_SCHEMA_VERSION = 1

# Restore points are insurance, not history. Keep the most recent few per trip
# and prune the rest — a trip's JSON is small, but unbounded growth is a smell.
MAX_SNAPSHOTS_PER_TRIP = 10

# The trip-header columns a restore puts back. Deliberately excludes identity and
# bookkeeping (trip_id, user_id, is_deleted, deleted_at, created_at, updated_at):
# a restore rewrites the itinerary, not who owns the trip or whether it is deleted.
_HEADER_ATTRS = (
    "trip_name",
    "status",
    "start_location_name",
    "destination_location_name",
    "default_timezone_id",
    "start_date",
    "end_date",
)


def _new_id() -> str:
    return str(uuid.uuid4())


def _dump_record(rec: Any) -> dict[str, Any]:
    """Every mapped column of a row as JSON-safe values (datetimes -> ISO text)."""
    out: dict[str, Any] = {}
    for attr in inspect(type(rec)).column_attrs:
        key = attr.key
        val = getattr(rec, key)
        out[key] = val.isoformat() if isinstance(val, (datetime, date)) else val
    return out


def _load_kwargs(model: type[Any], data: dict[str, Any]) -> dict[str, Any]:
    """Coerce a dumped dict back into constructor kwargs for `model`.

    ISO strings become date/datetime again based on each column's Python type;
    everything else passes through untouched.
    """
    columns = inspect(model).columns
    out: dict[str, Any] = {}
    for key, val in data.items():
        if val is None or key not in columns:
            out[key] = val
            continue
        pytype = columns[key].type.python_type
        if isinstance(val, str) and pytype is datetime:
            out[key] = datetime.fromisoformat(val)
        elif isinstance(val, str) and pytype is date:  # datetime is a subclass, checked first
            out[key] = date.fromisoformat(val)
        else:
            out[key] = val
    return out


async def _serialize_trip(db: AsyncSession, trip: TripRecord) -> dict[str, Any]:
    """Capture the trip header and every child row — including soft-deleted ones."""

    async def _all(model, owner_col):
        rows = (await db.execute(select(model).where(owner_col == trip.trip_id))).scalars().all()
        return list(rows)

    days = await _all(TripDayRecord, TripDayRecord.trip_id)
    stays = await _all(StayDetailRecord, StayDetailRecord.trip_id)
    travels = await _all(TravelDetailRecord, TravelDetailRecord.trip_id)
    points = await _all(TripPointRecord, TripPointRecord.trip_id)

    owner_ids = (
        [p.point_id for p in points]
        + [s.stay_detail_id for s in stays]
        + [t.travel_detail_id for t in travels]
    )
    locations: list[LocationRecord] = []
    if owner_ids:
        locations = list(
            (
                await db.execute(
                    select(LocationRecord).where(
                        or_(
                            LocationRecord.point_id.in_(owner_ids),
                            LocationRecord.stay_detail_id.in_(owner_ids),
                            LocationRecord.travel_detail_id.in_(owner_ids),
                        )
                    )
                )
            )
            .scalars()
            .all()
        )

    return {
        "schema_version": SNAPSHOT_SCHEMA_VERSION,
        "trip": _dump_record(trip),
        "days": [_dump_record(d) for d in days],
        "stays": [_dump_record(s) for s in stays],
        "travels": [_dump_record(t) for t in travels],
        "points": [_dump_record(p) for p in points],
        "locations": [_dump_record(loc) for loc in locations],
    }


async def _prune(db: AsyncSession, trip_id: str) -> None:
    """Keep only the newest MAX_SNAPSHOTS_PER_TRIP restore points for a trip."""
    ids = (
        (
            await db.execute(
                select(TripSnapshotRecord.snapshot_id)
                .where(TripSnapshotRecord.trip_id == trip_id)
                .order_by(TripSnapshotRecord.created_at.desc())
                .offset(MAX_SNAPSHOTS_PER_TRIP)
            )
        )
        .scalars()
        .all()
    )
    if ids:
        await db.execute(
            delete(TripSnapshotRecord).where(TripSnapshotRecord.snapshot_id.in_(ids))
        )


async def snapshot_trip(
    db: AsyncSession, trip: TripRecord, *, reason: str, created_by: str
) -> TripSnapshotRecord:
    """Capture the trip subtree as a restore point. Does not commit."""
    rec = TripSnapshotRecord(
        snapshot_id=_new_id(),
        trip_id=trip.trip_id,
        created_by=created_by,
        reason=reason,
        schema_version=SNAPSHOT_SCHEMA_VERSION,
        payload=await _serialize_trip(db, trip),
    )
    db.add(rec)
    await db.flush()
    await _prune(db, trip.trip_id)
    return rec


async def restore_trip(
    db: AsyncSession, trip: TripRecord, snapshot: TripSnapshotRecord
) -> None:
    """Replace the trip's current subtree with the snapshot's. Does not commit.

    This is itself destructive, so the caller is expected to snapshot the *current*
    state first (reason='restore') — which makes an undo undoable.
    """
    payload = snapshot.payload
    trip_id = trip.trip_id

    # Clear the current subtree. Locations CASCADE from points/stays/travels, but
    # we delete them explicitly first so the order is obvious and self-documenting.
    await db.execute(
        delete(LocationRecord).where(
            or_(
                LocationRecord.point_id.in_(
                    select(TripPointRecord.point_id).where(TripPointRecord.trip_id == trip_id)
                ),
                LocationRecord.stay_detail_id.in_(
                    select(StayDetailRecord.stay_detail_id).where(
                        StayDetailRecord.trip_id == trip_id
                    )
                ),
                LocationRecord.travel_detail_id.in_(
                    select(TravelDetailRecord.travel_detail_id).where(
                        TravelDetailRecord.trip_id == trip_id
                    )
                ),
            )
        )
    )
    for model in (TripPointRecord, TripDayRecord, StayDetailRecord, TravelDetailRecord):
        await db.execute(delete(model).where(model.trip_id == trip_id))
    await db.flush()

    # Re-create parents before children so the foreign keys resolve: days, stays
    # and travels first, then points (which reference all three), then locations.
    for row in payload.get("days", []):
        db.add(TripDayRecord(**_load_kwargs(TripDayRecord, row)))
    for row in payload.get("stays", []):
        db.add(StayDetailRecord(**_load_kwargs(StayDetailRecord, row)))
    for row in payload.get("travels", []):
        db.add(TravelDetailRecord(**_load_kwargs(TravelDetailRecord, row)))
    await db.flush()
    for row in payload.get("points", []):
        db.add(TripPointRecord(**_load_kwargs(TripPointRecord, row)))
    await db.flush()
    for row in payload.get("locations", []):
        db.add(LocationRecord(**_load_kwargs(LocationRecord, row)))

    # Put the trip header back (name, status, dates, place names).
    header = _load_kwargs(TripRecord, payload.get("trip", {}))
    for attr in _HEADER_ATTRS:
        if attr in header:
            setattr(trip, attr, header[attr])
    await db.flush()


async def list_snapshots(db: AsyncSession, trip_id: str) -> list[TripSnapshotRecord]:
    """The trip's restore points, newest first (metadata + payload)."""
    rows = (
        await db.execute(
            select(TripSnapshotRecord)
            .where(TripSnapshotRecord.trip_id == trip_id)
            .order_by(TripSnapshotRecord.created_at.desc())
        )
    ).scalars().all()
    return list(rows)
