"""File signatures of the formats imagery arrives in, and the error they are rejected with."""

from ..errors import CodedError

SQLITE_MAGIC = b"SQLite format 3\x00"
_TIFF_MAGICS = (b"II*\x00", b"MM\x00*", b"II+\x00", b"MM\x00+")

MEDIA_TYPES = {"png": "image/png", "jpg": "image/jpeg", "webp": "image/webp"}


class ImageryError(CodedError, ValueError):
    """Raised when uploaded imagery cannot be used; the code says why."""


def raster_kind(data: bytes) -> str | None:
    """``png``, ``jpg`` or ``webp`` for image bytes a browser can draw, else ``None``."""
    if data[:8] == b"\x89PNG\r\n\x1a\n":
        return "png"
    if data[:3] == b"\xff\xd8\xff":
        return "jpg"
    if data[:4] == b"RIFF" and data[8:12] == b"WEBP":
        return "webp"
    return None


def is_tiff(head: bytes) -> bool:
    """Whether the first bytes are a TIFF or BigTIFF header."""
    return head[:4] in _TIFF_MAGICS
