from __future__ import annotations

import json
import logging
from datetime import UTC, datetime
from logging.handlers import RotatingFileHandler
from pathlib import Path
from typing import Any

from pydantic import BaseModel

from app.settings import get_settings

_LOGGER_NAME = "app.ai"


def _default_log_path() -> Path:
    # api/app/services -> api root is parents[2]
    return Path(__file__).resolve().parents[2] / "ai.log"


def _resolve_log_path() -> Path:
    configured = get_settings().ai_log_path.strip()
    if not configured:
        return _default_log_path()
    path = Path(configured)
    if not path.is_absolute():
        path = _default_log_path().parent / path
    return path


def get_ai_logger() -> logging.Logger:
    logger = logging.getLogger(_LOGGER_NAME)
    if logger.handlers:
        return logger

    settings = get_settings()
    level_name = settings.ai_log_level.upper()
    level = getattr(logging, level_name, logging.INFO)

    max_bytes = settings.ai_log_max_bytes
    backup_count = settings.ai_log_backup_count
    log_path = _resolve_log_path()
    log_path.parent.mkdir(parents=True, exist_ok=True)

    handler = RotatingFileHandler(
        filename=log_path,
        maxBytes=max_bytes,
        backupCount=backup_count,
        encoding="utf-8",
    )
    # Each line is a standalone JSON payload for easy grep/jq parsing.
    handler.setFormatter(logging.Formatter("%(message)s"))

    logger.setLevel(level)
    logger.addHandler(handler)
    logger.propagate = False
    return logger


def _normalize(value: Any) -> Any:
    if isinstance(value, BaseModel):
        return value.model_dump(mode="json")
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, dict):
        return {str(k): _normalize(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [_normalize(v) for v in value]
    return value


def log_ai_event(event: str, **data: Any) -> None:
    logger = get_ai_logger()
    payload = {
        "timestampUtc": datetime.now(UTC).isoformat().replace("+00:00", "Z"),
        "event": event,
        **{k: _normalize(v) for k, v in data.items()},
    }
    logger.info(json.dumps(payload, ensure_ascii=True, default=str))
