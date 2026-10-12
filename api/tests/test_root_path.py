"""The API behind the container's nginx, which serves it under /api and
strips the prefix (deploy/nginx.conf): ROOT_PATH tells the API so."""

from __future__ import annotations

import pytest
from httpx import ASGITransport, AsyncClient

from app.main import create_app
from app.settings import get_app_settings


@pytest.mark.asyncio
async def test_docs_find_the_schema_under_the_prefix(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_app_settings(), "root_path", "/api")  # ROOT_PATH=/api
    app = create_app()
    # nginx has already stripped /api: requests arrive unprefixed.
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        docs = await client.get("/docs")
        assert docs.status_code == 200
        assert "'/api/openapi.json'" in docs.text

        schema = await client.get("/openapi.json")
        assert schema.status_code == 200
        # "Try it out" calls go back through the proxy.
        assert schema.json()["servers"] == [{"url": "/api"}]

        assert (await client.get("/health")).json() == {"status": "ok"}


@pytest.mark.asyncio
async def test_without_a_prefix_the_docs_are_at_the_root() -> None:
    app = create_app()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as client:
        assert "'/openapi.json'" in (await client.get("/docs")).text
