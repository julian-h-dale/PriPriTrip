import hashlib
import hmac
import os
from typing import Optional

from fastapi import HTTPException, Security, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

_security = HTTPBearer(auto_error=False)


def make_token(password: str, secret: str) -> str:
    # HMAC-SHA256 used to generate a *bearer token*, not to store a password.
    # The password is verified separately via hmac.compare_digest (see login route).
    return hmac.new(secret.encode(), password.encode(), hashlib.sha256).hexdigest()


def verify_token(token: str, app_password: str, secret: str) -> bool:
    expected = make_token(app_password, secret)
    return hmac.compare_digest(expected, token)


def require_auth(
    credentials: Optional[HTTPAuthorizationCredentials] = Security(_security),
) -> None:
    if not credentials:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
    app_password = os.environ.get("APP_PASSWORD", "honeymoon")
    token_secret = os.environ.get("TOKEN_SECRET", "dev-secret-change-me")
    if not verify_token(credentials.credentials, app_password, token_secret):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unauthorized")
