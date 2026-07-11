"""Centralised application settings (review.md 1C-4).

All configuration comes through here instead of scattered `os.environ.get`
calls. Values are read from the process environment first, then from an
optional `.env` file in the working directory. `jwt_secret` has no default so
the app fails fast when it is missing.
"""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5433/pripritrip"
    jwt_secret: str  # required — a defaulted signing secret would let anyone forge tokens
    maps_api_key: str = ""
    cors_origins: str = "http://localhost:3000,http://localhost:5173"

    openai_api_key: str = ""
    openai_model: str = "gpt-5.4"
    openai_timeout: float = 120.0
    openai_max_retries: int = 2

    # Chat assistant dispatch: "loop" = tool-calling loop (chat_tool_loop.py),
    # "batch" = legacy one-shot structured-output workflows (kill switch).
    chat_assistant_mode: str = "loop"

    app_log_level: str = "INFO"

    ai_log_path: str = ""
    ai_log_level: str = "INFO"
    ai_log_max_bytes: int = 10_485_760
    ai_log_backup_count: int = 3


@lru_cache
def get_settings() -> Settings:
    return Settings()
