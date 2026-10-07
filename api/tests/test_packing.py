"""Packing lists: everyone on a trip keeps their own, nobody sees anyone else's."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

from app.sample_data import load_sample_trip
from tests.test_sharing import shared_trip

Json = dict[str, Any]


async def a_trip(client: AsyncClient) -> str:
    return str((await client.post("/trips/import", json=load_sample_trip())).json()["id"])


async def add(client: AsyncClient, trip_id: str, category: str, text: str) -> Json:
    resp = await client.post(f"/trips/{trip_id}/packing", json={"category": category, "text": text})
    assert resp.status_code == 201, resp.text
    body: Json = resp.json()
    return body


async def test_add_tick_rename_move_and_delete(client: AsyncClient) -> None:
    tid = await a_trip(client)
    socks = await add(client, tid, "clothes", "  Socks ")
    assert socks == {**socks, "text": "Socks", "quantity": 1, "checked": False, "position": 0}
    shirt = await add(client, tid, "clothes", "Shirt")
    assert shirt["position"] == 1

    url = f"/trips/{tid}/packing/{socks['id']}"
    assert (await client.patch(url, json={"checked": True})).json()["checked"] is True
    renamed = (await client.patch(url, json={"text": "Wool socks"})).json()
    assert (renamed["text"], renamed["checked"]) == ("Wool socks", True)
    assert (await client.patch(url, json={"quantity": 5})).json()["quantity"] == 5
    moved = (await client.patch(url, json={"category": "carry_on"})).json()
    assert (moved["category"], moved["position"]) == ("carry_on", 0)

    assert (await client.delete(url)).status_code == 204
    assert (await client.patch(url, json={"checked": False})).status_code == 404
    left = (await client.get(f"/trips/{tid}/packing")).json()
    assert [i["text"] for i in left] == ["Shirt"]


async def test_lists_come_back_in_category_order(client: AsyncClient) -> None:
    tid = await a_trip(client)
    await add(client, tid, "other", "Book")
    await add(client, tid, "electronics", "Charger")
    await add(client, tid, "clothes", "Socks")
    items = (await client.get(f"/trips/{tid}/packing")).json()
    assert [i["category"] for i in items] == ["clothes", "electronics", "other"]


async def test_bad_input_is_refused(client: AsyncClient) -> None:
    tid = await a_trip(client)
    url = f"/trips/{tid}/packing"
    assert (await client.post(url, json={"category": "clothes", "text": "   "})).status_code == 422
    assert (
        await client.post(url, json={"category": "snacks", "text": "Crisps"})
    ).status_code == 422
    assert (
        await client.post(url, json={"category": "clothes", "text": "x" * 201})
    ).status_code == 422


async def test_suggestions_fill_only_an_empty_list(client: AsyncClient) -> None:
    tid = await a_trip(client)
    url = f"/trips/{tid}/packing/suggestions"
    first = (await client.post(url)).json()
    assert "Passport" in [i["text"] for i in first]
    assert next(i for i in first if i["text"] == "Socks")["quantity"] == 7
    assert {i["category"] for i in first} >= {"clothes", "electronics", "documents"}
    again = (await client.post(url)).json()
    assert len(again) == len(first)


async def test_lists_are_personal(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    mine = await add(client, tid, "clothes", "Owner's socks")
    # A viewer can't edit the trip, but keeps their own packing list.
    theirs = await add(viewer, tid, "toiletries", "Viewer's toothbrush")

    assert [i["text"] for i in (await client.get(f"/trips/{tid}/packing")).json()] == [
        "Owner's socks"
    ]
    assert [i["text"] for i in (await viewer.get(f"/trips/{tid}/packing")).json()] == [
        "Viewer's toothbrush"
    ]
    # Someone else's line is not found, either way round.
    assert (
        await viewer.patch(f"/trips/{tid}/packing/{mine['id']}", json={"checked": True})
    ).status_code == 404
    assert (await client.delete(f"/trips/{tid}/packing/{theirs['id']}")).status_code == 404
    # Someone not on the trip sees nothing.
    assert (await stranger.get(f"/trips/{tid}/packing")).status_code == 404
    assert (
        await stranger.post(f"/trips/{tid}/packing", json={"category": "other", "text": "x"})
    ).status_code == 404


async def test_signed_out_is_401(anon_client: AsyncClient, client: AsyncClient) -> None:
    tid = await a_trip(client)
    assert (await anon_client.get(f"/trips/{tid}/packing")).status_code == 401


async def test_quantity_on_adding(client: AsyncClient) -> None:
    tid = await a_trip(client)
    resp = await client.post(
        f"/trips/{tid}/packing", json={"category": "clothes", "text": "T-shirts", "quantity": 4}
    )
    assert resp.json()["quantity"] == 4


async def test_deleting_a_list_deletes_only_your_lines_on_it(
    client: AsyncClient, viewer: AsyncClient
) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    await add(client, tid, "clothes", "Socks")
    await add(client, tid, "clothes", "Shirt")
    await add(client, tid, "electronics", "Charger")
    await add(viewer, tid, "clothes", "Viewer's hat")

    assert (await client.delete(f"/trips/{tid}/packing/lists/clothes")).status_code == 204
    assert [i["text"] for i in (await client.get(f"/trips/{tid}/packing")).json()] == ["Charger"]
    assert [i["text"] for i in (await viewer.get(f"/trips/{tid}/packing")).json()] == [
        "Viewer's hat"
    ]
    assert (await client.delete(f"/trips/{tid}/packing/lists/snacks")).status_code == 422
