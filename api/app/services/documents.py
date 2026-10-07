"""Trip documents: files kept with a trip as a hard-copy fallback
(models.TripDocument). Upload before the trip; download everything as one
zip before leaving. No versions: uploading again replaces the file.
"""

from __future__ import annotations

import datetime as dt
import re
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePath

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.document_store import DocumentStore
from app.models import TripDocument, UserRecord
from app.schemas import DocumentRead

MAX_UPLOAD_BYTES = 25 * 1024 * 1024  # under nginx's 26 MB request cap

# What can be kept: the file types travel paperwork comes in. The type is
# decided by the extension (what the phone will open it with), not by what
# the browser claims.
TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".heic": "image/heic",
    ".webp": "image/webp",
    ".gif": "image/gif",
    ".doc": "application/msword",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xls": "application/vnd.ms-excel",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".csv": "text/csv",
}


class UnsupportedType(Exception):
    """Not a file type we keep (415)."""


class EmptyFile(Exception):
    """A zero-byte upload (422)."""


@dataclass
class Upload:
    filename: str
    data: bytes


def _clean_filename(raw: str | None) -> str:
    """The uploaded file's own name, without any folders, kept short."""
    name = PurePath((raw or "").replace("\\", "/")).name.strip() or "document"
    return name[-150:]


def _extension(filename: str) -> str:
    return PurePath(filename).suffix.lower()


def _check(upload: Upload) -> tuple[str, str]:
    """(clean filename, content type), or raises."""
    filename = _clean_filename(upload.filename)
    content_type = TYPES.get(_extension(filename))
    if content_type is None:
        raise UnsupportedType(filename)
    if not upload.data:
        raise EmptyFile(filename)
    return filename, content_type


async def _names(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, str]:
    """Uploaders' names (a trip has one or two people adding documents)."""
    names: dict[uuid.UUID, str] = {}
    for uid in ids:
        user = await db.get(UserRecord, uid)
        if user is not None:
            names[uid] = user.name or user.email.split("@")[0]
    return names


async def read_all(db: AsyncSession, docs: list[TripDocument]) -> list[DocumentRead]:
    names = await _names(db, {d.uploaded_by for d in docs})
    return [
        DocumentRead.model_validate(d).model_copy(
            update={"uploaded_by_name": names.get(d.uploaded_by)}
        )
        for d in docs
    ]


async def list_documents(db: AsyncSession, trip_id: uuid.UUID) -> list[TripDocument]:
    """The trip's live documents, A to Z by name."""
    rows = await db.scalars(
        select(TripDocument).where(
            TripDocument.trip_id == trip_id, TripDocument.is_deleted.is_(False)
        )
    )
    return sorted(rows, key=lambda d: d.name.casefold())


async def get_document(
    db: AsyncSession, trip_id: uuid.UUID, document_id: uuid.UUID
) -> TripDocument | None:
    return await db.scalar(
        select(TripDocument).where(
            TripDocument.id == document_id,
            TripDocument.trip_id == trip_id,
            TripDocument.is_deleted.is_(False),
        )
    )


async def add_document(
    db: AsyncSession,
    store: DocumentStore,
    trip_id: uuid.UUID,
    user: UserRecord,
    upload: Upload,
    name: str | None,
) -> TripDocument:
    """Keep a new file with the trip. Its name defaults to the file's name
    without the extension."""
    filename, content_type = _check(upload)
    doc = TripDocument(
        id=uuid.uuid4(),
        trip_id=trip_id,
        name=name or PurePath(filename).stem or "Document",
        filename=filename,
        content_type=content_type,
        size=len(upload.data),
        uploaded_by=user.id,
    )
    store.save(trip_id, doc.id, upload.data)
    db.add(doc)
    await db.commit()
    return doc


async def replace_file(
    db: AsyncSession, store: DocumentStore, doc: TripDocument, user: UserRecord, upload: Upload
) -> TripDocument:
    """Swap the document's file for a new one; its name stays."""
    filename, content_type = _check(upload)
    store.save(doc.trip_id, doc.id, upload.data)
    doc.filename = filename
    doc.content_type = content_type
    doc.size = len(upload.data)
    doc.uploaded_by = user.id
    doc.updated_at = dt.datetime.now(dt.UTC)
    await db.commit()
    return doc


async def rename(db: AsyncSession, doc: TripDocument, name: str) -> TripDocument:
    doc.name = name
    await db.commit()
    return doc


async def delete(db: AsyncSession, doc: TripDocument) -> None:
    """Soft delete. The file stays on disk, so a mistake can be undone."""
    doc.is_deleted = True
    doc.deleted_at = dt.datetime.now(dt.UTC)
    await db.commit()


_UNSAFE = re.compile(r'[\\/:*?"<>|\x00-\x1f]+')


def safe_name(name: str) -> str:
    """A name that's fine as a file name on a phone, a Mac or Windows."""
    return _UNSAFE.sub("-", name).strip(" .") or "document"


def download_name(doc: TripDocument) -> str:
    """`<name>.<ext>`: the app's name for it, with the file's own extension."""
    return safe_name(doc.name) + _extension(doc.filename)


def build_zip(store: DocumentStore, docs: list[TripDocument]) -> Path:
    """Every document's file in one zip, in a temp file the caller deletes.
    Stored, not compressed (PDFs and photos are already compressed), and
    written file by file, so memory stays flat however big the documents
    are. Two documents with the same name become "Ticket.pdf" and
    "Ticket (2).pdf". A document whose file is missing is skipped."""
    tmp = tempfile.NamedTemporaryFile(prefix="documents-", suffix=".zip", delete=False)
    tmp.close()
    used: set[str] = set()
    with zipfile.ZipFile(tmp.name, "w", compression=zipfile.ZIP_STORED) as zf:
        for doc in docs:
            path = store.path(doc.trip_id, doc.id)
            if path is None:
                continue
            base = safe_name(doc.name)
            ext = _extension(doc.filename)
            arcname, n = f"{base}{ext}", 1
            while arcname.casefold() in used:
                n += 1
                arcname = f"{base} ({n}){ext}"
            used.add(arcname.casefold())
            zf.write(path, arcname)
    return Path(tmp.name)
