"""Journal photos: stored at full quality with display/thumbnail copies,
served by unguessable URL, added and removed only by the memory's author."""

from __future__ import annotations

import io
import uuid
from pathlib import Path
from typing import Any

import pytest
from httpx import AsyncClient
from PIL import Image, ImageCms

from app.sample_data import load_sample_trip
from app.settings import get_app_settings
from tests.test_sharing import edited_trip


@pytest.fixture(autouse=True)
def photo_dir(tmp_path: Path, monkeypatch: pytest.MonkeyPatch) -> Path:
    root = tmp_path / "photos"
    monkeypatch.setattr(get_app_settings(), "photo_dir", str(root))
    return root


def jpeg(
    width: int = 4000, height: int = 3000, *, orientation: int | None = None, gps: bool = False
) -> bytes:
    """A real JPEG, optionally shot 'sideways' (EXIF orientation) with GPS."""
    img = Image.new("RGB", (width, height), (200, 120, 40))
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    if gps:
        exif[0x8825] = {1: "N", 2: (46.0, 57.0, 0.0), 3: "E", 4: (7.0, 26.0, 0.0)}
    out = io.BytesIO()
    img.save(out, "JPEG", quality=90, exif=exif)
    return out.getvalue()


async def _memory(client: AsyncClient, trip_id: str) -> dict[str, Any]:
    resp = await client.post(
        f"/trips/{trip_id}/memories", json={"text": "with photos", "zone": "UTC"}
    )
    body: dict[str, Any] = resp.json()
    return body


async def _upload(
    client: AsyncClient, trip_id: str, memory_id: str, data: bytes, photo_id: str | None = None
):
    form = {"id": photo_id} if photo_id else {}
    return await client.post(
        f"/trips/{trip_id}/memories/{memory_id}/photos",
        files={"file": ("photo.jpg", data, "image/jpeg")},
        data=form,
    )


async def test_full_quality_original_plus_upright_exif_free_copies(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    original = jpeg(4000, 3000, orientation=6, gps=True)  # 6: rotate 90° to stand upright
    resp = await _upload(client, tid, memory["id"], original)
    assert resp.status_code == 201, resp.text
    photo = resp.json()
    assert (photo["width"], photo["height"]) == (3000, 4000)  # upright

    got = await client.get(photo["originalUrl"])
    assert got.status_code == 200
    assert got.content == original  # byte for byte, EXIF and all
    assert got.headers["content-type"] == "image/jpeg"
    assert "immutable" in got.headers["cache-control"]

    display = Image.open(io.BytesIO((await client.get(photo["displayUrl"])).content))
    assert display.size == (1920, 2560)  # long edge 2560, upright
    assert not display.getexif()  # no EXIF at all, so no GPS
    thumb = Image.open(io.BytesIO((await client.get(photo["thumbUrl"])).content))
    assert max(thumb.size) == 480 and thumb.size[1] > thumb.size[0]

    listed = (await client.get(f"/trips/{tid}/memories")).json()
    assert [p["id"] for p in listed[0]["photos"]] == [photo["id"]]


async def test_a_big_sideways_photo_keeps_its_full_size_profile_and_upright_copies(
    client: AsyncClient,
) -> None:
    """A 24 MP JPEG is decoded at half size to save memory (512 MB machine);
    what's stored and reported must not change because of it."""
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    img = Image.new("RGB", (5712, 4284), (200, 120, 40))
    img.paste((10, 20, 30), (0, 0, 200, 4284))  # a dark stripe down the left edge
    exif = Image.Exif()
    exif[0x0112] = 6  # stand upright by turning 90° clockwise: the left edge goes on top
    icc = ImageCms.ImageCmsProfile(ImageCms.createProfile("sRGB")).tobytes()
    out = io.BytesIO()
    img.save(out, "JPEG", quality=90, exif=exif, icc_profile=icc)
    resp = await _upload(client, tid, memory["id"], out.getvalue())
    assert resp.status_code == 201, resp.text
    photo = resp.json()
    assert (photo["width"], photo["height"]) == (4284, 5712)  # the original's, upright

    display = Image.open(io.BytesIO((await client.get(photo["displayUrl"])).content))
    assert display.size == (1920, 2560)
    assert display.info.get("icc_profile") == icc
    top, bottom = display.getpixel((960, 20)), display.getpixel((960, 2540))
    assert max(top) < 60 and min(bottom) > 30  # the stripe is on top: turned the right way
    thumb = Image.open(io.BytesIO((await client.get(photo["thumbUrl"])).content))
    assert thumb.size == (360, 480)
    assert thumb.info.get("icc_profile") == icc


async def test_small_photos_are_never_upscaled_and_png_transparency_is_flattened(
    client: AsyncClient,
) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    small = (await _upload(client, tid, memory["id"], jpeg(800, 600))).json()
    assert Image.open(io.BytesIO((await client.get(small["displayUrl"])).content)).size == (
        800,
        600,
    )

    png = io.BytesIO()
    Image.new("RGBA", (300, 200), (0, 0, 0, 0)).save(png, "PNG")
    resp = await client.post(
        f"/trips/{tid}/memories/{memory['id']}/photos",
        files={"file": ("clip.png", png.getvalue(), "image/png")},
    )
    assert resp.status_code == 201
    original = await client.get(resp.json()["originalUrl"])
    assert original.headers["content-type"] == "image/png"
    corner = Image.open(io.BytesIO((await client.get(resp.json()["displayUrl"])).content)).getpixel(
        (0, 0)
    )
    assert corner == (255, 255, 255)  # transparent became white, not black


async def test_heic_from_an_iphone_is_accepted(client: AsyncClient) -> None:
    import pillow_heif

    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    heif = pillow_heif.from_pillow(Image.new("RGB", (640, 480), (10, 100, 200)))
    out = io.BytesIO()
    heif.save(out, quality=80)
    resp = await client.post(
        f"/trips/{tid}/memories/{memory['id']}/photos",
        files={"file": ("IMG_0001.HEIC", out.getvalue(), "image/heic")},
    )
    assert resp.status_code == 201, resp.text
    assert (await client.get(resp.json()["originalUrl"])).headers["content-type"] == "image/heic"
    assert (await client.get(resp.json()["displayUrl"])).headers["content-type"] == "image/jpeg"


def mpo(width: int = 4032, height: int = 3024, *, orientation: int | None = None) -> bytes:
    """An iPhone camera photo as the in-app camera hands it over: a JPEG with
    a second, smaller image (the HDR gain map) — what Pillow calls MPO."""
    main = Image.new("RGB", (width, height), (200, 120, 40))
    gain_map = Image.new("L", (width // 4, height // 4), 128).convert("RGB")
    exif = Image.Exif()
    if orientation:
        exif[0x0112] = orientation
    exif[0x8825] = {1: "N", 2: (46.0, 57.0, 0.0), 3: "E", 4: (7.0, 26.0, 0.0)}
    out = io.BytesIO()
    main.save(out, "MPO", save_all=True, append_images=[gain_map], exif=exif, quality=90)
    return out.getvalue()


async def test_an_iphone_camera_photo_is_kept_whole_as_a_jpeg(client: AsyncClient) -> None:
    data = mpo(orientation=6)
    assert Image.open(io.BytesIO(data)).format == "MPO"
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    resp = await _upload(client, tid, memory["id"], data)
    assert resp.status_code == 201, resp.text
    photo = resp.json()
    assert (photo["width"], photo["height"]) == (3024, 4032)  # upright

    original = await client.get(photo["originalUrl"])
    assert original.headers["content-type"] == "image/jpeg"
    assert original.content == data  # byte-for-byte: gain map and EXIF kept

    display = Image.open(io.BytesIO((await client.get(photo["displayUrl"])).content))
    assert display.format == "JPEG"
    assert display.size == (1920, 2560)  # upright, display size
    assert not display.getexif()  # no GPS on the copies


def test_an_iphone_camera_photo_is_decoded_small(monkeypatch: pytest.MonkeyPatch) -> None:
    """Like any JPEG, so a 48 MP camera photo never exists at full size."""
    from PIL import JpegImagePlugin

    from app import photos

    drafted: list[tuple[int, int]] = []
    real_draft = JpegImagePlugin.JpegImageFile.draft

    def spy(self: Any, mode: Any, size: Any) -> Any:
        result = real_draft(self, mode, size)
        drafted.append(self.size)
        return result

    monkeypatch.setattr(JpegImagePlugin.JpegImageFile, "draft", spy)
    processed = photos.process(mpo(8064, 6048))
    # Decoded at half size, never at 8064 x 6048 (Pillow's own thumbnail()
    # drafts too, but for a size that would leave this photo full size).
    assert drafted and set(drafted) == {(4032, 3024)}
    assert (processed.format, processed.width, processed.height) == ("jpeg", 8064, 6048)


async def test_what_isnt_a_photo_or_is_too_big_is_refused(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    assert (await _upload(client, tid, memory["id"], b"%PDF-1.4 not a photo")).status_code == 422
    assert (
        await _upload(client, tid, memory["id"], b"\xff" * (25 * 1024 * 1024 + 1))
    ).status_code == 413
    gif = io.BytesIO()
    Image.new("RGB", (10, 10)).save(gif, "GIF")
    assert (await _upload(client, tid, memory["id"], gif.getvalue())).status_code == 422


async def test_at_most_ten_per_memory_and_a_retry_never_duplicates(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    pid = str(uuid.uuid4())
    first = await _upload(client, tid, memory["id"], jpeg(64, 48), pid)
    again = await _upload(client, tid, memory["id"], jpeg(64, 48), pid)
    assert (first.status_code, again.status_code) == (201, 200)
    assert again.json() == first.json()
    for _ in range(9):
        assert (await _upload(client, tid, memory["id"], jpeg(64, 48))).status_code == 201
    assert (await _upload(client, tid, memory["id"], jpeg(64, 48))).status_code == 409


async def test_only_the_author_adds_or_removes_and_deleting_kills_the_urls(
    client: AsyncClient, viewer: AsyncClient, stranger: AsyncClient, photo_dir: Path
) -> None:
    tid = (await edited_trip(client, viewer))["id"]
    memory = await _memory(client, tid)
    photo = (await _upload(client, tid, memory["id"], jpeg(64, 48))).json()
    url = f"/trips/{tid}/memories/{memory['id']}/photos"

    # Another traveler on the trip: 403. Not on the trip: 404.
    assert (await _upload(viewer, tid, memory["id"], jpeg(64, 48))).status_code == 403
    assert (await viewer.delete(f"{url}/{photo['id']}")).status_code == 403
    assert (await _upload(stranger, tid, memory["id"], jpeg(64, 48))).status_code == 404
    # Anyone with the link can view it (that's the unguessable-URL trade-off).
    assert (await stranger.get(photo["thumbUrl"])).status_code == 200

    assert (await client.delete(f"{url}/{photo['id']}")).status_code == 204
    for key in ("thumbUrl", "displayUrl", "originalUrl"):
        assert (await client.get(photo[key])).status_code == 404
    assert not any(photo_dir.rglob(photo["id"]))  # files gone from disk too


async def test_photos_go_with_their_memory_or_trip(client: AsyncClient) -> None:
    tid = (await client.post("/trips/import", json=load_sample_trip())).json()["id"]
    memory = await _memory(client, tid)
    photo = (await _upload(client, tid, memory["id"], jpeg(64, 48))).json()
    await client.delete(f"/trips/{tid}/memories/{memory['id']}")
    assert (await client.get(photo["thumbUrl"])).status_code == 404
    assert (await client.get(f"/photos/{uuid.uuid4()}/thumb")).status_code == 404
    assert (await client.get(f"/photos/{photo['id']}/huge")).status_code == 422
