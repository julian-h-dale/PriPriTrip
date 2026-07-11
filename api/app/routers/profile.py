from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import UserRecord
from app.schemas import (
    TimezoneLookupRequest,
    TimezoneLookupResponse,
    UserProfileLocation,
    UserProfileResponse,
    UserProfileUpdate,
)
from app.services.timezones import tzid_from_coords

router = APIRouter(prefix="/profile", tags=["profile"])


def _to_profile(user: UserRecord) -> UserProfileResponse:
    return UserProfileResponse(
        email=user.email,
        firstName=user.first_name,
        lastName=user.last_name,
        homeLocation=UserProfileLocation(
            name=user.home_location_name,
            fullAddress=user.home_location_full_address,
            lat=user.home_location_lat,
            lng=user.home_location_lng,
            googlePlaceId=user.home_location_google_place_id,
            googleMapsUri=user.home_location_google_maps_uri,
        ),
        homeTimezoneId=user.home_timezone_id,
        phoneNumber=user.phone_number,
    )


@router.get("", response_model=UserProfileResponse)
async def get_profile(user: UserRecord = Depends(require_auth)):
    return _to_profile(user)


@router.put("", response_model=UserProfileResponse)
async def update_profile(
    body: UserProfileUpdate,
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await db.get(UserRecord, user.id)
    if rec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    if body.first_name is not None:
        rec.first_name = body.first_name.strip() or None
    if body.last_name is not None:
        rec.last_name = body.last_name.strip() or None
    if body.phone_number is not None:
        rec.phone_number = body.phone_number.strip() or None

    if body.home_location is not None:
        rec.home_location_name = body.home_location.name
        rec.home_location_full_address = body.home_location.full_address
        rec.home_location_lat = body.home_location.lat
        rec.home_location_lng = body.home_location.lng
        rec.home_location_google_place_id = body.home_location.google_place_id
        rec.home_location_google_maps_uri = body.home_location.google_maps_uri

    if body.home_timezone_id is not None:
        rec.home_timezone_id = body.home_timezone_id
    elif body.home_location is not None:
        rec.home_timezone_id = tzid_from_coords(rec.home_location_lat, rec.home_location_lng)

    await db.commit()
    await db.refresh(rec)
    return _to_profile(rec)


@router.delete("", status_code=status.HTTP_204_NO_CONTENT)
async def clear_profile(
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(require_auth),
):
    rec = await db.get(UserRecord, user.id)
    if rec is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")

    rec.first_name = None
    rec.last_name = None
    rec.home_location_name = None
    rec.home_location_full_address = None
    rec.home_location_lat = None
    rec.home_location_lng = None
    rec.home_location_google_place_id = None
    rec.home_location_google_maps_uri = None
    rec.home_timezone_id = None
    rec.phone_number = None

    await db.commit()


@router.post("/timezone", response_model=TimezoneLookupResponse)
async def lookup_timezone(
    body: TimezoneLookupRequest,
    user: UserRecord = Depends(require_auth),
):
    return TimezoneLookupResponse(timezoneId=tzid_from_coords(body.lat, body.lng))
