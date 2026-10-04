"""Editing activities and days: create, replace, move, delete, day title/summary."""

from __future__ import annotations

import datetime as dt
import uuid
from typing import Any

import pytest
from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import Trip, UserRecord
from app.sample_data import load_sample_trip

Json = dict[str, Any]


@pytest.fixture
async def trip(client: AsyncClient) -> Json:
    """The sample trip, imported and read back (with ids)."""
    trip_id = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    body: Json = (await client.get(f"/trips/{trip_id}")).json()
    return body


def day(trip: Json, date: str) -> Json | None:
    return next((d for d in trip["days"] if d["date"] == date), None)


def titles(trip: Json, date: str) -> list[str]:
    d = day(trip, date)
    return [i["title"] for i in d["items"]] if d else []


def item_id(trip: Json, date: str, title: str) -> str:
    d = day(trip, date)
    assert d is not None
    return next(i["id"] for i in d["items"] if i["title"] == title)


# ---- create ----


async def test_create_appends_to_the_day(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/items",
        json={
            "date": "2026-05-11",
            "title": "Gelato",
            "start": "2026-05-11T20:30",
            "end": "2026-05-11T21:00",
            "location": {"name": "Gelateria di Berna"},
            "notes": "**Pistachio**",
        },
    )
    assert resp.status_code == 201, resp.text
    updated = resp.json()
    assert titles(updated, "2026-05-11")[-1] == "Gelato"
    added = day(updated, "2026-05-11")["items"][-1]  # type: ignore[index]
    assert added["start"] == "2026-05-11T20:30"
    assert added["location"] == {"name": "Gelateria di Berna"}


async def test_create_on_a_date_with_no_day_makes_an_untitled_day(
    client: AsyncClient, trip: Json
) -> None:
    assert day(trip, "2026-05-10") is None
    resp = await client.post(
        f"/trips/{trip['id']}/items", json={"date": "2026-05-10", "title": "Pack"}
    )
    assert resp.status_code == 201
    new_day = day(resp.json(), "2026-05-10")
    assert new_day is not None
    assert "title" not in new_day  # untitled; the UI heads it by its date
    assert titles(resp.json(), "2026-05-10") == ["Pack"]


async def test_create_rejects_like_an_import_does(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/items",
        json={
            "date": "2026-05-11",
            "title": "Bad",
            "start": "2026-05-12T09:00",  # wrong date for the day
            "end": "2026-05-12T08:00",  # before start
            "location": {"name": "x", "url": "not-a-link"},
        },
    )
    assert resp.status_code == 422
    # Structure fails first (the url), exactly as an import would report it.
    assert {e["path"] for e in resp.json()["errors"]} == {"location.url"}

    resp = await client.post(
        f"/trips/{trip['id']}/items",
        json={
            "date": "2026-05-11",
            "title": "Bad",
            "start": "2026-05-12T09:00",
            "end": "2026-05-12T08:00",
        },
    )
    assert resp.status_code == 422
    assert {e["path"] for e in resp.json()["errors"]} == {"start", "end"}
    assert resp.json()["detail"] == "The activity has 2 problems."


async def test_import_and_edit_reject_the_same_activity_the_same_way(
    client: AsyncClient, trip: Json
) -> None:
    bad = {"title": "Bad", "start": "2026-05-12T09:00"}
    doc = load_sample_trip()
    doc["days"][0]["items"] = [bad]
    imported = (await client.post("/trips/import", json=doc)).json()["errors"]
    edited = (
        await client.post(f"/trips/{trip['id']}/items", json={**bad, "date": "2026-05-11"})
    ).json()["errors"]
    assert [e["message"] for e in imported] == [e["message"] for e in edited]
    assert imported[0]["path"] == "days[0].items[0].start" and edited[0]["path"] == "start"


async def test_create_outside_the_trip_is_rejected(client: AsyncClient, trip: Json) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/items", json={"date": "2026-06-01", "title": "Later"}
    )
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["path"] == "date"


async def test_unknown_fields_and_ids_in_the_body_are_rejected(
    client: AsyncClient, trip: Json
) -> None:
    resp = await client.post(
        f"/trips/{trip['id']}/items",
        json={"date": "2026-05-11", "title": "x", "id": str(uuid.uuid4())},
    )
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["path"] == "id"


# ---- replace ----


async def test_replace_is_a_full_replace(client: AsyncClient, trip: Json) -> None:
    target = item_id(trip, "2026-05-11", "Dinner at Kornhauskeller")
    resp = await client.put(
        f"/trips/{trip['id']}/items/{target}",
        json={"date": "2026-05-11", "title": "Dinner (moved earlier)", "start": "2026-05-11T18:00"},
    )
    assert resp.status_code == 200, resp.text
    replaced = day(resp.json(), "2026-05-11")["items"][-1]  # type: ignore[index]
    assert replaced["id"] == target
    assert replaced["title"] == "Dinner (moved earlier)"
    # Omitted fields are cleared: the form always sends the whole activity.
    assert "end" not in replaced
    assert "location" not in replaced
    assert "confirmationNumber" not in replaced


async def test_replace_with_a_new_date_moves_to_the_end_of_that_day(
    client: AsyncClient, trip: Json
) -> None:
    target = item_id(trip, "2026-05-11", "Old Town & Zytglogge walk")
    resp = await client.put(
        f"/trips/{trip['id']}/items/{target}",
        json={"date": "2026-05-13", "title": "Old Town & Zytglogge walk"},
    )
    assert resp.status_code == 200
    moved = resp.json()
    assert "Old Town & Zytglogge walk" not in titles(moved, "2026-05-11")
    assert titles(moved, "2026-05-13")[-1] == "Old Town & Zytglogge walk"


async def test_replace_validates(client: AsyncClient, trip: Json) -> None:
    target = item_id(trip, "2026-05-11", "Lunch at Altes Tramdepot")
    resp = await client.put(
        f"/trips/{trip['id']}/items/{target}",
        json={"date": "2026-05-11", "title": "  "},
    )
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["path"] == "title"


# ---- delete ----


async def test_delete_hides_the_activity(client: AsyncClient, trip: Json) -> None:
    target = item_id(trip, "2026-05-11", "Lunch at Altes Tramdepot")
    resp = await client.delete(f"/trips/{trip['id']}/items/{target}")
    assert resp.status_code == 200
    assert "Lunch at Altes Tramdepot" not in titles(resp.json(), "2026-05-11")
    fresh = (await client.get(f"/trips/{trip['id']}")).json()
    assert "Lunch at Altes Tramdepot" not in titles(fresh, "2026-05-11")
    # A deleted activity can't be edited or deleted again.
    assert (await client.delete(f"/trips/{trip['id']}/items/{target}")).status_code == 404
    assert (
        await client.put(
            f"/trips/{trip['id']}/items/{target}", json={"date": "2026-05-11", "title": "x"}
        )
    ).status_code == 404


# ---- move ----


async def test_move_up_and_down(client: AsyncClient, trip: Json) -> None:
    walk = item_id(trip, "2026-05-11", "Old Town & Zytglogge walk")
    up = await client.post(f"/trips/{trip['id']}/items/{walk}/move", json={"direction": "up"})
    assert up.status_code == 200
    assert titles(up.json(), "2026-05-11") == [
        "Old Town & Zytglogge walk",
        "Lunch at Altes Tramdepot",
        "Dinner at Kornhauskeller",
    ]
    down = await client.post(f"/trips/{trip['id']}/items/{walk}/move", json={"direction": "down"})
    assert titles(down.json(), "2026-05-11")[1] == "Old Town & Zytglogge walk"


async def test_move_at_the_ends_is_a_no_op(client: AsyncClient, trip: Json) -> None:
    first = item_id(trip, "2026-05-11", "Lunch at Altes Tramdepot")
    last = item_id(trip, "2026-05-11", "Dinner at Kornhauskeller")
    before = titles(trip, "2026-05-11")
    up = await client.post(f"/trips/{trip['id']}/items/{first}/move", json={"direction": "up"})
    down = await client.post(f"/trips/{trip['id']}/items/{last}/move", json={"direction": "down"})
    assert titles(up.json(), "2026-05-11") == before
    assert titles(down.json(), "2026-05-11") == before


async def test_move_rejects_a_bad_direction(client: AsyncClient, trip: Json) -> None:
    first = item_id(trip, "2026-05-11", "Lunch at Altes Tramdepot")
    resp = await client.post(
        f"/trips/{trip['id']}/items/{first}/move", json={"direction": "sideways"}
    )
    assert resp.status_code == 422


# ---- day title / summary ----


async def test_update_day_sets_title_and_summary(client: AsyncClient, trip: Json) -> None:
    resp = await client.put(
        f"/trips/{trip['id']}/days/2026-05-11",
        json={"title": "Bern, slowly", "summary": "Jet lag day."},
    )
    assert resp.status_code == 200
    updated = day(resp.json(), "2026-05-11")
    assert updated is not None
    assert (updated["title"], updated["summary"]) == ("Bern, slowly", "Jet lag day.")
    assert len(updated["items"]) == 3  # activities untouched


async def test_update_day_on_a_date_with_no_day_creates_it(client: AsyncClient, trip: Json) -> None:
    resp = await client.put(f"/trips/{trip['id']}/days/2026-05-10", json={"title": "Fly out"})
    assert resp.status_code == 200
    assert day(resp.json(), "2026-05-10")["title"] == "Fly out"  # type: ignore[index]


async def test_update_day_can_clear_the_title(client: AsyncClient, trip: Json) -> None:
    resp = await client.put(f"/trips/{trip['id']}/days/2026-05-11", json={})
    assert "title" not in day(resp.json(), "2026-05-11")  # type: ignore[operator]


async def test_update_day_outside_the_trip_is_rejected(client: AsyncClient, trip: Json) -> None:
    resp = await client.put(f"/trips/{trip['id']}/days/2026-06-01", json={"title": "x"})
    assert resp.status_code == 422
    assert resp.json()["errors"][0]["path"] == "date"


# ---- ownership ----


async def test_activity_on_another_trip_is_a_404(
    client: AsyncClient, trip: Json, db: AsyncSession
) -> None:
    other_user = UserRecord(
        id=uuid.uuid4(), email="other@example.com", hashed_password="x", is_active=True
    )
    db.add(other_user)
    await db.commit()
    other_trip = Trip(
        user_id=other_user.id,
        name="Not yours",
        start_date=dt.date(2026, 5, 10),
        end_date=dt.date(2026, 5, 14),
        timezone="UTC",
    )
    db.add(other_trip)
    await db.commit()
    mine = item_id(trip, "2026-05-11", "Lunch at Altes Tramdepot")

    # My activity addressed through someone else's trip: the trip itself is a 404.
    assert (await client.delete(f"/trips/{other_trip.id}/items/{mine}")).status_code == 404
    assert (
        await client.post(
            f"/trips/{other_trip.id}/items", json={"date": "2026-05-11", "title": "x"}
        )
    ).status_code == 404
    # A random id on my own trip is a 404 too.
    assert (await client.delete(f"/trips/{trip['id']}/items/{uuid.uuid4()}")).status_code == 404


async def test_activity_on_my_other_trip_is_a_404(client: AsyncClient, trip: Json) -> None:
    second = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    mine = item_id(trip, "2026-05-11", "Lunch at Altes Tramdepot")
    assert (await client.delete(f"/trips/{second}/items/{mine}")).status_code == 404


async def test_anonymous_edits_are_rejected(anon_client: AsyncClient) -> None:
    trip_id, some_item = uuid.uuid4(), uuid.uuid4()
    assert (
        await anon_client.post(f"/trips/{trip_id}/items", json={"date": "2026-05-11", "title": "x"})
    ).status_code == 401
    assert (await anon_client.delete(f"/trips/{trip_id}/items/{some_item}")).status_code == 401
    assert (
        await anon_client.put(f"/trips/{trip_id}/days/2026-05-11", json={"title": "x"})
    ).status_code == 401
