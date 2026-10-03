"""The server-side Places client: the two-step photo lookup, best-effort on
any failure. No real network call — a MockTransport stands in for Google."""

from __future__ import annotations

import httpx
import pytest

from app.google_places_server import fetch_first_photo_url, find_place_id
from app.settings import get_app_settings


def _handler(request: httpx.Request) -> httpx.Response:
    path = request.url.path
    if path == "/v1/places/with-photo":
        return httpx.Response(200, json={"photos": [{"name": "places/with-photo/photos/p1"}]})
    if path == "/v1/places/with-photo/photos/p1/media":
        return httpx.Response(200, json={"photoUri": "https://example.com/photo.jpg"})
    if path == "/v1/places/no-photo":
        return httpx.Response(200, json={"photos": []})
    if path == "/v1/places/denied":
        return httpx.Response(403, json={"error": {"message": "denied"}})
    if path == "/v1/places:searchText":
        body = request.content.decode()
        if "findable" in body:
            return httpx.Response(200, json={"places": [{"id": "with-photo"}]})
        if "no-match" in body:
            return httpx.Response(200, json={"places": []})
        if "errors-out" in body:
            return httpx.Response(500, json={"error": {"message": "boom"}})
        raise AssertionError(f"unexpected search query: {body}")
    raise AssertionError(f"unexpected request to {path}")


@pytest.fixture(autouse=True)
def _mock_google(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "test-key")
    real_client = httpx.AsyncClient

    def fake_client(*args: object, **kwargs: object) -> httpx.AsyncClient:
        kwargs.pop("timeout", None)
        return real_client(transport=httpx.MockTransport(_handler), **kwargs)  # type: ignore[arg-type]

    monkeypatch.setattr("app.google_places_server.httpx.AsyncClient", fake_client)


async def test_returns_the_first_photos_url() -> None:
    assert await fetch_first_photo_url("with-photo") == "https://example.com/photo.jpg"


async def test_none_when_the_place_has_no_photos() -> None:
    assert await fetch_first_photo_url("no-photo") is None


async def test_none_on_an_api_error_rather_than_raising() -> None:
    assert await fetch_first_photo_url("denied") is None


async def test_none_without_a_place_id_or_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    assert await fetch_first_photo_url("") is None
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "")
    assert await fetch_first_photo_url("with-photo") is None


async def test_find_place_id_returns_the_top_match() -> None:
    assert await find_place_id("findable hotel") == "with-photo"


async def test_find_place_id_none_when_nothing_matches() -> None:
    assert await find_place_id("no-match hotel") is None


async def test_find_place_id_none_on_an_api_error() -> None:
    assert await find_place_id("errors-out hotel") is None


async def test_find_place_id_none_without_a_query_or_a_key(monkeypatch: pytest.MonkeyPatch) -> None:
    assert await find_place_id("") is None
    monkeypatch.setattr(get_app_settings(), "google_maps_api_key", "")
    assert await find_place_id("findable hotel") is None
