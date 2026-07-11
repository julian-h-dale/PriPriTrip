"""Auth behavior tests.

The custom /auth/session endpoints construct their own DB session internally
(bypassing dependency injection), so credential flows can't be faked here yet —
they get full coverage when they move onto Depends(get_user_manager) (see
review.md 1C-1). What we can and do verify now:

- protected endpoints reject unauthenticated requests
- /health is open
"""

from fastapi.testclient import TestClient

from app.main import app

client = TestClient(app)


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
