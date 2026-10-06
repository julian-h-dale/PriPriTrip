"""Packing lists: each person's own, per trip (models.PackingItem).

A list is a category. The categories are fixed (CATEGORIES, in the order the
page shows them), and "Start from suggestions" fills an empty list with a few
common things per category, each one deletable.
"""

from __future__ import annotations

import datetime as dt
import uuid

from sqlalchemy import Select, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import PackingItem
from app.schemas import PackingItemUpdate

CATEGORIES = (
    "clothes",
    "toiletries",
    "electronics",
    "documents",
    "health",
    "outdoors",
    "carry_on",
    "other",
)

SUGGESTIONS: dict[str, tuple[str, ...]] = {
    "clothes": ("Tops", "Trousers / shorts", "Underwear", "Socks", "Sleepwear", "Light jacket"),
    "toiletries": ("Toothbrush & toothpaste", "Deodorant", "Shampoo", "Razor", "Sunscreen"),
    "electronics": ("Phone charger", "Plug adapter", "Power bank", "Headphones"),
    "documents": ("Passport", "Credit cards", "Some cash", "Travel insurance details"),
    "health": ("Prescriptions", "Painkillers", "Plasters", "Motion sickness tablets"),
    "outdoors": ("Swimsuit", "Sunglasses", "Hat", "Walking shoes"),
    "carry_on": ("Water bottle (empty)", "Snacks", "Pen for forms", "Eye mask"),
    "other": (),
}


def _live(trip_id: uuid.UUID, user_id: uuid.UUID) -> Select[tuple[PackingItem]]:
    return select(PackingItem).where(
        PackingItem.trip_id == trip_id,
        PackingItem.user_id == user_id,
        PackingItem.is_deleted.is_(False),
    )


async def list_items(db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID) -> list[PackingItem]:
    """The caller's list for the trip, by category (CATEGORIES order), then position."""
    rows = (await db.scalars(_live(trip_id, user_id))).all()
    order = {c: i for i, c in enumerate(CATEGORIES)}
    return sorted(rows, key=lambda r: (order.get(r.category, len(order)), r.position))


async def _next_position(
    db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID, category: str
) -> int:
    last = await db.scalar(
        select(func.max(PackingItem.position)).where(
            PackingItem.trip_id == trip_id,
            PackingItem.user_id == user_id,
            PackingItem.category == category,
            PackingItem.is_deleted.is_(False),
        )
    )
    return 0 if last is None else last + 1


async def add_item(
    db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID, category: str, text: str
) -> PackingItem:
    """Add a line to the end of a list."""
    item = PackingItem(
        trip_id=trip_id,
        user_id=user_id,
        category=category,
        text=text,
        position=await _next_position(db, trip_id, user_id, category),
    )
    db.add(item)
    await db.commit()
    return item


async def update_item(db: AsyncSession, item: PackingItem, body: PackingItemUpdate) -> PackingItem:
    if body.text is not None:
        item.text = body.text
    if body.checked is not None:
        item.checked = body.checked
    if body.category is not None and body.category != item.category:
        item.position = await _next_position(db, item.trip_id, item.user_id, body.category)
        item.category = body.category
    await db.commit()
    return item


async def delete_item(db: AsyncSession, item: PackingItem) -> None:
    item.is_deleted = True
    item.deleted_at = dt.datetime.now(dt.UTC)
    await db.commit()


async def add_suggestions(
    db: AsyncSession, trip_id: uuid.UUID, user_id: uuid.UUID
) -> list[PackingItem]:
    """Fill the caller's list with SUGGESTIONS, only while it's empty (so a
    second tap, or a tap from another phone, never doubles it). Returns the list."""
    if not await list_items(db, trip_id, user_id):
        for category in CATEGORIES:
            for position, text in enumerate(SUGGESTIONS[category]):
                db.add(
                    PackingItem(
                        trip_id=trip_id,
                        user_id=user_id,
                        category=category,
                        text=text,
                        position=position,
                    )
                )
        await db.commit()
    return await list_items(db, trip_id, user_id)
