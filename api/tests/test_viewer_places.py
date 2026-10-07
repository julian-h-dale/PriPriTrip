"""A viewer's map (Run stage 17): only activities and public memories. Their
trip read has no points of interest, and stays and legs keep only their
places' names and cities; the owner's and an editor's read keep everything.
Done on the server, so a viewer's phone never gets the rest."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

from tests.test_points_of_interest import MARKET
from tests.test_sharing import edited_trip, shared_trip

Json = dict[str, Any]
HIDDEN = {"address", "lat", "lng", "url", "placeId", "imgRef"}


def places_of(trip: Json) -> list[Json]:
    return [s["location"] for s in trip["stays"] if s.get("location")] + [
        loc for t in trip["travels"] for loc in (t.get("from"), t.get("to")) if loc
    ]


async def test_a_viewer_gets_no_points_of_interest_and_no_stay_or_leg_places(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    await client.post(f"/trips/{tid}/points-of-interest", json=MARKET)
    full = (await client.get(f"/trips/{tid}")).json()
    assert len(full["pointsOfInterest"]) == 1
    assert any(loc.get("lat") is not None for loc in places_of(full))

    seen = (await viewer.get(f"/trips/{tid}")).json()
    assert seen["pointsOfInterest"] == []
    for loc in places_of(seen):
        assert not HIDDEN & loc.keys(), loc
        assert loc["name"]
    # The timeline's day rows still name the cities.
    owners = {s["name"]: s["location"].get("city") for s in full["stays"]}
    assert {s["name"]: s["location"].get("city") for s in seen["stays"]} == owners
    # Every time is still on its own clock.
    assert [t["departZone"] for t in seen["travels"]] == [t["departZone"] for t in full["travels"]]
    assert [s["zone"] for s in seen["stays"]] == [s["zone"] for s in full["stays"]]


async def test_a_viewer_keeps_the_activities_places(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    full = (await client.get(f"/trips/{trip['id']}")).json()
    seen = (await viewer.get(f"/trips/{trip['id']}")).json()

    def item_places(t: Json) -> list[Json | None]:
        return [i.get("location") for d in t["days"] for i in d["items"]]

    assert item_places(seen) == item_places(full)


async def test_an_editor_sees_everything(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await edited_trip(client, viewer)  # `viewer` joined as an editor
    await client.post(f"/trips/{trip['id']}/points-of-interest", json=MARKET)
    seen = (await viewer.get(f"/trips/{trip['id']}")).json()
    assert len(seen["pointsOfInterest"]) == 1
    assert any(loc.get("lat") is not None for loc in places_of(seen))


async def test_a_viewers_export_follows_their_read(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    await client.post(f"/trips/{trip['id']}/points-of-interest", json=MARKET)
    exported = (await viewer.get(f"/trips/{trip['id']}/export")).json()
    assert "pointsOfInterest" not in exported
    assert all(not HIDDEN & loc.keys() for loc in places_of(exported))
