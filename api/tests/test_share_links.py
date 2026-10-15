"""A trip's secret link (Run stage 31): the owner turns it on, rotates it or
turns it off; anyone with it reads the trip as a viewer, with no account,
through a hidden guest account. Guest requests use a real token (the
`anon_client`), so `is_active` is checked as it is for real.

Here `viewer` (pripri@) is invited as an editor and `stranger` as a viewer."""

from __future__ import annotations

from typing import Any

from httpx import AsyncClient

from app.sample_data import load_sample_trip
from tests.test_sharing import edited_trip, invite


async def _trip(owner: AsyncClient) -> str:
    return str((await owner.post("/trips/import", json=load_sample_trip())).json()["id"])


async def _session(anon: AsyncClient, secret: str) -> Any:
    return await anon.post(f"/links/{secret}/session")


async def _as_guest(anon: AsyncClient, secret: str) -> AsyncClient:
    """`anon`, signed in through the link."""
    resp = await _session(anon, secret)
    assert resp.status_code == 200, resp.text
    anon.headers["Authorization"] = f"Bearer {resp.json()['access_token']}"
    return anon


async def test_the_session_says_which_trip(client: AsyncClient, anon_client: AsyncClient) -> None:
    tid = await _trip(client)
    secret = (await client.post(f"/trips/{tid}/link")).json()["secret"]
    body = (await _session(anon_client, secret)).json()
    assert body["trip_id"] == tid
    assert body["token_type"] == "bearer"


async def test_off_until_the_owner_turns_it_on(client: AsyncClient) -> None:
    tid = await _trip(client)
    assert (await client.get(f"/trips/{tid}/link")).json() == {"enabled": False, "secret": None}
    on = (await client.post(f"/trips/{tid}/link")).json()
    assert on["enabled"] is True
    assert len(on["secret"]) >= 40
    # Turning it on again keeps the same link.
    assert (await client.post(f"/trips/{tid}/link")).json()["secret"] == on["secret"]
    assert (await client.get(f"/trips/{tid}/link")).json() == on


async def test_the_link_reads_the_trip_as_a_viewer(
    client: AsyncClient, anon_client: AsyncClient
) -> None:
    tid = await _trip(client)
    await client.post(f"/trips/{tid}/memories", json={"text": "just us", "zone": "UTC"})
    await client.post(
        f"/trips/{tid}/memories", json={"text": "for family", "zone": "UTC", "isPublic": True}
    )
    secret = (await client.post(f"/trips/{tid}/link")).json()["secret"]
    guest = await _as_guest(anon_client, secret)

    trip = (await guest.get(f"/trips/{tid}")).json()
    assert trip["role"] == "viewer"
    assert "confirmationNumber" not in str(trip)
    assert all(day.get("planB", []) == [] for day in trip["days"])
    assert [m["text"] for m in (await guest.get(f"/trips/{tid}/memories")).json()] == ["for family"]
    # Only that trip on their list.
    assert [t["id"] for t in (await guest.get("/trips")).json()] == [tid]
    # Every write is refused.
    assert (await guest.patch(f"/trips/{tid}", json={"name": "Ours"})).status_code == 403
    memory = {"text": "hi", "zone": "UTC"}
    assert (await guest.post(f"/trips/{tid}/memories", json=memory)).status_code == 403
    # Who they are: a guest of this trip, not a person.
    me = (await guest.get("/users/me")).json()
    assert me["guest_trip_id"] == tid
    assert me["name"] == "Anyone with the link"


async def test_a_guest_reaches_no_other_trip(client: AsyncClient, anon_client: AsyncClient) -> None:
    tid = await _trip(client)
    other = await _trip(client)
    guest = await _as_guest(anon_client, (await client.post(f"/trips/{tid}/link")).json()["secret"])
    assert (await guest.get(f"/trips/{other}")).status_code == 404


async def test_rotating_ends_the_old_link_and_its_sessions(
    client: AsyncClient, anon_client: AsyncClient
) -> None:
    tid = await _trip(client)
    old = (await client.post(f"/trips/{tid}/link")).json()["secret"]
    guest = await _as_guest(anon_client, old)
    assert (await guest.get(f"/trips/{tid}")).status_code == 200

    new = (await client.post(f"/trips/{tid}/link/rotate")).json()["secret"]
    assert new != old
    # The signed-in guest is out on their next request; the old link is dead.
    assert (await guest.get(f"/trips/{tid}")).status_code == 401
    assert (await guest.post("/auth/refresh")).status_code == 401
    del guest.headers["Authorization"]
    assert (await _session(guest, old)).status_code == 404
    again = await _as_guest(guest, new)
    assert (await again.get(f"/trips/{tid}")).status_code == 200


async def test_turning_it_off(client: AsyncClient, anon_client: AsyncClient) -> None:
    tid = await _trip(client)
    first = (await client.post(f"/trips/{tid}/link")).json()["secret"]
    guest = await _as_guest(anon_client, first)
    assert (await client.delete(f"/trips/{tid}/link")).status_code == 204
    assert (await client.get(f"/trips/{tid}/link")).json() == {"enabled": False, "secret": None}
    assert (await guest.get(f"/trips/{tid}")).status_code == 401
    del guest.headers["Authorization"]
    assert (await _session(guest, first)).status_code == 404
    # On again: a different link.
    assert (await client.post(f"/trips/{tid}/link")).json()["secret"] != first


async def test_a_deleted_trip_takes_its_link_with_it(
    client: AsyncClient, anon_client: AsyncClient
) -> None:
    tid = await _trip(client)
    secret = (await client.post(f"/trips/{tid}/link")).json()["secret"]
    guest = await _as_guest(anon_client, secret)
    assert (await client.delete(f"/trips/{tid}")).status_code == 204
    assert (await guest.get("/trips")).status_code == 401
    del guest.headers["Authorization"]
    assert (await _session(guest, secret)).status_code == 404


async def test_unknown_secrets_are_404(anon_client: AsyncClient) -> None:
    assert (await _session(anon_client, "not-a-link")).status_code == 404
    assert (await _session(anon_client, "")).status_code in (404, 405)


async def test_only_the_owner_controls_the_link(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    tid = str((await edited_trip(client, viewer))["id"])  # `viewer` is an editor here
    await invite(client, tid, stranger.email, "viewer")
    for member in (viewer, stranger):
        assert (await member.get(f"/trips/{tid}/link")).status_code == 403
        assert (await member.post(f"/trips/{tid}/link")).status_code == 403
        assert (await member.post(f"/trips/{tid}/link/rotate")).status_code == 403
        assert (await member.delete(f"/trips/{tid}/link")).status_code == 403
    # Someone else's trip, not shared with them: 404.
    other = await _trip(viewer)
    assert (await stranger.get(f"/trips/{other}/link")).status_code == 404


async def test_guests_are_hidden_and_have_no_password(
    client: AsyncClient, anon_client: AsyncClient, admin_client: AsyncClient
) -> None:
    tid = await _trip(client)
    secret = (await client.post(f"/trips/{tid}/link")).json()["secret"]
    guest = await _as_guest(anon_client, secret)
    me = (await guest.get("/users/me")).json()

    # Not in Admin → Users, not in the members list, not invitable by email.
    assert me["email"] not in str((await admin_client.get("/admin/users")).json())
    assert (await client.get(f"/trips/{tid}/members")).json() == []
    assert (await invite(client, tid, me["email"], "editor")).status_code == 404
    # No password to change, no profile to edit.
    change = {"currentPassword": "x", "newPassword": "a-much-longer-password"}
    assert (await guest.post("/auth/change-password", json=change)).status_code == 403
    assert (await guest.patch("/users/me", json={"name": "Mum"})).status_code == 403
    assert (
        await guest.patch("/users/me", json={"password": "a-much-longer-password"})
    ).status_code == 403
