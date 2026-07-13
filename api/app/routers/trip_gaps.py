"""Proactive gap-filling: tell the traveller what's missing, and let them fix it.

Two halves that already existed, wired together:

- `trip_gaps.find_gaps` knows which record is missing which field.
- `chat_forms` can build a server-owned form for exactly those fields, and the
  executor can apply it.

So a gap becomes a form becomes a saved record, with **no model call anywhere**
on the path. That is the whole point: the assistant is good at reading a
sentence, but it is a slow and expensive way to type a confirmation number into
a box the app could have put in front of you.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_db
from app.dependencies import get_owned_trip
from app.models import TripRecord
from app.schemas import (
    TripGapResponse,
    TripGapsResponse,
    TripGapSubmitRequest,
)
from app.services.chat_forms import FormError, build_form, validate_submission
from app.services.llm_contract import AssistantAction, AssistantActionFields
from app.services.trip_action_executor import execute_action
from app.services.trip_gaps import BLOCKING, find_gaps
from app.services.trip_state import assembled_trip

router = APIRouter(prefix="/trips/{trip_id}", tags=["gaps"])


async def _current_gaps(db: AsyncSession, trip: TripRecord) -> TripGapsResponse:
    gaps = find_gaps(await assembled_trip(db, trip))

    built: list[TripGapResponse] = []
    for gap in gaps:
        form = await build_form(
            db,
            trip=trip,
            target=gap.target,
            record_id=gap.record_id,
            field_names=gap.fields,
            title=gap.record_label,
        )
        built.append(
            TripGapResponse(
                gapId=str(uuid.uuid4()),
                target=gap.target,
                recordId=gap.record_id,
                recordLabel=gap.record_label,
                severity=gap.severity,
                message=gap.message,
                fields=gap.fields,
                form=form.form,
            )
        )

    return TripGapsResponse(
        tripId=trip.trip_id,
        blockingCount=sum(1 for gap in gaps if gap.severity == BLOCKING),
        totalCount=len(gaps),
        gaps=built,
    )


@router.get("/gaps", response_model=TripGapsResponse)
async def list_trip_gaps(
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    """What's still missing, each with a ready-made form."""
    return await _current_gaps(db, trip)


@router.post("/gaps/submit", response_model=TripGapsResponse)
async def submit_trip_gap(
    body: TripGapSubmitRequest,
    trip: TripRecord = Depends(get_owned_trip),
    db: AsyncSession = Depends(get_db),
):
    """Apply one filled-in gap form and return what's left.

    Returning the remaining gaps rather than just an OK is what makes the banner
    feel like progress: the count goes down as you work through it.
    """
    try:
        # The form came from us, but the submission is a client payload — it is
        # re-checked against the registry rather than trusted.
        values = validate_submission(body.target, body.values)
    except FormError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    if not values:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Nothing to save — fill in at least one field.",
        )

    action = AssistantAction(
        op="update",
        target=body.target,
        id=body.record_id if body.target != "trip" else None,
        fields=AssistantActionFields.model_validate(values),
    )

    result = await execute_action(db, trip=trip, action=action)
    if result.status != "ok":
        await db.rollback()
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=result.detail or "Could not save those values.",
        )

    await db.commit()
    await db.refresh(trip)
    return await _current_gaps(db, trip)
