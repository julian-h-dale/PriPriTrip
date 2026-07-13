from fastapi import Depends

from app.users import current_active_user
from app.models import UserRecord


async def require_auth(user: UserRecord = Depends(current_active_user)) -> UserRecord:
    """
    Dependency used by all trip routers.
    Returns the authenticated UserRecord so routes can scope queries to user.id.
    """
    return user
