"""Plan B (Run stage 25): a day's backup plan. The same activities, in their
own list (`days[].planB`), written through the same endpoints with
`planB: true`; never sent to viewers."""

from __future__ import annotations

from typing import Any

import pytest
from httpx import AsyncClient

from app.sample_data import load_sample_trip
from app.sample_data.demo_trip import build_demo_trip
from app.trip_document import validate_trip_document
from tests.conftest import if_match
from tests.test_items import day, item_id, titles
from tests.test_sharing import edited_trip, shared_trip

Json = dict[str, Any]

RAINY = "2026-05-13"  # the sample's Männlichen day, which has a plan B
SUNNY = "2026-05-11"  # a day with no plan B


@pytest.fixture
async def trip(client: AsyncClient) -> Json:
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    body: Json = (await client.get(f"/trips/{trip_id}")).json()
    return body


def plan_b(trip: Json, date: str) -> list[str]:
    d = day(trip, date)
    return [i["title"] for i in d["planB"]] if d else []


def plan_b_id(trip: Json, date: str, title: str) -> str:
    d = day(trip, date)
    assert d is not None
    return next(i["id"] for i in d["planB"] if i["title"] == title)


# ---- reading ----


async def test_the_sample_has_a_plan_b_kept_apart_from_the_plan(trip: Json) -> None:
    assert plan_b(trip, RAINY) == ["Trümmelbach Falls", "Lunch in Lauterbrunnen", "Fondue night"]
    assert "Trümmelbach Falls" not in titles(trip, RAINY)
    assert titles(trip, RAINY)[0] == "Männlichen → Kleine Scheidegg hike"
    # A day with no plan B still has the (empty) list in the read.
    assert day(trip, SUNNY)["planB"] == []  # type: ignore[index]
    # Plan B items are full activities: ids, versions, zones.
    falls = day(trip, RAINY)["planB"][0]  # type: ignore[index]
    assert falls["version"] == 1 and falls["zone"] == "Europe/Zurich"


# ---- writing ----


async def test_create_adds_to_the_end_of_plan_b(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/items",
        json={"date": RAINY, "title": "Chocolate shop", "planB": True},
    )
    assert resp.status_code == 201, resp.text
    updated = resp.json()
    assert plan_b(updated, RAINY)[-1] == "Chocolate shop"
    assert titles(updated, RAINY) == titles(trip, RAINY)


async def test_create_starts_a_plan_b_on_a_day_without_one(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/items",
        json={"date": SUNNY, "title": "Einstein Museum", "start": f"{SUNNY}T15:00", "planB": True},
    )
    assert resp.status_code == 201, resp.text
    assert plan_b(resp.json(), SUNNY) == ["Einstein Museum"]


async def test_plan_a_is_the_default(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(f"/trips/{trip['id']}/items", json={"date": RAINY, "title": "Nap"})
    assert titles(resp.json(), RAINY)[-1] == "Nap"
    assert "Nap" not in plan_b(resp.json(), RAINY)


async def test_plan_b_follows_the_same_rules(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/items",
        json={"date": RAINY, "title": "Spa", "start": f"{SUNNY}T10:00", "planB": True},
    )
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["path"] == "start"


async def test_replace_with_the_other_plan_moves_it_to_the_end_of_that_plan(
    client: AsyncClient, trip: Json
) -> None:
    hike = item_id(trip, RAINY, "Männlichen → Kleine Scheidegg hike")
    resp = await client.put(
        f"/trips/{trip['id']}/items/{hike}",
        json={"date": RAINY, "title": "Männlichen → Kleine Scheidegg hike", "planB": True},
        headers=if_match(1),
    )
    assert resp.status_code == 200, resp.text
    moved = resp.json()
    assert "Männlichen → Kleine Scheidegg hike" not in titles(moved, RAINY)
    assert plan_b(moved, RAINY)[-1] == "Männlichen → Kleine Scheidegg hike"
    entry = day(moved, RAINY)["planB"][-1]  # type: ignore[index]
    assert entry["id"] == hike and entry["version"] == 2

    # And back: leaving `planB` out puts it in plan A again, at the end.
    back = await client.put(
        f"/trips/{trip['id']}/items/{hike}",
        json={"date": RAINY, "title": "Männlichen → Kleine Scheidegg hike"},
        headers=if_match(2),
    )
    assert titles(back.json(), RAINY)[-1] == "Männlichen → Kleine Scheidegg hike"
    assert len(plan_b(back.json(), RAINY)) == 3


async def test_a_stale_plan_b_edit_is_a_409(client: AsyncClient, trip: Json) -> None:
    falls = plan_b_id(trip, RAINY, "Trümmelbach Falls")
    ok = await client.put(
        f"/trips/{trip['id']}/items/{falls}",
        json={"date": RAINY, "title": "Falls", "planB": True},
        headers=if_match(1),
    )
    assert ok.status_code == 200
    stale = await client.put(
        f"/trips/{trip['id']}/items/{falls}",
        json={"date": RAINY, "title": "Falls again", "planB": True},
        headers=if_match(1),
    )
    assert stale.status_code == 409
    assert stale.json()["detail"]["current"]["title"] == "Falls"


async def test_move_stays_within_its_plan(client: AsyncClient, trip: Json) -> None:
    tid = trip["id"]
    falls = plan_b_id(trip, RAINY, "Trümmelbach Falls")
    # First in plan B: up is a no-op, even though plan A has items.
    up = await client.post(f"/trips/{tid}/items/{falls}/move", json={"direction": "up"})
    assert plan_b(up.json(), RAINY) == plan_b(trip, RAINY)
    assert titles(up.json(), RAINY) == titles(trip, RAINY)
    down = await client.post(f"/trips/{tid}/items/{falls}/move", json={"direction": "down"})
    assert plan_b(down.json(), RAINY)[:2] == ["Lunch in Lauterbrunnen", "Trümmelbach Falls"]
    assert titles(down.json(), RAINY) == titles(trip, RAINY)
    # The last plan A item can't move down into plan B either.
    fondue = item_id(trip, RAINY, "Fondue night")
    last = await client.post(f"/trips/{tid}/items/{fondue}/move", json={"direction": "down"})
    assert titles(last.json(), RAINY) == titles(trip, RAINY)


async def test_delete_removes_it_from_plan_b(client: AsyncClient, trip: Json) -> None:
    falls = plan_b_id(trip, RAINY, "Trümmelbach Falls")
    resp = await client.delete(f"/trips/{trip['id']}/items/{falls}", headers=if_match(1))
    assert resp.status_code == 200
    assert "Trümmelbach Falls" not in plan_b(resp.json(), RAINY)


# ---- who sees it ----


async def test_a_viewer_never_gets_plan_b(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await shared_trip(client, viewer)
    read = (await viewer.get(f"/trips/{trip['id']}")).json()
    assert all(d["planB"] == [] for d in read["days"])
    exported = (await viewer.get(f"/trips/{trip['id']}/export")).json()
    assert all("planB" not in d for d in exported["days"])


async def test_editors_and_the_owner_get_plan_b(client: AsyncClient, viewer: AsyncClient) -> None:
    # `viewer` here joins with the edit code, so is an editor.
    trip = await edited_trip(client, viewer)
    for who in (client, viewer):
        read = (await who.get(f"/trips/{trip['id']}")).json()
        assert len(plan_b(read, RAINY)) == 3
        exported = (await who.get(f"/trips/{trip['id']}/export")).json()
        assert any("planB" in d for d in exported["days"])


async def test_a_viewer_cannot_write_plan_b(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await shared_trip(client, viewer)
    resp = await viewer.post(
        f"/trips/{trip['id']}/items", json={"date": RAINY, "title": "Sneaky", "planB": True}
    )
    assert resp.status_code in (403, 404)


async def test_another_users_plan_b_item_is_a_404(
    client: AsyncClient, stranger: AsyncClient, trip: Json
) -> None:
    falls = plan_b_id(trip, RAINY, "Trümmelbach Falls")
    resp = await stranger.put(
        f"/trips/{trip['id']}/items/{falls}",
        json={"date": RAINY, "title": "Mine now", "planB": True},
    )
    assert resp.status_code == 404


# ---- the document ----


async def test_export_and_import_round_trip_plan_b(client: AsyncClient, trip: Json) -> None:
    exported = (await client.get(f"/trips/{trip['id']}/export")).json()
    rainy = next(d for d in exported["days"] if d["date"] == RAINY)
    assert [i["title"] for i in rainy["planB"]] == plan_b(trip, RAINY)
    # Days with no plan B have no key, as before plan B existed.
    assert "planB" not in next(d for d in exported["days"] if d["date"] == SUNNY)
    again = (await client.post("/trips/import", json=exported)).json()["id"]
    assert plan_b((await client.get(f"/trips/{again}")).json(), RAINY) == plan_b(trip, RAINY)


def test_a_plan_b_start_on_the_wrong_date_is_rejected_with_its_path() -> None:
    doc = load_sample_trip()
    rainy = next(d for d in doc["days"] if d["date"] == RAINY)
    rainy["planB"][0]["start"] = f"{SUNNY}T10:00"
    with pytest.raises(Exception) as caught:
        validate_trip_document(doc)
    paths = [e.path for e in caught.value.errors]  # type: ignore[attr-defined]
    assert paths == ["days[2].planB[0].start"]


def test_the_demo_trip_has_a_plan_b_too() -> None:
    doc = validate_trip_document(build_demo_trip())
    assert [d.title for d in doc.days if d.plan_b] == ["Hydra by ferry"]
