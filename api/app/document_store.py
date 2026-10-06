"""Where trip document files live: a directory on disk (the Fly volume in
production), one file per document, behind the same small interface as the
PhotoStore so object storage later is a new class, not a rewrite.

Layout:  <root>/<trip id>/<document id>
"""

from __future__ import annotations

import uuid
from pathlib import Path
from typing import Protocol

from app.settings import get_app_settings


class DocumentStore(Protocol):
    def save(self, trip_id: uuid.UUID, document_id: uuid.UUID, data: bytes) -> None: ...

    def path(self, trip_id: uuid.UUID, document_id: uuid.UUID) -> Path | None: ...


class LocalDocumentStore:
    """Files under a root directory. A write goes to a temp file and is renamed
    over the old one, so a replace never leaves a half-written document."""

    def __init__(self, root: str | Path) -> None:
        self.root = Path(root)

    def save(self, trip_id: uuid.UUID, document_id: uuid.UUID, data: bytes) -> None:
        folder = self.root / str(trip_id)
        folder.mkdir(parents=True, exist_ok=True)
        tmp = folder / f".{document_id}.tmp"
        tmp.write_bytes(data)
        tmp.replace(folder / str(document_id))

    def path(self, trip_id: uuid.UUID, document_id: uuid.UUID) -> Path | None:
        candidate = self.root / str(trip_id) / str(document_id)
        return candidate if candidate.is_file() else None


def get_document_store() -> DocumentStore:
    """The configured store (DOCUMENT_DIR). A FastAPI dependency, so tests can
    point it at a temporary directory."""
    return LocalDocumentStore(get_app_settings().document_dir)
