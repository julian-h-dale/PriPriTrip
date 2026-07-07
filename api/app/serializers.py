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
        departureDateTime=rec.departure_date_time,
        arrivalDateTime=rec.arrival_date_time,
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
        checkIn=rec.check_in,
        checkOut=rec.check_out,
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
        startDateTime=point.start_date_time,
        endDateTime=point.end_date_time,
        confirmationNumber=point.confirmation_number,
        description=point.description,
        imageUrl=point.image_url,
        logoUrl=point.logo_url,
        locations=[location_to_response(l) for l in _sorted_locs(locations)],
        travelDetail=travel,
        stayDetail=stay,
        completed=point.completed,
        completedDateTime=point.completed_date_time,
        deletedAt=point.deleted_at.isoformat() if point.deleted_at else None,
        createdAt=point.created_at.isoformat() if point.created_at else None,
        updatedAt=point.updated_at.isoformat() if point.updated_at else None,
    )
