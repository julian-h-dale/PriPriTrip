"""Things feature router — example vertical slice.

Thin, async handlers. Ownership is enforced by the get_owned_thing
dependency; business logic lives in services/things.py.
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, Response, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_thing
from app.models import Thing, UserRecord
from app.schemas import ThingCreate, ThingRead, ThingUpdate
from app.services import things as things_service
from app.users import current_active_user

router = APIRouter(prefix="/things", tags=["things"])


@router.get("/", response_model=list[ThingRead])
async def list_things(
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> list[Thing]:
    return await things_service.list_things(db, user.id)


@router.post("/", response_model=ThingRead, status_code=status.HTTP_201_CREATED)
async def create_thing(
    data: ThingCreate,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
) -> Thing:
    return await things_service.create_thing(db, user.id, data)


@router.patch("/{thing_id}", response_model=ThingRead)
async def update_thing(
    data: ThingUpdate,
    thing: Thing = Depends(get_owned_thing),
    db: AsyncSession = Depends(get_db),
) -> Thing:
    return await things_service.update_thing(db, thing, data)


@router.delete("/{thing_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_thing(
    thing: Thing = Depends(get_owned_thing),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await things_service.soft_delete_thing(db, thing)
    return Response(status_code=status.HTTP_204_NO_CONTENT)
