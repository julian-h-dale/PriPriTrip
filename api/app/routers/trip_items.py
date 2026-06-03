from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from app.auth import require_auth
from app.database import get_db
from app.models import TripItemRecord, TripRecord
from app.schemas import (
    TripItemCreate,
    TripItemPatch,
    TripItemResponse,
    TripItemUpdate,
)

router = APIRouter(
    prefix="/trip/items",
    tags=["trip items"],
    dependencies=[Depends(require_auth)],
)


def _get_trip(db: Session) -> TripRecord:
    record = db.query(TripRecord).order_by(TripRecord.updated_at.desc()).first()
    if record is None:
        raise ValueError("No trip found")
    return record


def _item_to_response(r: TripItemRecord) -> TripItemResponse:
    return TripItemResponse(
        itemId=r.item_id,
        tripId=r.trip_id,
        parentItemId=r.parent_item_id,
        kind=r.kind,
        title=r.title,
        startDateTime=r.start_date_time,
        endDateTime=r.end_date_time,
        sortOrder=r.sort_order,
        confirmationNumber=r.confirmation_number,
        type=r.type,
        subtype=r.subtype,
        description=r.description,
        imageUrl=r.image_url,
        logoUrl=r.logo_url,
        locations=r.locations or [],
        completed=r.completed,
        completedDateTime=r.completed_date_time,
        deletedAt=r.deleted_at.isoformat() if r.deleted_at else None,
        createdAt=r.created_at.isoformat() if r.created_at else None,
        updatedAt=r.updated_at.isoformat() if r.updated_at else None,
    )


@router.get("", response_model=list[TripItemResponse])
async def list_items(db: Session = Depends(get_db)):
    try:
        record = _get_trip(db)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No trip found")

    items = (
        db.query(TripItemRecord)
        .filter(TripItemRecord.trip_id == record.trip_id, TripItemRecord.deleted_at.is_(None))
        .order_by(TripItemRecord.sort_order)
        .all()
    )
    return [_item_to_response(i) for i in items]


@router.get("/deleted", response_model=list[TripItemResponse])
async def list_deleted_items(db: Session = Depends(get_db)):
    try:
        record = _get_trip(db)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No trip found")

    items = (
        db.query(TripItemRecord)
        .filter(
            TripItemRecord.trip_id == record.trip_id,
            TripItemRecord.deleted_at.isnot(None),
        )
        .order_by(TripItemRecord.sort_order)
        .all()
    )
    return [_item_to_response(i) for i in items]


@router.post("", response_model=TripItemResponse, status_code=status.HTTP_201_CREATED)
async def create_item(body: TripItemCreate, db: Session = Depends(get_db)):
    try:
        record = _get_trip(db)
    except ValueError:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No trip found")

    if db.get(TripItemRecord, body.itemId) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Item already exists")

    item = TripItemRecord(
        item_id=body.itemId,
        trip_id=record.trip_id,
        parent_item_id=body.parentItemId,
        kind=body.kind,
        title=body.title,
        start_date_time=body.startDateTime,
        end_date_time=body.endDateTime,
        sort_order=body.sortOrder,
        confirmation_number=body.confirmationNumber,
        type=body.type,
        subtype=body.subtype,
        description=body.description,
        image_url=body.imageUrl,
        logo_url=body.logoUrl,
        locations=[loc.model_dump() for loc in body.locations],
        completed=body.completed,
        completed_date_time=body.completedDateTime,
    )
    db.add(item)
    db.commit()
    db.refresh(item)
    return _item_to_response(item)


@router.put("/{item_id}", response_model=TripItemResponse)
async def update_item(item_id: str, body: TripItemUpdate, db: Session = Depends(get_db)):
    item = db.get(TripItemRecord, item_id)
    if item is None or item.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    item.parent_item_id = body.parentItemId
    item.kind = body.kind
    item.title = body.title
    item.start_date_time = body.startDateTime
    item.end_date_time = body.endDateTime
    item.sort_order = body.sortOrder
    item.confirmation_number = body.confirmationNumber
    item.type = body.type
    item.subtype = body.subtype
    item.description = body.description
    item.image_url = body.imageUrl
    item.logo_url = body.logoUrl
    item.locations = [loc.model_dump() for loc in body.locations]
    item.completed = body.completed
    item.completed_date_time = body.completedDateTime
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return _item_to_response(item)


@router.patch("/{item_id}", response_model=TripItemResponse)
async def patch_item(item_id: str, body: TripItemPatch, db: Session = Depends(get_db)):
    item = db.get(TripItemRecord, item_id)
    if item is None or item.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    _field_map = {
        "parentItemId": "parent_item_id",
        "kind": "kind",
        "title": "title",
        "startDateTime": "start_date_time",
        "endDateTime": "end_date_time",
        "sortOrder": "sort_order",
        "confirmationNumber": "confirmation_number",
        "type": "type",
        "subtype": "subtype",
        "description": "description",
        "imageUrl": "image_url",
        "logoUrl": "logo_url",
        "locations": "locations",
        "completed": "completed",
        "completedDateTime": "completed_date_time",
    }
    for pydantic_field, orm_field in _field_map.items():
        if pydantic_field in body.model_fields_set:
            value = getattr(body, pydantic_field)
            if pydantic_field == "locations" and value is not None:
                value = [
                    loc if isinstance(loc, dict) else loc.model_dump() for loc in value
                ]
            setattr(item, orm_field, value)

    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return _item_to_response(item)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_item(item_id: str, db: Session = Depends(get_db)):
    item = db.get(TripItemRecord, item_id)
    if item is None or item.deleted_at is not None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")

    item.deleted_at = datetime.now(timezone.utc)
    item.updated_at = datetime.now(timezone.utc)
    db.commit()


@router.post("/{item_id}/restore", response_model=TripItemResponse)
async def restore_item(item_id: str, db: Session = Depends(get_db)):
    item = db.get(TripItemRecord, item_id)
    if item is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Item not found")
    if item.deleted_at is None:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail="Item is not deleted"
        )

    item.deleted_at = None
    item.updated_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(item)
    return _item_to_response(item)
