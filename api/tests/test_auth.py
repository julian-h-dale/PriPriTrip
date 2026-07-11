"""Auth behavior tests.

The custom /auth/session endpoints now go through Depends(get_user_manager)
(review.md 1C-1), so the credential flows are testable by overriding that one
dependency — no database, no monkeypatching of module attributes.
"""

import uuid

from fastapi_users import exceptions as fu_exc
from fastapi.testclient import TestClient
import pytest

from app.main import app
from app.settings import get_settings
from app.users import get_user_manager

client = TestClient(app)
# Lets us assert on a 500 instead of the exception bubbling out of the client.
raw_client = TestClient(app, raise_server_exceptions=False)


class _FakeUser:
    def __init__(self, is_active=True):
        self.id = uuid.UUID("11111111-1111-1111-1111-111111111111")
        self.email = "julian@example.com"
        self.is_active = is_active


class _FakeUserManager:
    """Stands in for fastapi-users' UserManager."""

    def __init__(self, *, user=None, authenticate_raises=None, create_raises=None):
        self.user = user
        self.authenticate_raises = authenticate_raises
        self.create_raises = create_raises
        self.credentials = None
        self.created = None

    async def authenticate(self, credentials):
        self.credentials = credentials
        if self.authenticate_raises:
            raise self.authenticate_raises
        return self.user

    async def create(self, body, safe=False, request=None):
        self.created = (body, safe)
        if self.create_raises:
            raise self.create_raises
        return self.user


@pytest.fixture
def manager():
    """Install a fake user manager; caller mutates it per test."""
    fake = _FakeUserManager()
    app.dependency_overrides[get_user_manager] = lambda: fake
    yield fake
    app.dependency_overrides.clear()


def _jwt_segments(token):
    return token.split(".")


class TestLoginSession:
    def test_valid_credentials_return_token_and_maps_key(self, manager):
        manager.user = _FakeUser()
        resp = client.post("/auth/session", json={"email": "julian@example.com", "password": "honeymoon"})

        assert resp.status_code == 200
        body = resp.json()
        assert len(_jwt_segments(body["token"])) == 3  # a real signed JWT
        assert body["mapsApiKey"] == get_settings().maps_api_key

    def test_email_and_password_reach_the_manager_as_oauth_form(self, manager):
        manager.user = _FakeUser()
        client.post("/auth/session", json={"email": "julian@example.com", "password": "honeymoon"})

        # The OAuth2 form calls the email field "username" — this mapping is
        # what the old type("_Creds", ...) hack was faking.
        assert manager.credentials.username == "julian@example.com"
        assert manager.credentials.password == "honeymoon"

    def test_bad_credentials_are_401(self, manager):
        manager.user = None  # authenticate() returns None for unknown user or wrong password
        resp = client.post("/auth/session", json={"email": "nobody@example.com", "password": "wrong-pass"})

        assert resp.status_code == 401
        assert resp.json()["detail"] == "Invalid email or password."

    def test_inactive_user_is_401(self, manager):
        manager.user = _FakeUser(is_active=False)
        resp = client.post("/auth/session", json={"email": "julian@example.com", "password": "honeymoon"})

        assert resp.status_code == 401

    def test_database_failure_is_not_reported_as_bad_credentials(self, manager):
        # The old code wrapped authenticate() in `except Exception: user = None`,
        # so a dead database looked exactly like a typo'd password (review 1C-1).
        manager.authenticate_raises = RuntimeError("connection refused")
        resp = raw_client.post("/auth/session", json={"email": "julian@example.com", "password": "honeymoon"})

        assert resp.status_code == 500
        assert resp.status_code != 401

    def test_missing_fields_are_422(self, manager):
        assert client.post("/auth/session", json={"email": "julian@example.com"}).status_code == 422


class TestRegisterSession:
    def _body(self, password="honeymoon"):
        return {"email": "new@example.com", "password": password, "name": "New User"}

    def test_registers_and_returns_token(self, manager):
        manager.user = _FakeUser()
        resp = client.post("/auth/register/session", json=self._body())

        assert resp.status_code == 200
        body = resp.json()
        assert len(_jwt_segments(body["token"])) == 3
        assert body["mapsApiKey"] == get_settings().maps_api_key
        created_body, safe = manager.created
        assert created_body.email == "new@example.com"
        assert safe is True  # safe=True keeps a client from self-granting is_superuser

    def test_duplicate_email_is_400(self, manager):
        manager.create_raises = fu_exc.UserAlreadyExists()
        resp = client.post("/auth/register/session", json=self._body())

        assert resp.status_code == 400
        assert "already exists" in resp.json()["detail"]

    def test_weak_password_is_400_not_500(self, manager):
        # validate_password() rejects < 8 chars; that exception used to escape
        # unhandled and 500'd.
        manager.create_raises = fu_exc.InvalidPasswordException(
            reason="Password must be at least 8 characters."
        )
        resp = raw_client.post("/auth/register/session", json=self._body(password="short"))

        assert resp.status_code == 400
        assert resp.json()["detail"] == "Password must be at least 8 characters."


class TestUnauthenticatedAccess:
    def test_health_is_open(self):
        resp = client.get("/health")
        assert resp.status_code == 200
        assert resp.json() == {"status": "ok"}

    def test_list_trips_requires_auth(self):
        assert client.get("/trips").status_code == 401

    def test_get_trip_requires_auth(self):
        assert client.get("/trips/some-trip").status_code == 401

    def test_create_trip_requires_auth(self):
        assert client.put("/trips/some-trip-id", json={}).status_code == 401

    def test_delete_trip_requires_auth(self):
        assert client.delete("/trips/some-trip").status_code == 401

    def test_days_require_auth(self):
        assert client.get("/trips/some-trip/days").status_code == 401

    def test_points_require_auth(self):
        assert client.get("/trips/some-trip/points").status_code == 401

    def test_details_require_auth(self):
        assert client.get("/trips/some-trip/travel-details").status_code == 401
        assert client.get("/trips/some-trip/stay-details").status_code == 401

    def test_chat_requires_auth(self):
        assert (
            client.post(
                "/chat/reply",
                json={"workflowName": "trip:new_trip", "message": "hi"},
            ).status_code
            == 401
        )

    def test_import_requires_auth(self):
        assert client.post("/trips/some-trip-id/import", json={}).status_code == 401

    def test_bad_token_rejected(self):
        resp = client.get("/trips", headers={"Authorization": "Bearer not-a-real-token"})
        assert resp.status_code == 401
