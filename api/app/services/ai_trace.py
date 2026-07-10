from __future__ import annotations

from datetime import datetime, timezone
import json
import logging
from logging.handlers import RotatingFileHandler
import os
from pathlib import Path
from typing import Any

from pydantic import BaseModel

_LOGGER_NAME = "app.ai"


def _default_log_path() -> Path:
    # api/app/services -> api root is parents[2]
    return Path(__file__).resolve().parents[2] / "ai.log"


def _resolve_log_path() -> Path:
    configured = os.environ.get("AI_LOG_PATH", "").strip()
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

    level_name = os.environ.get("AI_LOG_LEVEL", "INFO").upper()
    level = getattr(logging, level_name, logging.INFO)

    max_bytes = int(os.environ.get("AI_LOG_MAX_BYTES", "10485760"))
    backup_count = int(os.environ.get("AI_LOG_BACKUP_COUNT", "3"))
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
        "timestampUtc": datetime.now(timezone.utc).isoformat().replace("+00:00", "Z"),
        "event": event,
        **{k: _normalize(v) for k, v in data.items()},
    }
    logger.info(json.dumps(payload, ensure_ascii=True, default=str))
