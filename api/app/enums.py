from enum import StrEnum


class PointType(StrEnum):
    CHECK_IN = "check-in"
    CHECK_OUT = "check-out"
    DEPARTURE = "departure"
    ARRIVAL = "arrival"
    ACTIVITY = "activity"


class LocationRole(StrEnum):
    ORIGIN = "origin"
    DESTINATION = "destination"
    VENUE = "venue"
    WAYPOINT = "waypoint"


class TravelMode(StrEnum):
    FLIGHT = "flight"
    TRAIN = "train"
    CAR = "car"
    BUS = "bus"
    FERRY = "ferry"
    BOAT = "boat"
    WALK = "walk"
    HIKE = "hike"
    OTHER = "other"


class StayType(StrEnum):
    HOTEL = "hotel"
    HOSTEL = "hostel"
    AIRBNB = "airbnb"
    RENTAL = "rental"
    OTHER = "other"


class AIDocumentType(StrEnum):
    ITINERARY = "itinerary"
    DETAIL = "detail"


class AIDocumentWorkflowMode(StrEnum):
    ITINERARY_IMPORT = "itinerary_import"
    DETAIL_IMPORT = "detail_import"
