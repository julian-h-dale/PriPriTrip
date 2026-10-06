"""Admin invites and password resets, and the forced password change (Phase
54). Uses real tokens (the token fixtures), since this is about sign-in."""

from __future__ import annotations

import re
from typing import Any

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserRecord
from app.services.users import temporary_password

PATTERN = re.compile(r"^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$")


async def _login(anon: AsyncClient, email: str, password: str) -> Any:
    return await anon.post("/auth/login", data={"username": email, "password": password})


def _bearer(token: str) -> dict[str, str]:
    return {"Authorization": f"Bearer {token}"}


async def _invite(admin: AsyncClient, email: str = "inlaw@example.com") -> dict[str, Any]:
    resp = await admin.post("/admin/users", json={"email": email, "name": "In-law"})
    assert resp.status_code == 201, resp.text
    body: dict[str, Any] = resp.json()
    return body


def test_temporary_passwords_are_random_and_readable() -> None:
    made = {temporary_password() for _ in range(50)}
    assert len(made) == 50
    assert all(PATTERN.match(p) for p in made)
    assert not any(c in "".join(made) for c in "01ilo")


async def test_an_invite_makes_an_account_that_must_change_its_password(
    admin_client: AsyncClient, anon_client: AsyncClient
) -> None:
    invited = await _invite(admin_client, " InLaw@Example.com ")
    assert PATTERN.match(invited["temporaryPassword"])
    assert invited["user"]["email"] == "inlaw@example.com"
    assert invited["user"]["name"] == "In-law"
    assert invited["user"]["must_change_password"] is True
    assert invited["user"]["is_superuser"] is False

    login = await _login(anon_client, "inlaw@example.com", invited["temporaryPassword"])
    assert login.status_code == 200
    token = login.json()["access_token"]
    me = await anon_client.get("/users/me", headers=_bearer(token))
    assert me.json()["must_change_password"] is True
    # Everything else waits for a new password.
    for path in ("/trips", "/config"):
        resp = await anon_client.get(path, headers=_bearer(token))
        assert resp.status_code == 403
        assert resp.json()["detail"] == "PASSWORD_CHANGE_REQUIRED"

    changed = await anon_client.post(
        "/auth/change-password",
        json={"currentPassword": invited["temporaryPassword"], "newPassword": "a better one"},
        headers=_bearer(token),
    )
    assert changed.status_code == 200, changed.text
    fresh = changed.json()["access_token"]
    assert (await anon_client.get("/trips", headers=_bearer(fresh))).status_code == 200
    assert (await anon_client.get("/users/me", headers=_bearer(fresh))).json()[
        "must_change_password"
    ] is False
    # The temporary password is gone; the new one works.
    assert (
        await _login(anon_client, "inlaw@example.com", invited["temporaryPassword"])
    ).status_code == 400
    assert (await _login(anon_client, "inlaw@example.com", "a better one")).status_code == 200


async def test_an_email_already_in_use_is_a_409(admin_client: AsyncClient) -> None:
    await _invite(admin_client)
    resp = await admin_client.post("/admin/users", json={"email": "INLAW@example.com"})
    assert resp.status_code == 409
    assert (await admin_client.post("/admin/users", json={"email": "nope"})).status_code == 422


async def test_only_admins_invite_or_reset(
    token_client: AsyncClient, anon_client: AsyncClient, test_user: UserRecord
) -> None:
    for client, status in ((token_client, 403), (anon_client, 401)):
        assert (
            await client.post("/admin/users", json={"email": "x@example.com"})
        ).status_code == status
        assert (
            await client.post(f"/admin/users/{test_user.id}/reset-password")
        ).status_code == status


async def test_a_reset_locks_the_account_until_a_new_password_is_chosen(
    admin_client: AsyncClient,
    token_client: AsyncClient,
    test_user: UserRecord,
    anon_client: AsyncClient,
) -> None:
    # The user's phone is signed in (token_client) and working.
    assert (await token_client.get("/trips")).status_code == 200
    resp = await admin_client.post(f"/admin/users/{test_user.id}/reset-password")
    assert resp.status_code == 200
    temp = resp.json()["temporaryPassword"]
    assert PATTERN.match(temp)

    # That old session is locked out now, except for changing the password.
    locked = await token_client.get("/trips")
    assert (locked.status_code, locked.json()["detail"]) == (403, "PASSWORD_CHANGE_REQUIRED")
    assert (await token_client.get("/users/me")).status_code == 200
    assert (await _login(anon_client, test_user.email, temp)).status_code == 200
    changed = await token_client.post(
        "/auth/change-password", json={"currentPassword": temp, "newPassword": "mine again"}
    )
    assert changed.status_code == 200
    assert (await token_client.get("/trips")).status_code == 200


async def test_resets_need_a_real_user_and_not_yourself(
    admin_client: AsyncClient, admin_user: UserRecord
) -> None:
    assert (
        await admin_client.post(f"/admin/users/{admin_user.id}/reset-password")
    ).status_code == 409
    missing = "00000000-0000-0000-0000-000000000000"
    assert (await admin_client.post(f"/admin/users/{missing}/reset-password")).status_code == 404


async def test_a_new_password_has_to_be_right_and_good(
    admin_client: AsyncClient, anon_client: AsyncClient
) -> None:
    invited = await _invite(admin_client)
    temp = invited["temporaryPassword"]
    token = (await _login(anon_client, "inlaw@example.com", temp)).json()["access_token"]

    async def change(current: str, new: str) -> Any:
        return await anon_client.post(
            "/auth/change-password",
            json={"currentPassword": current, "newPassword": new},
            headers=_bearer(token),
        )

    assert (await change("wrong", "a better one")).status_code == 400
    assert (await change(temp, "short")).status_code == 422
    assert (await change(temp, temp)).status_code == 422
    assert (await change(temp, "changeme-inlaw")).status_code == 422
    # Still locked after the failures.
    assert (await anon_client.get("/trips", headers=_bearer(token))).status_code == 403
    assert (await change(temp, "a better one")).status_code == 200


async def test_photos_still_serve_without_a_login_but_uploads_are_gated(
    client: AsyncClient, db: AsyncSession, test_user: UserRecord
) -> None:
    test_user.must_change_password = True
    await db.commit()
    resp = await client.post(
        "/trips/00000000-0000-0000-0000-000000000000/memories/00000000-0000-0000-0000-000000000000/photos",
        files={"file": ("a.jpg", b"x", "image/jpeg")},
    )
    assert resp.status_code == 403
    # Serving is login-free (a 404 for an unknown photo, not a 401/403).
    assert (
        await client.get("/photos/00000000-0000-0000-0000-000000000000/thumb")
    ).status_code == 404


async def test_public_sign_up_is_closed(anon_client: AsyncClient) -> None:
    resp = await anon_client.post(
        "/auth/register", json={"email": "anyone@example.com", "password": "whatever123"}
    )
    assert resp.status_code in (404, 405)
