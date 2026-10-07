"""Trip documents: files kept with a trip as a hard-copy fallback. The owner
and editors only (a viewer gets 403, as on every editing route); every route
needs sign-in, files included. Thin handlers — logic in
services/documents.py, access in app/dependencies.py."""

from __future__ import annotations

import asyncio
import os
from typing import Annotated

from fastapi import APIRouter, Depends, File, Form, HTTPException, Response, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.background import BackgroundTask

from app.database import get_db
from app.dependencies import get_editable_document, get_editable_trip
from app.document_store import DocumentStore, get_document_store
from app.models import Trip, TripDocument, UserRecord
from app.schemas import DocumentName, DocumentRead, DocumentRename
from app.services import documents as documents_service
from app.users import current_active_user

router = APIRouter(prefix="/trips/{trip_id}", tags=["documents"])


async def _upload(file: UploadFile) -> documents_service.Upload:
    data = await file.read(documents_service.MAX_UPLOAD_BYTES + 1)
    if len(data) > documents_service.MAX_UPLOAD_BYTES:
        raise HTTPException(
            status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, "Documents are limited to 25 MB"
        )
    return documents_service.Upload(file.filename or "", data)


def _refused(exc: Exception) -> HTTPException:
    if isinstance(exc, documents_service.UnsupportedType):
        return HTTPException(
            status.HTTP_415_UNSUPPORTED_MEDIA_TYPE,
            "Keep PDFs, photos, Word, Excel, PowerPoint, text or CSV files",
        )
    return HTTPException(status.HTTP_422_UNPROCESSABLE_ENTITY, "That file is empty")


_REFUSALS = (documents_service.UnsupportedType, documents_service.EmptyFile)


@router.get("/documents", response_model=list[DocumentRead])
async def list_documents(
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
) -> list[DocumentRead]:
    """The trip's documents, A to Z."""
    docs = await documents_service.list_documents(db, trip.id)
    return await documents_service.read_all(db, docs)


@router.post("/documents", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
async def add_document(
    file: Annotated[UploadFile, File()],
    name: Annotated[DocumentName | None, Form()] = None,
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    store: DocumentStore = Depends(get_document_store),
) -> DocumentRead:
    """Keep a file with the trip (25 MB at most). `name` defaults to the
    file's name without its extension."""
    upload = await _upload(file)
    try:
        doc = await documents_service.add_document(db, store, trip.id, user, upload, name)
    except _REFUSALS as exc:
        raise _refused(exc) from None
    return (await documents_service.read_all(db, [doc]))[0]


@router.put("/documents/{document_id}/file", response_model=DocumentRead)
async def replace_document_file(
    file: Annotated[UploadFile, File()],
    doc: TripDocument = Depends(get_editable_document),
    db: AsyncSession = Depends(get_db),
    user: UserRecord = Depends(current_active_user),
    store: DocumentStore = Depends(get_document_store),
) -> DocumentRead:
    """Replace the document's file with a new one. Its name stays."""
    upload = await _upload(file)
    try:
        doc = await documents_service.replace_file(db, store, doc, user, upload)
    except _REFUSALS as exc:
        raise _refused(exc) from None
    return (await documents_service.read_all(db, [doc]))[0]


@router.patch("/documents/{document_id}", response_model=DocumentRead)
async def rename_document(
    body: DocumentRename,
    doc: TripDocument = Depends(get_editable_document),
    db: AsyncSession = Depends(get_db),
) -> DocumentRead:
    doc = await documents_service.rename(db, doc, body.name)
    return (await documents_service.read_all(db, [doc]))[0]


@router.delete("/documents/{document_id}", status_code=status.HTTP_204_NO_CONTENT)
async def delete_document(
    doc: TripDocument = Depends(get_editable_document),
    db: AsyncSession = Depends(get_db),
) -> Response:
    await documents_service.delete(db, doc)
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/documents/{document_id}/file", response_class=FileResponse)
async def download_document(
    doc: TripDocument = Depends(get_editable_document),
    store: DocumentStore = Depends(get_document_store),
) -> FileResponse:
    """The document's file, as a download named `<name>.<ext>`."""
    path = store.path(doc.trip_id, doc.id)
    if path is None:
        raise HTTPException(status.HTTP_404_NOT_FOUND, "Not found")
    return FileResponse(
        path,
        media_type=doc.content_type,
        filename=documents_service.download_name(doc),
        headers={"Cache-Control": "no-store"},
    )


@router.get("/documents.zip", response_class=FileResponse)
async def download_all_documents(
    trip: Trip = Depends(get_editable_trip),
    db: AsyncSession = Depends(get_db),
    store: DocumentStore = Depends(get_document_store),
) -> FileResponse:
    """Every document in one zip, `<trip name> documents.zip`."""
    docs = await documents_service.list_documents(db, trip.id)
    path = await asyncio.to_thread(documents_service.build_zip, store, docs)
    return FileResponse(
        path,
        media_type="application/zip",
        filename=f"{documents_service.safe_name(trip.name)} documents.zip",
        headers={"Cache-Control": "no-store"},
        background=BackgroundTask(os.unlink, path),
    )
