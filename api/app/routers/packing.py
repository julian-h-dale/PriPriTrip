"""Packing lists. Everyone on a trip, viewers included, keeps their own;
nobody sees anyone else's (someone else's line is 404). Thin handlers —
logic in services/packing.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import ViewableTrip, get_own_packing_item, get_viewable_trip
from app.models import PackingItem, UserRecord
from app.schemas import PackingCategory, PackingItemCreate, PackingItemRead, PackingItemUpdate
from app.services import packing as packing_service
from app.users import current_active_user

router = APIRouter(prefix="/trips/{trip_id}/packing", tags=["packing"])


@router.get("", response_model=list[PackingItemRead])
async def list_packing(
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> list[PackingItem]:
    """Your packing list for this trip, list by list."""
    return await packing_service.list_items(db, viewable.trip.id, user.id)


@router.post("", response_model=PackingItemRead, status_code=status.HTTP_201_CREATED)
async def add_packing_item(
    body: PackingItemCreate,
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> PackingItem:
    return await packing_service.add_item(
        db, viewable.trip.id, user.id, body.category, body.text, body.quantity
    )


@router.post("/suggestions", response_model=list[PackingItemRead])
async def add_packing_suggestions(
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> list[PackingItem]:
    """Fill an empty list with common things to pack. A list that already has
    lines is left as it is. Returns the whole list."""
    return await packing_service.add_suggestions(db, viewable.trip.id, user.id)


@router.delete("/lists/{category}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_packing_list(
    category: PackingCategory,
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Response:
    """Delete one of your lists: every line on it. (Only yours.)"""
    await packing_service.delete_list(db, viewable.trip.id, user.id, category)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.patch("/{item_id}", response_model=PackingItemRead)
async def update_packing_item(
    body: PackingItemUpdate,
    item: PackingItem = Depends(get_own_packing_item),
    db: AsyncSession = Depends(get_db),
) -> PackingItem:
    return await packing_service.update_item(db, item, body)


@router.delete("/{item_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_packing_item(
    item: PackingItem = Depends(get_own_packing_item),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await packing_service.delete_item(db, item)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
