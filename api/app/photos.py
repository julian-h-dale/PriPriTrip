"""Turning an uploaded photo into what the journal shows.

The original is kept exactly as uploaded (full quality, its EXIF intact —
only ever downloaded on purpose). From it we make:
- a display copy: at most 2560 px on the long edge, JPEG quality 85;
- a thumbnail: at most 480 px, JPEG quality 80.
Both are turned upright (EXIF orientation applied) and carry **no EXIF**
(so no GPS), but keep the colour profile (iPhones shoot in Display P3).
Never upscaled. Pure: bytes in, bytes out — no database, no disk.
"""

from __future__ import annotations

import io
import warnings
from dataclasses import dataclass

from PIL import Image, ImageOps
from pillow_heif import register_heif_opener

register_heif_opener()  # iPhone HEIC/HEIF, when the picker doesn't convert it

DISPLAY_EDGE = 2560
DISPLAY_QUALITY = 85
THUMB_EDGE = 480
THUMB_QUALITY = 80
# Refuse "decompression bombs": tiny files that decode to enormous images.
MAX_PIXELS = 120_000_000
FORMATS = {"JPEG": "jpeg", "PNG": "png", "WEBP": "webp", "HEIF": "heic"}


class InvalidPhoto(ValueError):
    """Not an image we can store (wrong type, corrupt, or absurdly large)."""


@dataclass
class Processed:
    format: str  # the original's: "jpeg" | "png" | "webp" | "heic"
    width: int  # upright, as displayed
    height: int
    display: bytes
    thumb: bytes


def _jpeg(img: Image.Image, edge: int, quality: int, icc: bytes | None) -> bytes:
    copy = img.copy()
    copy.thumbnail((edge, edge), Image.Resampling.LANCZOS)  # only ever shrinks
    out = io.BytesIO()
    # No exif= argument: the copy carries no EXIF (and so no GPS).
    copy.save(out, "JPEG", quality=quality, optimize=True, progressive=True, icc_profile=icc)
    return out.getvalue()


def _flatten(img: Image.Image) -> Image.Image:
    """JPEG has no transparency: put transparent images on white."""
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        return background
    return img.convert("RGB")


def process(data: bytes) -> Processed:
    previous = Image.MAX_IMAGE_PIXELS
    Image.MAX_IMAGE_PIXELS = MAX_PIXELS
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            try:
                with Image.open(io.BytesIO(data)) as probe:
                    fmt = FORMATS.get(probe.format or "")
                    probe.verify()  # structural check; the image must be reopened after
                if fmt is None:
                    raise InvalidPhoto("Only JPEG, PNG, WebP or HEIC photos")
                with Image.open(io.BytesIO(data)) as img:
                    icc = img.info.get("icc_profile")
                    upright = _flatten(ImageOps.exif_transpose(img))
            except InvalidPhoto:
                raise
            except (Image.DecompressionBombError, Image.DecompressionBombWarning):
                raise InvalidPhoto("That image is too large to process") from None
            except Exception:
                raise InvalidPhoto("That file isn't a readable image") from None
    finally:
        Image.MAX_IMAGE_PIXELS = previous
    return Processed(
        format=fmt,
        width=upright.width,
        height=upright.height,
        display=_jpeg(upright, DISPLAY_EDGE, DISPLAY_QUALITY, icc),
        thumb=_jpeg(upright, THUMB_EDGE, THUMB_QUALITY, icc),
    )
