"""Shared ORM → Pydantic serializers for trip entities."""

from app.models import (
    LocationRecord,
    StayDetailRecord,
    TravelDetailRecord,
    TripPointRecord,
)
from app.schemas import (
    LocationResponse,
    StayDetail,
    TravelDetail,
    TripPointResponse,
)
from app.services.timezones import wall_clock_to_text


def location_to_response(loc: LocationRecord) -> LocationResponse:
    return LocationResponse(
        locationId=loc.location_id,
        pointId=loc.point_id,
        stayDetailId=loc.stay_detail_id,
        travelDetailId=loc.travel_detail_id,
        role=loc.role,
        name=loc.name,
        lat=loc.lat,
        lng=loc.lng,
        fullAddress=loc.full_address,
        description=loc.description,
        link=loc.link,
        googlePlaceId=loc.google_place_id,
        googleMapsUri=loc.google_maps_uri,
        timezoneId=loc.timezone_id,
    )


def _sorted_locs(locations: list) -> list:
    return sorted(locations, key=lambda l: l.sort_order)


def travel_to_response(rec: TravelDetailRecord, locations: list | None = None) -> TravelDetail:
    return TravelDetail(
        travelDetailId=rec.travel_detail_id,
        tripId=rec.trip_id,
        name=rec.name,
        mode=rec.mode,
        operator=rec.operator,
        vehicleNumber=rec.vehicle_number,
        cabinClass=rec.cabin_class,
        departureDateTime=wall_clock_to_text(rec.departure_local) or rec.departure_date_time,
        departureTimezoneId=rec.departure_tzid,
        arrivalDateTime=wall_clock_to_text(rec.arrival_local) or rec.arrival_date_time,
        arrivalTimezoneId=rec.arrival_tzid,
        confirmationNumber=rec.confirmation_number,
        description=rec.description,
        locations=[location_to_response(l) for l in _sorted_locs(locations or [])],
    )


def stay_to_response(rec: StayDetailRecord, locations: list | None = None) -> StayDetail:
    return StayDetail(
        stayDetailId=rec.stay_detail_id,
        tripId=rec.trip_id,
        name=rec.name,
        stayType=rec.stay_type,
        checkIn=wall_clock_to_text(rec.check_in_local) or rec.check_in,
        checkInTimezoneId=rec.check_in_tzid,
        checkOut=wall_clock_to_text(rec.check_out_local) or rec.check_out,
        checkOutTimezoneId=rec.check_out_tzid,
        roomType=rec.room_type,
        confirmationNumber=rec.confirmation_number,
        description=rec.description,
        locations=[location_to_response(l) for l in _sorted_locs(locations or [])],
    )


def point_to_response(
    point: TripPointRecord,
    locations: list,
    travel: TravelDetail | None = None,
    stay: StayDetail | None = None,
) -> TripPointResponse:
    return TripPointResponse(
        pointId=point.point_id,
        tripId=point.trip_id,
        dayId=point.day_id,
        type=point.type,
        title=point.title,
        stayDetailId=point.stay_detail_id,
        travelDetailId=point.travel_detail_id,
        startDateTime=wall_clock_to_text(point.start_local) or point.start_date_time,
        startTimezoneId=point.start_tzid,
        endDateTime=wall_clock_to_text(point.end_local) or point.end_date_time,
        endTimezoneId=point.end_tzid,
        confirmationNumber=point.confirmation_number,
        description=point.description,
        imageUrl=point.image_url,
        logoUrl=point.logo_url,
        locations=[location_to_response(l) for l in _sorted_locs(locations)],
        isSystemCreated=point.is_system_created,
        travelDetail=travel,
        stayDetail=stay,
        completed=point.completed,
        completedDateTime=point.completed_date_time,
        deletedAt=point.deleted_at.isoformat() if point.deleted_at else None,
        createdAt=point.created_at.isoformat() if point.created_at else None,
        updatedAt=point.updated_at.isoformat() if point.updated_at else None,
    )
