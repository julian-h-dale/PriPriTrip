from enum import StrEnum


class PointType(StrEnum):
    CHECK_IN = "check-in"
    CHECK_OUT = "check-out"
    DEPARTURE = "departure"
    ARRIVAL = "arrival"
    ACTIVITY = "activity"


# These four are *projections* of a stay or a travel leg, not things in their
# own right: a check-in point is the stay's check_in time, and a departure point
# is the travel leg's departure. detail_points.py materializes them and keeps
# them in step with their parent, and it is the only writer allowed to do so.
#
# Nothing else may create one — not the model, not the importer, not the UI.
# When two writers both created them we got exactly what you would expect: a
# "Departure: Flight from ORD" carrying the travel link and a "Depart ORD"
# carrying the airport, side by side on the timeline, neither one complete.
DERIVED_POINT_TYPES = frozenset(
    {PointType.CHECK_IN, PointType.CHECK_OUT, PointType.DEPARTURE, PointType.ARRIVAL}
)

# The only kind anyone else may create: a thing you chose to do.
AUTHORED_POINT_TYPES = frozenset({PointType.ACTIVITY})


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
