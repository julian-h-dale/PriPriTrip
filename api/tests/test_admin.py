"""Authorisation tests for the admin router.

These assert *authorisation* (who may call the endpoint), so they use the
token-based fixtures rather than the override-based `client` — the override
only covers `current_active_user`, not `current_superuser`.
"""

from __future__ import annotations

from httpx import AsyncClient


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
