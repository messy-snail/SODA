"""Organization logos (PNG) kept under ``data/logos`` and painted onto satellite shapes.

A logo named ``default`` applies to every propagated satellite; one named after an operator
slug (``starlink``, ``kari``) applies to that operator's satellites; one named after a NORAD
catalog number applies to that satellite only. The frontend maps a satellite name onto an
operator slug in ``frontend/src/utils/operators.ts``.

Logos bundled with the package live in ``assets/logos`` and are read-only. Uploading a logo
with the same name shadows the bundled one, and deleting that upload brings it back. The web
UI rasterizes PNG, JPEG, WebP, and SVG input to PNG before uploading, so the server only
accepts PNG.
"""

import struct
from pathlib import Path

from .errors import CodedError
from .named_files import NamedFileStore

MAX_LOGO_BYTES = 2 * 1024 * 1024
MAX_LOGO_PX = 2048

_SIGNATURE = b"\x89PNG\r\n\x1a\n"
_IHDR = struct.Struct(">I4sII")


class LogoError(CodedError, ValueError):
    """Raised when bytes are not a PNG image the globe can use."""


def validate_png(data: bytes) -> None:
    """Check the PNG signature and the image header.

    Args:
        data: Uploaded file contents.

    Raises:
        LogoError: With a user-facing (Korean) message when the file cannot be used.
    """
    if not data.startswith(_SIGNATURE) or len(data) < len(_SIGNATURE) + _IHDR.size:
        raise LogoError("logoNotPng", "PNG 이미지 아님")
    length, chunk_type, width, height = _IHDR.unpack_from(data, len(_SIGNATURE))
    if chunk_type != b"IHDR" or length != 13:
        raise LogoError("logoHeaderUnreadable", "PNG 헤더를 읽을 수 없음 · 파일 손상 가능성 있음")
    if not (1 <= width <= MAX_LOGO_PX and 1 <= height <= MAX_LOGO_PX):
        raise LogoError(
            "logoTooWide",
            f"로고는 가로·세로 {MAX_LOGO_PX} px 이하만 사용 가능",
            max_px=MAX_LOGO_PX,
        )


class LogoStore(NamedFileStore):
    """Uploaded logo PNG files, over the read-only ones bundled with the package."""

    def __init__(self, root: Path, builtin_root: Path | None = None) -> None:
        super().__init__(
            root,
            ".png",
            validate_png,
            builtin_root=builtin_root,
            allow_operators=True,
        )
