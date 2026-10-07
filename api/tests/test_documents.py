"""Trip documents: the owner and editors keep files with a trip and download
them all as one zip. No versions: uploading again replaces the file."""

from __future__ import annotations

import io
import zipfile
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient

from app.sample_data import load_sample_trip
from app.services import documents as documents_service
from app.settings import get_app_settings
from tests.test_sharing import edited_trip, shared_trip

Json = dict[str, Any]
PDF = b"%PDF-1.4 a ticket"


@pytest.fixture(autouse=True)
def document_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "documents"
    monkeypatch.setattr(get_app_settings(), "document_dir", str(root))
    return root


async def a_trip(client: AsyncClient) -> str:
    return str((await client.post("/trips/import", json=load_sample_trip())).json()["id"])


async def upload(
    client: AsyncClient, tid: str, filename: str, data: bytes = PDF, name: str | None = None
) -> Any:
    form = {"name": name} if name is not None else None
    return await client.post(
        f"/trips/{tid}/documents",
        files={"file": (filename, data, "application/octet-stream")},
        data=form,
    )


async def test_upload_list_and_download(client: AsyncClient) -> None:
    tid = await a_trip(client)
    resp = await upload(client, tid, "Flight ticket.pdf")
    assert resp.status_code == 201, resp.text
    doc = resp.json()
    assert doc | {"id": "x", "updatedAt": "x"} == {
        "id": "x",
        "name": "Flight ticket",
        "filename": "Flight ticket.pdf",
        "contentType": "application/pdf",
        "size": len(PDF),
        "updatedAt": "x",
        "uploadedByName": "Test User",
    }
    await upload(
        client, tid, "c:\\Users\\me\\passport.JPG", b"\xff\xd8 jpeg", name="  Passport  scan "
    )

    listed = (await client.get(f"/trips/{tid}/documents")).json()
    assert [(d["name"], d["contentType"]) for d in listed] == [
        ("Flight ticket", "application/pdf"),
        ("Passport scan", "image/jpeg"),
    ]
    assert listed[1]["filename"] == "passport.JPG"  # no folders

    file = await client.get(f"/trips/{tid}/documents/{doc['id']}/file")
    assert file.status_code == 200
    assert file.content == PDF
    assert file.headers["content-type"] == "application/pdf"
    assert file.headers["content-disposition"] == "attachment; filename*=utf-8''Flight%20ticket.pdf"


async def test_replace_swaps_the_file_and_keeps_the_name(client: AsyncClient) -> None:
    tid = await a_trip(client)
    doc = (await upload(client, tid, "ticket.pdf", name="Ferry")).json()
    resp = await client.put(
        f"/trips/{tid}/documents/{doc['id']}/file",
        files={"file": ("ferry-v2.png", b"\x89PNG new", "image/png")},
    )
    assert resp.status_code == 200, resp.text
    new = resp.json()
    assert (new["name"], new["filename"], new["contentType"], new["size"]) == (
        "Ferry",
        "ferry-v2.png",
        "image/png",
        8,
    )
    assert (await client.get(f"/trips/{tid}/documents/{doc['id']}/file")).content == b"\x89PNG new"
    assert len((await client.get(f"/trips/{tid}/documents")).json()) == 1


async def test_rename_and_delete(client: AsyncClient) -> None:
    tid = await a_trip(client)
    doc = (await upload(client, tid, "a.pdf")).json()
    url = f"/trips/{tid}/documents/{doc['id']}"
    assert (await client.patch(url, json={"name": "Hotel booking"})).json()[
        "name"
    ] == "Hotel booking"
    assert (await client.patch(url, json={"name": "   "})).status_code == 422
    assert (await client.delete(url)).status_code == 204
    assert (await client.get(f"/trips/{tid}/documents")).json() == []
    assert (await client.get(f"{url}/file")).status_code == 404
    assert (await client.patch(url, json={"name": "Back"})).status_code == 404


async def test_the_zip_holds_every_live_document(client: AsyncClient) -> None:
    tid = await a_trip(client)
    await upload(client, tid, "one.pdf", b"%PDF one", name="Ticket")
    await upload(client, tid, "two.pdf", b"%PDF two", name="Ticket")
    await upload(client, tid, "x.png", b"\x89PNG", name="Map: old/town")
    gone = (await upload(client, tid, "gone.pdf", name="Deleted")).json()
    await client.delete(f"/trips/{tid}/documents/{gone['id']}")

    resp = await client.get(f"/trips/{tid}/documents.zip")
    assert resp.status_code == 200
    assert resp.headers["content-type"] == "application/zip"
    assert resp.headers["content-disposition"].endswith(
        "Bern%20%26%20Wengen%20Long%20Weekend%20documents.zip"
    )
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        names = sorted(zf.namelist())
        assert names == ["Map- old-town.png", "Ticket (2).pdf", "Ticket.pdf"]
        assert {zf.read("Ticket.pdf"), zf.read("Ticket (2).pdf")} == {b"%PDF one", b"%PDF two"}


async def test_an_empty_trip_gives_an_empty_zip(client: AsyncClient) -> None:
    tid = await a_trip(client)
    resp = await client.get(f"/trips/{tid}/documents.zip")
    with zipfile.ZipFile(io.BytesIO(resp.content)) as zf:
        assert zf.namelist() == []


async def test_limits(client: AsyncClient, monkeypatch: pytest.MonkeyPatch) -> None:
    tid = await a_trip(client)
    assert (await upload(client, tid, "virus.exe", b"MZ")).status_code == 415
    assert (await upload(client, tid, "noextension", b"x")).status_code == 415
    assert (await upload(client, tid, "empty.pdf", b"")).status_code == 422
    monkeypatch.setattr(documents_service, "MAX_UPLOAD_BYTES", 10)
    assert (await upload(client, tid, "big.pdf", b"x" * 11)).status_code == 413
    assert (await client.get(f"/trips/{tid}/documents")).json() == []


async def test_editors_can_viewers_and_strangers_cannot(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient
) -> None:
    # An editor works with documents like the owner.
    trip = await edited_trip(client, viewer)
    tid = trip["id"]
    doc = (await upload(viewer, tid, "editor.pdf")).json()
    assert [d["name"] for d in (await client.get(f"/trips/{tid}/documents")).json()] == ["editor"]
    assert (await stranger.get(f"/trips/{tid}/documents")).status_code == 404
    assert (await stranger.get(f"/trips/{tid}/documents/{doc['id']}/file")).status_code == 404
    assert (await stranger.get(f"/trips/{tid}/documents.zip")).status_code == 404


async def test_viewers_are_refused(client: AsyncClient, viewer: AsyncClient) -> None:
    trip = await shared_trip(client, viewer)
    tid = trip["id"]
    doc = (await upload(client, tid, "passport.pdf")).json()
    for resp in (
        await viewer.get(f"/trips/{tid}/documents"),
        await viewer.get(f"/trips/{tid}/documents/{doc['id']}/file"),
        await viewer.get(f"/trips/{tid}/documents.zip"),
        await upload(viewer, tid, "mine.pdf"),
        await viewer.delete(f"/trips/{tid}/documents/{doc['id']}"),
    ):
        assert resp.status_code == 403


async def test_signed_out_is_401(anon_client: AsyncClient, client: AsyncClient) -> None:
    tid = await a_trip(client)
    assert (await anon_client.get(f"/trips/{tid}/documents")).status_code == 401
    assert (await anon_client.get(f"/trips/{tid}/documents.zip")).status_code == 401
