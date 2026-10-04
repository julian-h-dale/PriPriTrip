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
import math
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
ORIENTATION = 0x0112  # the EXIF tag


class InvalidPhoto(ValueError):
    """Not an image we can store (wrong type, corrupt, or absurdly large)."""


@dataclass
class Processed:
    format: str  # the original's: "jpeg" | "png" | "webp" | "heic"
    width: int  # upright, as displayed
    height: int
    display: bytes
    thumb: bytes


def _jpeg(img: Image.Image, quality: int, icc: bytes | None) -> bytes:
    out = io.BytesIO()
    # No exif= argument: the copy carries no EXIF (and so no GPS).
    img.save(out, "JPEG", quality=quality, optimize=True, progressive=True, icc_profile=icc)
    return out.getvalue()


def _flatten(img: Image.Image) -> Image.Image:
    """JPEG has no transparency: put transparent images on white. RGB stays as it is."""
    if img.mode == "RGB":
        return img
    if img.mode in ("RGBA", "LA") or (img.mode == "P" and "transparency" in img.info):
        rgba = img.convert("RGBA")
        background = Image.new("RGB", rgba.size, (255, 255, 255))
        background.paste(rgba, mask=rgba.getchannel("A"))
        background.info = img.info  # keep the EXIF orientation for exif_transpose
        return background
    return img.convert("RGB")


def _display(img: Image.Image) -> Image.Image:
    """The upright display copy, holding as little full-size pixel data as possible.

    The production machine has 512 MB, and a decoded photo is width x height x 3
    bytes (72 MB at 24 MP), so the order matters:
    - a JPEG is decoded at 1/2, 1/4 or 1/8 scale where that still leaves at
      least DISPLAY_EDGE px (`draft`), so the full-size pixels never exist;
    - it's shrunk in place (no full-size copy kept), *then* turned upright, so
      the rotation copies a display-size image, not the original.
    Measured on a 24 MP JPEG: about 70 MB at peak, down from about 340 MB.
    """
    if img.format == "JPEG":
        # The size it will fit to, e.g. 2560 x 1920; a 2560 x 2560 box would
        # stop any non-square photo from being decoded smaller.
        scale = min(DISPLAY_EDGE / img.width, DISPLAY_EDGE / img.height, 1)
        img.draft("RGB", (math.ceil(img.width * scale), math.ceil(img.height * scale)))
    img = _flatten(img)
    img.thumbnail((DISPLAY_EDGE, DISPLAY_EDGE), Image.Resampling.LANCZOS)  # only ever shrinks
    return ImageOps.exif_transpose(img)


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
                    # The full-size upright dimensions, from the header: the
                    # pixels below are decoded smaller.
                    sideways = img.getexif().get(ORIENTATION, 1) in (5, 6, 7, 8)
                    width, height = (img.height, img.width) if sideways else img.size
                    display = _display(img)
            except InvalidPhoto:
                raise
            except (Image.DecompressionBombError, Image.DecompressionBombWarning):
                raise InvalidPhoto("That image is too large to process") from None
            except Exception:
                raise InvalidPhoto("That file isn't a readable image") from None
    finally:
        Image.MAX_IMAGE_PIXELS = previous
    display_bytes = _jpeg(display, DISPLAY_QUALITY, icc)
    display.thumbnail((THUMB_EDGE, THUMB_EDGE), Image.Resampling.LANCZOS)  # from the display copy
    return Processed(
        format=fmt,
        width=width,
        height=height,
        display=display_bytes,
        thumb=_jpeg(display, THUMB_QUALITY, icc),
    )
