"""Photos on journal memories: storing, listing, deleting, serving.

Rows say what a photo is and whose; files live in the PhotoStore. Making the
display copy and thumbnail is CPU work, so it runs in a worker thread, one
photo at a time (the production machine has 512 MB). The lock is per process,
so it covers the whole server only because production runs one gunicorn
worker (deploy/start.sh).
"""

from __future__ import annotations

import asyncio
import datetime as dt
import uuid
from collections import defaultdict
from dataclasses import dataclass

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool

from app.dependencies import active
from app.models import Memory, Photo, Trip, UserRecord
from app.photo_store import PhotoStore
from app.photos import InvalidPhoto, process
from app.schemas import PhotoRead

MAX_PHOTOS_PER_MEMORY = 10
MAX_UPLOAD_BYTES = 25 * 1024 * 1024
_processing = asyncio.Semaphore(1)


class TooManyPhotos(Exception):
    pass


class PhotoIdTaken(Exception):
    pass


def read(photo: Photo) -> PhotoRead:
    base = f"/photos/{photo.id}"
    return PhotoRead(
        id=photo.id,
        width=photo.width,
        height=photo.height,
        thumb_url=f"{base}/thumb",
        display_url=f"{base}/display",
        original_url=f"{base}/original",
    )


@dataclass
class Added:
    photo: PhotoRead
    new: bool  # False when this id was already uploaded (a retry)


async def add_photo(
    db: AsyncSession,
    store: PhotoStore,
    memory: Memory,
    author: UserRecord,
    data: bytes,
    photo_id: uuid.UUID | None = None,
) -> Added:
    if photo_id is not None:
        existing = await db.get(Photo, photo_id)
        if existing is not None:
            if existing.memory_id == memory.id and not existing.is_deleted:
                return Added(read(existing), new=False)
            raise PhotoIdTaken()
    count = len(
        (
            await db.scalars(select(Photo.id).where(Photo.memory_id == memory.id, active(Photo)))
        ).all()
    )
    if count >= MAX_PHOTOS_PER_MEMORY:
        raise TooManyPhotos()

    async with _processing:
        processed = await run_in_threadpool(process, data)  # raises InvalidPhoto

    photo = Photo(
        id=photo_id or uuid.uuid4(),
        memory_id=memory.id,
        trip_id=memory.trip_id,
        user_id=author.id,
        original_format=processed.format,
        original_bytes=len(data),
        width=processed.width,
        height=processed.height,
    )
    store.save(memory.trip_id, photo.id, f"original.{processed.format}", data)
    store.save(memory.trip_id, photo.id, "display.jpg", processed.display)
    store.save(memory.trip_id, photo.id, "thumb.jpg", processed.thumb)
    try:
        db.add(photo)
        await db.commit()
    except Exception:
        store.delete(memory.trip_id, photo.id)  # no orphaned files
        raise
    await db.refresh(photo)
    return Added(read(photo), new=True)


async def photos_by_memory(
    db: AsyncSession, memory_ids: list[uuid.UUID]
) -> dict[uuid.UUID, list[PhotoRead]]:
    """Each memory's live photos, in the order they were added."""
    if not memory_ids:
        return {}
    rows = await db.scalars(
        select(Photo)
        .where(Photo.memory_id.in_(memory_ids), active(Photo))
        .order_by(Photo.created_at, Photo.id)
    )
    grouped: dict[uuid.UUID, list[PhotoRead]] = defaultdict(list)
    for photo in rows:
        grouped[photo.memory_id].append(read(photo))
    return grouped


async def own_photo(db: AsyncSession, memory: Memory, photo_id: uuid.UUID) -> Photo | None:
    return await db.scalar(
        select(Photo).where(Photo.id == photo_id, Photo.memory_id == memory.id, active(Photo))
    )


async def delete_photo(db: AsyncSession, store: PhotoStore, photo: Photo) -> None:
    """Soft-delete the row (its URLs stop working) and free the disk space."""
    photo.is_deleted = True
    photo.deleted_at = dt.datetime.now(dt.UTC)
    await db.commit()
    store.delete(photo.trip_id, photo.id)


async def servable(db: AsyncSession, photo_id: uuid.UUID) -> Photo | None:
    """A photo whose memory and trip are still live — else nothing to serve."""
    return await db.scalar(
        select(Photo)
        .join(Memory, Photo.memory_id == Memory.id)
        .join(Trip, Photo.trip_id == Trip.id)
        .where(Photo.id == photo_id, active(Photo), active(Memory), active(Trip))
    )


__all__ = ["MAX_UPLOAD_BYTES", "InvalidPhoto"]
