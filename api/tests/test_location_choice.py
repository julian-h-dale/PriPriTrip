"""Location confidence and the `choice` uiPayload (review.md 3F-5).

The rule that decides whether we may pick a place for the user, or must ask,
is `location_resolver.classify`. These pin it to the cases in the requirements
doc (Requirement 9 — Location Tests).
"""

import json
import uuid

import pytest

from app.models import LocationRecord
from app.services import location_resolver
from app.services.chat_choices import ChoiceError, apply_choice, build_choice
from app.services.chat_tools import TOOL_REGISTRY
from app.services.llm_contract import AssistantAction, LocationDecision
from app.services.location_resolver import _bias_query, classify, similarity
from app.services.trip_action_executor import execute_action
from tests.factories import make_stay, make_trip


def _candidates(*names):
    return [
        {
            "name": name,
            "fullAddress": f"{name}, Japan",
            "googlePlaceId": f"place-{i}",
            "googleMapsUri": f"https://maps.google.com/?cid={i}",
            "lat": 26.2 + i,
            "lng": 127.6 + i,
        }
        for i, name in enumerate(names)
    ]


class TestConfidenceRule:
    """What "a clear winner" means, exactly."""

    def test_an_exact_name_is_high(self):
        # requirements doc — Location Test 1
        result = classify("Naha airport", _candidates("Naha Airport", "Naha Bus Terminal"))

        assert result.confidence == "high"
        assert result.chosen["name"] == "Naha Airport"

    def test_punctuation_and_filler_words_are_not_signal(self):
        result = classify("Ritz Carlton Kyoto", _candidates("The Ritz-Carlton, Kyoto", "Kyoto Hotel Okura"))

        assert result.confidence == "high"
        assert result.chosen["name"] == "The Ritz-Carlton, Kyoto"

    def test_a_vague_brand_name_is_medium(self):
        # requirements doc — Location Test 3: "the Hyatt" is not enough to pick one.
        result = classify("the Hyatt", _candidates("Hyatt Regency Naha", "Hyatt Centric Ginza", "Hyatt House Osaka"))

        assert result.confidence == "medium"
        assert result.chosen is None  # nothing was applied
        assert len(result.candidates) == 3

    def test_several_similar_places_are_medium(self):
        # requirements doc — Location Test 2
        result = classify(
            "Springfield airport",
            _candidates("Springfield-Branson National Airport", "Springfield Regional Airport"),
        )

        assert result.confidence == "medium"

    def test_a_single_candidate_is_high_even_if_the_name_differs(self):
        """Nothing to disambiguate between."""
        result = classify("that soba place", _candidates("Giaxa"))

        assert result.confidence == "high"
        assert result.chosen["name"] == "Giaxa"

    def test_nothing_found_is_low(self):
        result = classify("nowhere at all", [])

        assert result.confidence == "low"
        assert result.chosen is None

    def test_the_thresholds_are_what_separate_high_from_medium(self):
        """A close runner-up blocks a win even when the top scores well."""
        top_only = classify("Hyatt Regency Naha", _candidates("Hyatt Regency Naha", "Family Mart"))
        crowded = classify("Hyatt Regency Naha", _candidates("Hyatt Regency Naha", "Hyatt Regency Naha Ohana"))

        assert top_only.confidence == "high"
        assert similarity("Hyatt Regency Naha", "Hyatt Regency Naha") == 1.0
        # The runner-up is too close to call, so we ask instead of guessing.
        assert crowded.confidence == "medium"


class TestDestinationBias:
    def test_the_trip_destination_is_added_when_the_user_did_not_say_where(self):
        assert _bias_query("the Hyatt", "Okinawa") == "the Hyatt Okinawa"

    def test_it_is_not_added_when_they_already_said_where(self):
        assert _bias_query("Hyatt Regency Naha, Okinawa", "Okinawa") == "Hyatt Regency Naha, Okinawa"

    def test_no_destination_means_no_bias(self):
        assert _bias_query("the Hyatt", None) == "the Hyatt"


class TestExecutorDoesNotGuess:
    """The old behaviour — silently taking candidate #1 — is gone."""

    async def test_an_ambiguous_place_is_not_applied(self, db, user, monkeypatch):
        trip = await make_trip(db, user, destination_location_name="Okinawa")

        async def _ambiguous(query, **_kwargs):
            return _candidates("Hyatt Regency Naha", "Hyatt Centric Ginza", "Hyatt House Osaka")

        monkeypatch.setattr(location_resolver, "resolve_location_candidates", _ambiguous)

        result = await execute_action(
            db,
            trip=trip,
            action=AssistantAction(
                op="create", target="stay",
                fields={"name": "Hyatt", "stayType": "hotel",
                        "locations": [{"role": "venue", "name": "the Hyatt"}]},
            ),
        )

        assert result.status == "ok"
        decision = result.locations[0]
        assert decision.confidence == "medium"
        assert len(decision.candidates) == 3

        # The row was written with the raw name and NO place metadata.
        location = await db.get(LocationRecord, decision.location_id)
        assert location.name == "the Hyatt"
        assert location.google_place_id is None
        assert location.lat is None

    async def test_a_clear_match_is_applied_and_reported(self, db, user, monkeypatch):
        trip = await make_trip(db, user, destination_location_name="Okinawa")

        async def _clear(query, **_kwargs):
            return _candidates("Naha Airport", "Naha Bus Terminal")

        monkeypatch.setattr(location_resolver, "resolve_location_candidates", _clear)

        result = await execute_action(
            db,
            trip=trip,
            action=AssistantAction(
                op="create", target="travel",
                fields={"name": "Flight", "mode": "flight",
                        "locations": [{"role": "destination", "name": "Naha airport"}]},
            ),
        )

        decision = result.locations[0]
        assert decision.confidence == "high"
        assert decision.resolved_name == "Naha Airport"

        location = await db.get(LocationRecord, decision.location_id)
        assert location.google_place_id == "place-0"  # applied
        assert location.lat is not None

    async def test_the_model_is_told_what_was_assumed(self, db, user, monkeypatch):
        """A high-confidence guess is no longer silent."""
        trip = await make_trip(db, user, destination_location_name="Okinawa")

        async def _clear(query, **_kwargs):
            return _candidates("Naha Airport (OKA)")  # single, clear match

        monkeypatch.setattr(location_resolver, "resolve_location_candidates", _clear)

        spec = TOOL_REGISTRY["create_travel"]
        args = spec.args_model.model_validate(
            {"name": "Flight", "mode": "flight",
             "locations": [{"role": "destination", "name": "the airport"}]}
        )
        outcome = await spec.handler(db, trip, args)

        assert "took 'the airport' to mean 'Naha Airport (OKA)'" in outcome.result["locationNote"]
        assert outcome.choice is None
        # The model does not get the candidate machinery back.
        assert "locations" not in outcome.result

    async def test_a_cosmetic_difference_is_not_announced_as_an_assumption(
        self, db, user, monkeypatch
    ):
        """"Naha airport" -> "Naha Airport" is not an assumption worth stating."""
        trip = await make_trip(db, user, destination_location_name="Okinawa")

        async def _clear(query, **_kwargs):
            return _candidates("Naha Airport", "Naha Bus Terminal")

        monkeypatch.setattr(location_resolver, "resolve_location_candidates", _clear)

        spec = TOOL_REGISTRY["create_travel"]
        args = spec.args_model.model_validate(
            {"name": "Flight", "mode": "flight",
             "locations": [{"role": "destination", "name": "Naha airport"}]}
        )
        outcome = await spec.handler(db, trip, args)

        assert "locationNote" not in outcome.result

    async def test_an_ambiguous_place_produces_a_choice_for_the_user(self, db, user, monkeypatch):
        trip = await make_trip(db, user, destination_location_name="Okinawa")

        async def _ambiguous(query, **_kwargs):
            return _candidates("Hyatt Regency Naha", "Hyatt Centric Ginza")

        monkeypatch.setattr(location_resolver, "resolve_location_candidates", _ambiguous)

        spec = TOOL_REGISTRY["create_stay"]
        args = spec.args_model.model_validate(
            {"name": "Hyatt", "stayType": "hotel",
             "locations": [{"role": "venue", "name": "the Hyatt"}]}
        )
        outcome = await spec.handler(db, trip, args)

        assert outcome.choice is not None
        assert [o.label for o in outcome.choice.options] == ["Hyatt Regency Naha", "Hyatt Centric Ginza"]
        # ...and the model is told not to ask the same question in prose.
        assert "Do not ask them which one" in outcome.result["locationNote"]


class TestApplyChoice:
    async def _setup_choice(self, db, user, monkeypatch):
        trip = await make_trip(db, user, destination_location_name="Okinawa")
        stay = await make_stay(db, trip)
        location = LocationRecord(
            location_id=str(uuid.uuid4()),
            stay_detail_id=stay.stay_detail_id,
            role="venue",
            name="the Hyatt",
            sort_order=0,
        )
        db.add(location)
        await db.commit()

        decision = LocationDecision(
            location_id=location.location_id,
            query="the Hyatt",
            confidence="medium",
            candidates=_candidates("Hyatt Regency Naha", "Hyatt Centric Ginza"),
        )
        choice = build_choice(decision).model_dump(mode="json", by_alias=True)

        async def _details(place_id):
            return {
                "name": "Hyatt Regency Naha",
                "fullAddress": "3-6-20 Makishi, Naha, Okinawa",
                "googlePlaceId": place_id,
                "googleMapsUri": "https://maps.google.com/?cid=0",
                "lat": 26.2154,
                "lng": 127.6896,
            }

        monkeypatch.setattr("app.services.chat_choices.place_details", _details)
        return trip, location, choice

    async def test_the_picked_place_is_written_to_the_location(self, db, user, monkeypatch):
        trip, _location, choice = await self._setup_choice(db, user, monkeypatch)

        updated = await apply_choice(db, trip=trip, choice=choice, option_id="place-0")

        assert updated.name == "Hyatt Regency Naha"
        assert updated.google_place_id == "place-0"
        assert updated.lat == pytest.approx(26.2154)
        assert updated.full_address.startswith("3-6-20 Makishi")

    async def test_an_option_we_never_offered_is_rejected(self, db, user, monkeypatch):
        """An `optionId` is checked against the card we actually issued."""
        trip, _location, choice = await self._setup_choice(db, user, monkeypatch)

        with pytest.raises(ChoiceError):
            await apply_choice(db, trip=trip, choice=choice, option_id="place-i-made-up")

    async def test_a_location_on_another_trip_is_rejected(self, db, user, monkeypatch):
        _trip, _location, choice = await self._setup_choice(db, user, monkeypatch)
        other_trip = await make_trip(db, user, trip_name="Someone else's")

        with pytest.raises(ChoiceError):
            await apply_choice(db, trip=other_trip, choice=choice, option_id="place-0")

    async def test_a_place_the_user_searched_for_is_accepted(self, db, user, monkeypatch):
        """None of our options was their brother's house, so they found it.

        A searched place is deliberately NOT checked against the offered
        options — there would be nothing to check it against, and refusing it is
        the bug. What still has to hold is trip ownership, below.
        """
        trip, _location, choice = await self._setup_choice(db, user, monkeypatch)

        updated = await apply_choice(db, trip=trip, choice=choice, place_id="place-brothers-house")

        assert updated.google_place_id == "place-brothers-house"
        assert updated.lat is not None  # real coordinates, so it maps

    async def test_a_searched_place_still_cannot_reach_another_trip(self, db, user, monkeypatch):
        _trip, _location, choice = await self._setup_choice(db, user, monkeypatch)
        other_trip = await make_trip(db, user, trip_name="Someone else's")

        with pytest.raises(ChoiceError):
            await apply_choice(db, trip=other_trip, choice=choice, place_id="place-brothers-house")

    async def test_submitting_neither_is_rejected(self, db, user, monkeypatch):
        trip, _location, choice = await self._setup_choice(db, user, monkeypatch)

        with pytest.raises(ChoiceError):
            await apply_choice(db, trip=trip, choice=choice)


class TestChoiceEndpoint:
    async def test_submitting_a_choice_applies_it_without_a_model_call(
        self, client, db, user, monkeypatch
    ):
        from app.models import ChatMessageRecord

        trip = await make_trip(db, user, destination_location_name="Okinawa")
        stay = await make_stay(db, trip)
        location = LocationRecord(
            location_id=str(uuid.uuid4()),
            stay_detail_id=stay.stay_detail_id,
            role="venue",
            name="the Hyatt",
            sort_order=0,
        )
        db.add(location)

        choice = build_choice(
            LocationDecision(
                location_id=location.location_id,
                query="the Hyatt",
                confidence="medium",
                candidates=_candidates("Hyatt Regency Naha", "Hyatt Centric Ginza"),
            )
        )
        # The choice is stored on the bot message, exactly as the loop does.
        db.add(
            ChatMessageRecord(
                message_id=str(uuid.uuid4()),
                user_id=str(user.id),
                trip_id=trip.trip_id,
                workflow_name="trip:manage",
                message="Which Hyatt did you mean?",
                is_bot=True,
                structure_content=json.dumps(
                    {
                        "uiPayload": {
                            "kind": "choice",
                            "choice": choice.model_dump(mode="json", by_alias=True),
                        }
                    }
                ),
            )
        )
        await db.commit()

        async def _details(place_id):
            return {
                "name": "Hyatt Regency Naha",
                "fullAddress": "3-6-20 Makishi, Naha, Okinawa",
                "googlePlaceId": place_id,
                "googleMapsUri": "https://maps.google.com/",
                "lat": 26.2154,
                "lng": 127.6896,
            }

        monkeypatch.setattr("app.services.chat_choices.place_details", _details)

        resp = await client.post(
            "/chat/choices/submit",
            json={
                "tripId": trip.trip_id,
                "workflowName": "trip:manage",
                "requestId": str(uuid.uuid4()),
                "choiceId": choice.choice_id,
                "optionId": "place-0",
            },
        )

        assert resp.status_code == 200
        assert [m["isBot"] for m in resp.json()["messages"]] == [False, True]
        await db.refresh(location)
        assert location.google_place_id == "place-0"
        assert location.name == "Hyatt Regency Naha"

    async def test_an_unknown_choice_is_404(self, client, db, user):
        trip = await make_trip(db, user)

        resp = await client.post(
            "/chat/choices/submit",
            json={
                "tripId": trip.trip_id,
                "workflowName": "trip:manage",
                "requestId": str(uuid.uuid4()),
                "choiceId": str(uuid.uuid4()),
                "optionId": "place-0",
            },
        )

        assert resp.status_code == 404
