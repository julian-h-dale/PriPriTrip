"""The trip journal. The owner and editors read every memory and add their
own; viewers read only public ones and add none. Only a memory's author
edits or deletes it. Thin handlers — logic
in services/memories.py, access in app/dependencies.py."""

from __future__ import annotations

from fastapi import APIRouter, BackgroundTasks, Depends, HTTPException, Response, status
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker

from app.database import get_db, get_session_factory
from app.dependencies import ViewableTrip, get_journal_trip, get_own_memory, get_viewable_trip
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
    """The trip's memories the caller may see, oldest first (server UTC time):
    all of them for the owner and editors, public ones for viewers."""
    return await memories_service.list_memories(db, viewable.trip.id, user.id, viewable.role)


@router.post("", response_model=MemoryRead, status_code=status.HTTP_201_CREATED)
async def create_memory(
    body: MemoryCreate,
    response: Response,
    background: BackgroundTasks,
    viewable: ViewableTrip = Depends(get_journal_trip),
    db: AsyncSession = Depends(get_db),
    sessions: async_sessionmaker[AsyncSession] = Depends(get_session_factory),
    user: UserRecord = Depends(current_active_user),
) -> MemoryRead:
    """Save a memory (201). Sending the same `id` again — a retry from the
    phone's outbox — returns the saved one (200) instead of a duplicate.
    With a location, what's there is looked up after the answer has gone
    (the place name shows on the next read)."""
    try:
        created = await memories_service.create_memory(
            db,
            viewable.trip.id,
            user,
            body.text,
            body.zone,
            memory_id=body.id,
            created_at=body.created_at,
            location=body.location,
            is_public=body.is_public,
        )
    except memories_service.MemoryIdTaken:
        raise HTTPException(status.HTTP_409_CONFLICT, "That memory id is already taken") from None
    if not created.new:
        response.status_code = status.HTTP_200_OK
    elif created.memory.location is not None:
        background.add_task(memories_service.name_place_later, sessions, created.memory.id)
    return created.memory


@router.put("/{memory_id}", response_model=MemoryRead)
async def update_memory(
    body: MemoryUpdate,
    memory: Memory = Depends(get_own_memory),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> MemoryRead:
    # `location: null` removes it; leaving the field out keeps it. A new
    # location can't be set on an edit (it's where the memory was written).
    clear = "location" in body.model_fields_set and body.location is None
    return await memories_service.update_memory(
        db, memory, user, body.text, clear_location=clear, is_public=body.is_public
    )


@router.delete("/{memory_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_memory(
    memory: Memory = Depends(get_own_memory),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await memories_service.delete_memory(db, memory)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
