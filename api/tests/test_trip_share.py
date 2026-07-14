"""Read-only share links (docs/share_links_plan.md).

A share link is a bearer capability handed to someone with no account, so the
interesting tests are not "does it work" but "what exactly does it expose, and
can it be taken back". `/shared/{token}` is the only unauthenticated endpoint in
the app that returns user data; most of this file is about that one route.
"""

from __future__ import annotations

from datetime import UTC, datetime, timedelta

import pytest
from sqlalchemy import select

from app.models import TripShareRecord
from app.services.trip_share import active_share, create_or_get_share
from tests.factories import as_date, make_day, make_point, make_stay, make_travel, make_trip

pytestmark = pytest.mark.asyncio


async def _shared_trip(client, db, user, **trip_kwargs):
    """A trip with real content, and a live share token for it."""
    trip = await make_trip(
        db, user,
        trip_name="Okinawa Trip",
        start_date=as_date("2026-10-30"),
        end_date=as_date("2026-11-05"),
        **trip_kwargs,
    )
    day = await make_day(db, trip, date=as_date("2026-10-30"), title="Arrival")
    await make_point(db, trip, day, type="activity", title="Dinner at Hitoshi")
    await make_stay(db, trip, name="Hyatt Regency Naha", confirmation_number="STAY-123")
    await make_travel(db, trip, name="Flight to Naha", confirmation_number="FLY-456")
    await db.commit()

    resp = await client.post(f"/trips/{trip.trip_id}/share")
    assert resp.status_code == 200
    return trip, resp.json()


class TestMintingTheLink:
    async def test_creating_a_share_returns_a_copyable_url(self, client, db, user):
        _trip, share = await _shared_trip(client, db, user)

        assert share["token"]
        assert len(share["token"]) >= 40  # 32 bytes of entropy, url-safe
        assert share["url"].endswith(f"/shared/{share['token']}")
        assert share["viewCount"] == 0

    async def test_sharing_twice_returns_the_same_link(self, client, db, user):
        """Tapping share again must not invalidate the URL already sent to someone."""
        trip, first = await _shared_trip(client, db, user)

        second = (await client.post(f"/trips/{trip.trip_id}/share")).json()

        assert second["token"] == first["token"]
        assert second["shareId"] == first["shareId"]

    async def test_the_database_refuses_two_live_links_for_one_trip(self, db, user):
        trip = await make_trip(db, user)
        await create_or_get_share(db, trip=trip)
        await create_or_get_share(db, trip=trip)
        await db.flush()

        live = (await db.execute(
            select(TripShareRecord).where(
                TripShareRecord.trip_id == trip.trip_id,
                TripShareRecord.revoked_at.is_(None),
            )
        )).scalars().all()
        assert len(live) == 1

    async def test_an_unshared_trip_has_no_link(self, client, db, user):
        trip = await make_trip(db, user)
        await db.commit()

        resp = await client.get(f"/trips/{trip.trip_id}/share")

        assert resp.status_code == 404


class TestReadingTheSharedTrip:
    async def test_anyone_holding_the_link_can_read_it_with_no_account(
        self, client, anon_client, db, user
    ):
        """The whole point: no token, no session, no account."""
        _trip, share = await _shared_trip(client, db, user)

        resp = await anon_client.get(f"/shared/{share['token']}")

        assert resp.status_code == 200
        body = resp.json()
        assert body["tripName"] == "Okinawa Trip"
        assert [d["title"] for d in body["days"]] == ["Arrival"]
        assert body["days"][0]["points"][0]["title"] == "Dinner at Hitoshi"
        assert body["stays"][0]["name"] == "Hyatt Regency Naha"
        assert body["travels"][0]["name"] == "Flight to Naha"

    async def test_the_companion_gets_the_confirmation_numbers(self, client, anon_client, db, user):
        """A deliberate decision, not an oversight — see the plan doc.

        An itinerary that hides the hotel confirmation from the person you are
        travelling with is not an itinerary. The mitigation for a leaked link is
        revocation, not redaction.
        """
        _trip, share = await _shared_trip(client, db, user)

        body = (await anon_client.get(f"/shared/{share['token']}")).json()

        assert body["stays"][0]["confirmationNumber"] == "STAY-123"
        assert body["travels"][0]["confirmationNumber"] == "FLY-456"

    async def test_it_leaks_nothing_about_the_owner(self, client, anon_client, db, user):
        """SharedTripResponse is its own schema so this cannot drift open."""
        _trip, share = await _shared_trip(client, db, user)

        body = (await anon_client.get(f"/shared/{share['token']}")).json()

        assert "userId" not in body
        assert "tripId" not in body  # not needed to render, and not theirs to have
        assert "status" not in body
        blob = str(body).lower()
        assert str(user.id) not in blob
        assert user.email.lower() not in blob

    async def test_viewing_is_counted_so_the_owner_can_see_it_landed(
        self, client, anon_client, db, user
    ):
        trip, share = await _shared_trip(client, db, user)

        await anon_client.get(f"/shared/{share['token']}")
        await anon_client.get(f"/shared/{share['token']}")

        owner_view = (await client.get(f"/trips/{trip.trip_id}/share")).json()
        assert owner_view["viewCount"] == 2
        assert owner_view["lastViewedAt"] is not None


class TestTakingItBack:
    async def test_a_revoked_link_stops_working_immediately(self, client, anon_client, db, user):
        trip, share = await _shared_trip(client, db, user)
        assert (await anon_client.get(f"/shared/{share['token']}")).status_code == 200

        assert (await client.delete(f"/trips/{trip.trip_id}/share")).status_code == 204

        assert (await anon_client.get(f"/shared/{share['token']}")).status_code == 404
        assert (await client.get(f"/trips/{trip.trip_id}/share")).status_code == 404

    async def test_regenerating_gives_a_new_token_and_kills_the_old_one(
        self, client, anon_client, db, user
    ):
        trip, old = await _shared_trip(client, db, user)

        await client.delete(f"/trips/{trip.trip_id}/share")
        new = (await client.post(f"/trips/{trip.trip_id}/share")).json()

        assert new["token"] != old["token"]
        assert (await anon_client.get(f"/shared/{old['token']}")).status_code == 404
        assert (await anon_client.get(f"/shared/{new['token']}")).status_code == 200

    async def test_an_expired_link_is_dead_even_though_it_was_never_revoked(
        self, anon_client, db, user
    ):
        trip = await make_trip(db, user)
        share = await create_or_get_share(db, trip=trip)
        share.expires_at = datetime.now(UTC) - timedelta(seconds=1)
        await db.commit()

        assert (await anon_client.get(f"/shared/{share.token}")).status_code == 404
        # And the owner's own view agrees, rather than showing a dead link.
        assert await active_share(db, trip_id=trip.trip_id) is None

    async def test_deleting_the_trip_kills_the_link(self, client, anon_client, db, user):
        trip, share = await _shared_trip(client, db, user)

        await client.delete(f"/trips/{trip.trip_id}")

        assert (await anon_client.get(f"/shared/{share['token']}")).status_code == 404


class TestTheDoorIsShut:
    async def test_an_unknown_token_is_404_and_says_nothing(self, anon_client):
        resp = await anon_client.get("/shared/definitely-not-a-real-token")

        assert resp.status_code == 404
        # Unknown, revoked and expired must be indistinguishable — a 403 would
        # confirm the token had once existed.
        assert resp.json()["detail"] == "This link is no longer active."

    async def test_a_revoked_token_gives_the_identical_404(self, client, anon_client, db, user):
        trip, share = await _shared_trip(client, db, user)
        await client.delete(f"/trips/{trip.trip_id}/share")

        revoked = await anon_client.get(f"/shared/{share['token']}")
        unknown = await anon_client.get("/shared/definitely-not-a-real-token")

        assert revoked.status_code == unknown.status_code == 404
        assert revoked.json() == unknown.json()

    async def test_another_user_cannot_share_your_trip(self, client, db, other_user):
        trip = await make_trip(db, other_user)
        await db.commit()

        assert (await client.post(f"/trips/{trip.trip_id}/share")).status_code == 404
        assert (await client.get(f"/trips/{trip.trip_id}/share")).status_code == 404
        assert (await client.delete(f"/trips/{trip.trip_id}/share")).status_code == 404

    async def test_the_share_link_is_read_only(self, anon_client, client, db, user):
        """Holding a link grants no write anywhere — it is a window, not a door.

        Each request below is well-formed, so a 422 cannot stand in for a
        rejection: what stops these is authentication, which is the thing worth
        proving.
        """
        trip, _share = await _shared_trip(client, db, user)

        deletion = await anon_client.delete(f"/trips/{trip.trip_id}")
        assert deletion.status_code == 401

        rename = await anon_client.put(
            f"/trips/{trip.trip_id}",
            json={
                "tripId": trip.trip_id,
                "tripName": "Hijacked",
                "startDate": "2026-10-30",
                "endDate": "2026-11-05",
            },
        )
        assert rename.status_code == 401

        # And the trip is untouched.
        await db.refresh(trip)
        assert trip.trip_name == "Okinawa Trip"
        assert not trip.is_deleted
