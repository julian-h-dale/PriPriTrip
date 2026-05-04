import json
from unittest.mock import patch

import pytest
from fastapi.testclient import TestClient

from main import app, make_token, verify_token

client = TestClient(app)


# ---------------------------------------------------------------------------
# make_token / verify_token unit tests
# ---------------------------------------------------------------------------


class TestMakeToken:
    def test_returns_64_char_hex_string(self):
        token = make_token("password", "secret")
        assert isinstance(token, str)
        assert len(token) == 64

    def test_is_deterministic(self):
        assert make_token("password", "secret") == make_token("password", "secret")

    def test_different_passwords_produce_different_tokens(self):
        assert make_token("abc", "secret") != make_token("xyz", "secret")

    def test_different_secrets_produce_different_tokens(self):
        assert make_token("password", "secret1") != make_token("password", "secret2")


class TestVerifyToken:
    def test_valid_token_accepted(self):
        token = make_token("honeymoon", "mysecret")
        assert verify_token(token, "honeymoon", "mysecret") is True

    def test_wrong_token_rejected(self):
        assert verify_token("badtoken", "honeymoon", "mysecret") is False

    def test_token_from_wrong_secret_rejected(self):
        token = make_token("honeymoon", "secret1")
        assert verify_token(token, "honeymoon", "secret2") is False

    def test_token_from_wrong_password_rejected(self):
        token = make_token("wrongpassword", "mysecret")
        assert verify_token(token, "honeymoon", "mysecret") is False


# ---------------------------------------------------------------------------
# POST /auth endpoint tests
# ---------------------------------------------------------------------------


class TestApiAuth:
    @patch.dict(
        "os.environ",
        {"APP_PASSWORD": "honeymoon", "TOKEN_SECRET": "testsecret", "MAPS_API_KEY": "testmapskey"},
    )
    def test_correct_password_returns_200_with_token_and_maps_key(self):
        resp = client.post("/auth", json={"password": "honeymoon"})
        assert resp.status_code == 200
        body = resp.json()
        assert "token" in body
        assert body["mapsApiKey"] == "testmapskey"

    @patch.dict(
        "os.environ",
        {"APP_PASSWORD": "honeymoon", "TOKEN_SECRET": "testsecret", "MAPS_API_KEY": ""},
    )
    def test_returned_token_is_verifiable(self):
        resp = client.post("/auth", json={"password": "honeymoon"})
        body = resp.json()
        assert verify_token(body["token"], "honeymoon", "testsecret") is True

    @patch.dict("os.environ", {"APP_PASSWORD": "honeymoon", "TOKEN_SECRET": "testsecret"})
    def test_wrong_password_returns_401(self):
        resp = client.post("/auth", json={"password": "wrongpassword"})
        assert resp.status_code == 401

    @patch.dict("os.environ", {"APP_PASSWORD": "honeymoon", "TOKEN_SECRET": "testsecret"})
    def test_missing_password_field_returns_422(self):
        resp = client.post("/auth", json={})
        assert resp.status_code == 422

    def test_invalid_json_body_returns_422(self):
        resp = client.post("/auth", content=b"not-json", headers={"Content-Type": "application/json"})
        assert resp.status_code == 422

    @patch.dict("os.environ", {"APP_PASSWORD": "honeymoon", "TOKEN_SECRET": "testsecret"})
    def test_response_content_type_is_json(self):
        resp = client.post("/auth", json={"password": "honeymoon"})
        assert "application/json" in resp.headers["content-type"]
