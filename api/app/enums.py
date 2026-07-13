from enum import StrEnum


class TripStatus(StrEnum):
    """Where a trip is in its life.

    `new` and `draft` are both "still being planned" — the UI treats them
    identically and sends both to the timeline. The distinction only matters to
    the itinerary-upload lock: a trip that already has content (`draft`) must not
    have a whole second itinerary imported over the top of it.

    `active` means you are ON the trip, and it is the only status the UI treats
    specially (docs/active_trip_plan.md) — everything else falls through to the
    timeline, so a status added later can never strand the user on a blank page.
    """

    NEW = "new"
    DRAFT = "draft"
    ACTIVE = "active"


# Statuses from which a document import may promote a trip to `draft`. An active
# trip is NOT one of them: uploading a booking confirmation while you are on the
# trip must not knock it out of `active` and make the What's Next screen vanish.
PROMOTABLE_TO_DRAFT = frozenset({TripStatus.NEW})


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
