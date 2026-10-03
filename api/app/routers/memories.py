"""The trip journal. Anyone on a trip (owner or viewer) reads and adds
memories; only a memory's author edits or deletes it. Thin handlers — logic
in services/memories.py, access in app/dependencies.py."""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import ViewableTrip, get_own_memory, get_viewable_trip
from app.models import Memory, UserRecord
from app.schemas import MemoryCreate, MemoryRead, MemoryUpdate
from app.services import memories as memories_service
from app.users import current_active_user

router = APIRouter(prefix="/trips/{trip_id}/memories", tags=["journal"])


@router.get("", response_model=list[MemoryRead])
async def list_memories(
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> list[MemoryRead]:
    """Everyone's memories on the trip, oldest first (server UTC time)."""
    return await memories_service.list_memories(db, viewable.trip.id, user.id)


@router.post("", response_model=MemoryRead, status_code=status.HTTP_201_CREATED)
async def create_memory(
    body: MemoryCreate,
    viewable: ViewableTrip = Depends(get_viewable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> MemoryRead:
    return await memories_service.create_memory(db, viewable.trip.id, user, body.text, body.zone)


@router.put("/{memory_id}", response_model=MemoryRead)
async def update_memory(
    body: MemoryUpdate,
    memory: Memory = Depends(get_own_memory),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> MemoryRead:
    return await memories_service.update_memory(db, memory, user, body.text)


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory: Memory = Depends(get_own_memory),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await memories_service.delete_memory(db, memory)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
