"""Authorisation tests for the admin router.

These assert *authorisation* (who may call the endpoint), so they use the
token-based fixtures rather than the override-based `client` — the override
only covers `current_active_user`, not `current_superuser`.
"""

from __future__ import annotations

from httpx import AsyncClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.models import UserRecord
from app.services import users as users_service
from tests.conftest import _token_client


async def test_admin_can_list_users(admin_client: AsyncClient) -> None:
    resp = await admin_client.get("/admin/users")
    assert resp.status_code == 200
    body = resp.json()
    assert isinstance(body, list)
    assert any(u["email"] == "admin@example.com" for u in body)


async def test_non_admin_forbidden(token_client: AsyncClient) -> None:
    resp = await token_client.get("/admin/users")
    assert resp.status_code == 403


async def test_anonymous_unauthorized(anon_client: AsyncClient) -> None:
    resp = await anon_client.get("/admin/users")
    assert resp.status_code == 401


# ---- making someone an admin of the app (Run stage 17) ----


async def test_an_admin_makes_someone_an_admin_and_takes_it_away(
    admin_client: AsyncClient, test_user: UserRecord
) -> None:
    url = f"/admin/users/{test_user.id}"
    resp = await admin_client.patch(url, json={"isSuperuser": True})
    assert resp.status_code == 200, resp.text
    assert resp.json()["is_superuser"] is True
    assert (await admin_client.get("/admin/users")).json()  # still listable
    # Two admins now, so either can be made a plain user again.
    resp = await admin_client.patch(url, json={"isSuperuser": False})
    assert resp.status_code == 200
    assert resp.json()["is_superuser"] is False


async def test_a_new_admin_can_use_the_admin_pages(
    db: AsyncSession, admin_client: AsyncClient, test_user: UserRecord
) -> None:
    await admin_client.patch(f"/admin/users/{test_user.id}", json={"isSuperuser": True})
    await db.refresh(test_user)
    async with await _token_client(db, test_user) as new_admin:
        assert (await new_admin.get("/admin/users")).status_code == 200


async def test_not_your_own_row(admin_client: AsyncClient, admin_user: UserRecord) -> None:
    resp = await admin_client.patch(f"/admin/users/{admin_user.id}", json={"isSuperuser": False})
    assert resp.status_code == 409
    assert resp.json()["detail"] == "You can't change your own role"


async def test_never_the_last_admin(
    db: AsyncSession, admin_client: AsyncClient, admin_user: UserRecord, test_user: UserRecord
) -> None:
    """With another admin, the first can be made a user by them; the last one never."""
    await admin_client.patch(f"/admin/users/{test_user.id}", json={"isSuperuser": True})
    await db.refresh(test_user)
    async with await _token_client(db, test_user) as other:
        resp = await other.patch(f"/admin/users/{admin_user.id}", json={"isSuperuser": False})
        assert resp.status_code == 200
        # Now `other` is the only admin: nobody can take theirs away (and not them).
        assert (
            await other.patch(f"/admin/users/{test_user.id}", json={"isSuperuser": False})
        ).status_code == 409
    # The service refuses the last one even without the own-row rule.
    await db.refresh(test_user)
    try:
        await users_service.set_admin(db, test_user, False)
    except users_service.LastAdmin:
        pass
    else:
        raise AssertionError("the last admin was made a user")


async def test_unknown_user_is_404(admin_client: AsyncClient) -> None:
    resp = await admin_client.patch(
        "/admin/users/00000000-0000-0000-0000-000000000000", json={"isSuperuser": True}
    )
    assert resp.status_code == 404


async def test_only_an_admin_may(
    token_client: AsyncClient, anon_client: AsyncClient, test_user: UserRecord
) -> None:
    url = f"/admin/users/{test_user.id}"
    assert (await token_client.patch(url, json={"isSuperuser": True})).status_code == 403
    assert (await anon_client.patch(url, json={"isSuperuser": True})).status_code == 401


# ---- the analytics switch (Run stage 18) ----


async def test_analytics_start_on_for_users_and_off_for_admins(
    db: AsyncSession, test_user: UserRecord, admin_user: UserRecord
) -> None:
    assert test_user.analytics_enabled is True
    assert admin_user.analytics_enabled is False
    user, _ = await users_service.invite(db, "new@example.com", "New")
    assert user.analytics_enabled is True


async def test_an_admin_turns_someones_analytics_off_and_on(
    admin_client: AsyncClient, test_user: UserRecord
) -> None:
    url = f"/admin/users/{test_user.id}"
    resp = await admin_client.patch(url, json={"analyticsEnabled": False})
    assert resp.status_code == 200, resp.text
    assert resp.json()["analytics_enabled"] is False
    assert resp.json()["is_superuser"] is False  # the role is left alone
    resp = await admin_client.patch(url, json={"analyticsEnabled": True})
    assert resp.json()["analytics_enabled"] is True


async def test_an_admin_can_change_their_own_analytics(
    admin_client: AsyncClient, admin_user: UserRecord
) -> None:
    """Unlike the role: it's how an admin keeps their testing out of the numbers."""
    url = f"/admin/users/{admin_user.id}"
    resp = await admin_client.patch(url, json={"analyticsEnabled": True})
    assert resp.status_code == 200
    assert resp.json()["analytics_enabled"] is True
    assert resp.json()["is_superuser"] is True


async def test_a_role_change_leaves_analytics_as_they_were(
    admin_client: AsyncClient, test_user: UserRecord
) -> None:
    url = f"/admin/users/{test_user.id}"
    resp = await admin_client.patch(url, json={"isSuperuser": True})
    assert resp.json()["analytics_enabled"] is True  # still on: set when made
    await admin_client.patch(url, json={"analyticsEnabled": False})
    resp = await admin_client.patch(url, json={"isSuperuser": False})
    assert resp.json()["analytics_enabled"] is False


async def test_a_refused_role_change_changes_nothing(
    admin_client: AsyncClient, admin_user: UserRecord
) -> None:
    resp = await admin_client.patch(
        f"/admin/users/{admin_user.id}", json={"isSuperuser": False, "analyticsEnabled": True}
    )
    assert resp.status_code == 409
    users = (await admin_client.get("/admin/users")).json()
    assert next(u for u in users if u["id"] == str(admin_user.id))["analytics_enabled"] is False


async def test_people_cant_change_their_own_analytics(
    token_client: AsyncClient, test_user: UserRecord
) -> None:
    """Only an admin flips it: /users/me ignores it, and /admin refuses."""
    await token_client.patch("/users/me", json={"analytics_enabled": False})
    assert (await token_client.get("/users/me")).json()["analytics_enabled"] is True
    resp = await token_client.patch(
        f"/admin/users/{test_user.id}", json={"analyticsEnabled": False}
    )
    assert resp.status_code == 403
