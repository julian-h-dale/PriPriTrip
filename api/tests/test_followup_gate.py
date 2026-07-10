from types import SimpleNamespace

from app.services.trip_action_executor import should_suppress_follow_up


def _trip(**kwargs):
    defaults = {
        "destination_location_name": None,
        "start_date": None,
        "end_date": None,
    }
    defaults.update(kwargs)
    return SimpleNamespace(**defaults)


def test_suppresses_when_destination_already_known():
    trip = _trip(destination_location_name="Okinawa")
    assert should_suppress_follow_up(
        follow_up_question="Where are you going?",
        trip=trip,
        latest_message="I'm flying into Naha airport",
        recent_assistant_questions=[],
    )


def test_suppresses_repeated_question():
    trip = _trip()
    question = "What date are you returning?"
    assert should_suppress_follow_up(
        follow_up_question=question,
        trip=trip,
        latest_message="Also we might book a hotel soon",
        recent_assistant_questions=[question],
    )


def test_keeps_new_question_when_not_known():
    trip = _trip()
    assert not should_suppress_follow_up(
        follow_up_question="What date are you returning?",
        trip=trip,
        latest_message="We're still deciding",
        recent_assistant_questions=[],
    )
