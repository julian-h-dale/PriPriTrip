"""Photos on journal memories. Upload and delete are the memory's author's
(get_own_memory); serving is by unguessable URL with no login check — an
<img> tag can't send our login header, and the random id is the secret
(the same trade-off as joining a trip by its id)."""

from __future__ import annotations

import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_own_memory
from app.models import Memory, UserRecord
from app.photo_store import PhotoStore, Variant, get_photo_store
from app.schemas import PhotoRead
from app.services import photos as photos_service
from app.users import current_active_user, require_password_ok

router = APIRouter(tags=["journal"])

_MEDIA = {"jpeg": "image/jpeg", "png": "image/png", "webp": "image/webp", "heic": "image/heic"}
# Immutable: a photo's files never change under the same id.
_CACHE = "private, max-age=31536000, immutable"


@router.post(
    "/trips/{trip_id}/memories/{memory_id}/photos",
    response_model=PhotoRead,
    status_code=status.HTTP_201_CREATED,
    dependencies=[Depends(require_password_ok)],
)
async def upload_photo(
    response: Response,
    file: Annotated[UploadFile, File()],
    photo_id: Annotated[uuid.UUID | None, Form(alias="id")] = None,
    memory: Memory = Depends(get_own_memory),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    store: PhotoStore = Depends(get_photo_store),
) -> PhotoRead:
    """Add a photo to your memory (at most 10). Sending the same `id` again —
    a retry from the phone's outbox — returns the stored one (200)."""
    data = await file.read(photos_service.MAX_UPLOAD_BYTES + 1)
    if len(data) > photos_service.MAX_UPLOAD_BYTES:
        raise HTTPException(status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Photos are limited to 25 MB")
    try:
        added = await photos_service.add_photo(db, store, memory, user, data, photo_id)
    except photos_service.InvalidPhoto as exc:
        raise HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, str(exc)) from None
    except photos_service.TooManyPhotos:
        raise HTTPException(status.HTTP_409_CONFLICT, "A memory holds at most 10 photos") from None
    except photos_service.PhotoIdTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That photo id is already taken") from None
    if not added.new:
        response.status_code = status.HTTP_200_OK
    return added.photo


@router.delete(
    "/trips/{trip_id}/memories/{memory_id}/photos/{photo_id}",
    status_code=status.HTTP_204_NO_CONTENT,
    dependencies=[Depends(require_password_ok)],
)
async def delete_photo(
    photo_id: uuid.UUID,
    memory: Memory = Depends(get_own_memory),
    db: AsyncSession = Depends(get_db),
    store: PhotoStore = Depends(get_photo_store),
) -> Response:
    photo = await photos_service.own_photo(db, memory, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    await photos_service.delete_photo(db, store, photo)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/photos/{photo_id}/{variant}", response_class=FileResponse)
async def serve_photo(
    photo_id: uuid.UUID,
    variant: Variant,
    db: AsyncSession = Depends(get_db),
    store: PhotoStore = Depends(get_photo_store),
) -> FileResponse:
    """A photo's thumbnail, display copy or original. No login: the id is the
    secret. Gone with its photo, memory or trip."""
    photo = await photos_service.servable(db, photo_id)
    if photo is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    name = f"original.{photo.original_format}" if variant == "original" else f"{variant}.jpg"
    path = store.path(photo.trip_id, photo.id, name)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    media = _MEDIA[photo.original_format] if variant == "original" else "image/jpeg"
    return FileResponse(path, media_type=media, headers={"Cache-Control": _CACHE})
