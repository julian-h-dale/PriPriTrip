"""Name the places of journal memories saved before the server looked them up
(Run stage 26).

Run:  python -m app.backfill_places   (or: make backfill-places)

Best effort and idempotent: a memory with a location and no place name or
area yet gets one Google Places lookup; one that already has either, or a
failed or empty lookup, is left alone (safe to re-run).
"""

from __future__ import annotations

import asyncio

from sqlalchemy import select

from app.database import AsyncSessionLocal
from app.dependencies import active
from app.models import Memory
from app.services.memories import name_place

# A small, polite delay between Google calls.
DELAY_SECONDS = 0.2


async def main() -> None:
    async with AsyncSessionLocal() as db:
        memories = (
            await db.scalars(
                select(Memory).where(
                    active(Memory),
                    Memory.lat.is_not(None),
                    Memory.place_name.is_(None),
                    Memory.place_area.is_(None),
                )
            )
        ).all()
        named = 0
        for memory in memories:
            if await name_place(db, memory):
                named += 1
                print(f"  {memory.id}: {memory.place_name or '-'} / {memory.place_area or '-'}")
            await asyncio.sleep(DELAY_SECONDS)
        print(f"Named {named} of {len(memories)} memories.")


if __name__ == "__main__":
    asyncio.run(main())
