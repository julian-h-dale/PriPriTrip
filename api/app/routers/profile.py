from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.ext.asyncio import AsyncSession

from app.auth import require_auth
from app.database import get_db
from app.models import UserRecord
from app.schemas import TimezoneLookupRequest, UserProfileLocation, UserProfileResponse, UserProfileUpdate
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

    if body.firstName is not None:
        rec.first_name = body.firstName.strip() or None
    if body.lastName is not None:
        rec.last_name = body.lastName.strip() or None
    if body.phoneNumber is not None:
        rec.phone_number = body.phoneNumber.strip() or None

    if body.homeLocation is not None:
        rec.home_location_name = body.homeLocation.name
        rec.home_location_full_address = body.homeLocation.fullAddress
        rec.home_location_lat = body.homeLocation.lat
        rec.home_location_lng = body.homeLocation.lng
        rec.home_location_google_place_id = body.homeLocation.googlePlaceId
        rec.home_location_google_maps_uri = body.homeLocation.googleMapsUri

    if body.homeTimezoneId is not None:
        rec.home_timezone_id = body.homeTimezoneId
    elif body.homeLocation is not None:
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


@router.post("/timezone", response_model=dict)
async def lookup_timezone(
    body: TimezoneLookupRequest,
    user: UserRecord = Depends(require_auth),
):
    if body.lat is None or body.lng is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Both lat and lng are required.",
        )
    tzid = tzid_from_coords(body.lat, body.lng)
    return {"timezoneId": tzid}
