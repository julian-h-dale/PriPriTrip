from enum import StrEnum


class PointType(StrEnum):
    TRAVEL = "travel"
    STAY = "stay"
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
