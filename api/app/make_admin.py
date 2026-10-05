"""Make an existing account a superuser — e.g. the Pi's backup account.

Run:  python -m app.make_admin <email>
On Fly: fly ssh console -C "python -m app.make_admin backup@example.com"

Sign the account up in the app first. Safe to run again.
"""

from __future__ import annotations

import asyncio
import sys

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import AsyncSessionLocal
from app.models import UserRecord


async def make_admin(db: AsyncSession, email: str) -> bool:
    """True if the account exists (and is now a superuser)."""
    user = await db.scalar(select(UserRecord).filter_by(email=email.strip().lower()))
    if user is None:
        return False
    user.is_superuser = True
    await db.commit()
    return True


async def _main(email: str) -> int:
    async with AsyncSessionLocal() as db:
        if await make_admin(db, email):
            print(f"{email} is now a superuser")
            return 0
    print(f"No account with the email {email}; sign it up in the app first", file=sys.stderr)
    return 1


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print("Usage: python -m app.make_admin <email>", file=sys.stderr)
        sys.exit(2)
    sys.exit(asyncio.run(_main(sys.argv[1])))
