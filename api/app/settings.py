"""Application settings loaded from environment / .env files.

Grouped by concern and cached so the app fails fast when required
values (like JWT_SECRET) are missing.
"""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class AuthSettings(BaseSettings):
    jwt_secret: str  # no default — app refuses to boot without it
    jwt_expiry_hours: int = 24 * 7

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


class AppSettings(BaseSettings):
    app_name: str = "PriPriTrip API"
    database_url: str = "sqlite+aiosqlite:///./data/app.db"
    # Comma-separated list of allowed CORS origins.
    cors_origins: str = "http://localhost:3000"

    # Seed users — credentials come from env, never hardcoded secrets.
    seed_user_email: str = "user@example.com"
    seed_user_password: str = "changeme-user"
    seed_admin_email: str = "admin@example.com"
    seed_admin_password: str = "changeme-admin"

    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    @property
    def cors_origin_list(self) -> list[str]:
        return [origin.strip() for origin in self.cors_origins.split(",") if origin.strip()]


@lru_cache
def get_auth_settings() -> AuthSettings:
    return AuthSettings()


@lru_cache
def get_app_settings() -> AppSettings:
    return AppSettings()
