"""Where journal photo files live: a directory on disk (a Fly volume in
production), behind a tiny interface so moving to object storage later
(Tigris on Fly, S3-compatible) is a new class, not a rewrite.

Layout:  <root>/<trip id>/<photo id>/{original.<ext>, display.jpg, thumb.jpg}
"""

from __future__ import annotations

import shutil
import uuid
from pathlib import Path
from typing import Literal, Protocol

from app.settings import get_app_settings

Variant = Literal["original", "display", "thumb"]


class PhotoStore(Protocol):
    def save(self, trip_id: uuid.UUID, photo_id: uuid.UUID, name: str, data: bytes) -> None: ...

    def path(self, trip_id: uuid.UUID, photo_id: uuid.UUID, name: str) -> Path | None: ...

    def delete(self, trip_id: uuid.UUID, photo_id: uuid.UUID) -> None: ...


class LocalPhotoStore:
    """Files under a root directory. Writes go to a temp file then rename, so
    a crash never leaves a half-written photo behind."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def _dir(self, trip_id: uuid.UUID, photo_id: uuid.UUID) -> Path:
        return self.root / str(trip_id) / str(photo_id)

    def save(self, trip_id: uuid.UUID, photo_id: uuid.UUID, name: str, data: bytes) -> None:
        folder = self._dir(trip_id, photo_id)
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / f".{name}.tmp"
        tmp.write_bytes(data)
        tmp.replace(folder / name)

    def path(self, trip_id: uuid.UUID, photo_id: uuid.UUID, name: str) -> Path | None:
        candidate = self._dir(trip_id, photo_id) / name
        return candidate if candidate.is_file() else None

    def delete(self, trip_id: uuid.UUID, photo_id: uuid.UUID) -> None:
        shutil.rmtree(self._dir(trip_id, photo_id), ignore_errors=True)


def get_photo_store() -> PhotoStore:
    """The configured store (PHOTO_DIR). A FastAPI dependency, so tests can
    point it at a temporary directory."""
    return LocalPhotoStore(get_app_settings().photo_dir)
