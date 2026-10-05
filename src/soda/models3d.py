"""User-supplied 3D satellite models (glTF 2.0 binaries) kept under ``data/models``.

A model named ``default`` applies to every propagated satellite; a model named after a NORAD
catalog number applies to that satellite only. Display settings live in a ``<name>.json``
sidecar next to the ``.glb`` file.

The web UI hides this feature unless the frontend is built with ``VITE_SODA_GLB_MODELS=1``.
"""

import contextlib
import json
import logging
import struct
from pathlib import Path
from typing import Any

from .errors import CodedError
from .named_files import DEFAULT_NAME, NamedFileStore, StoredFile, is_valid_name, write_atomic

__all__ = [
    "DEFAULT_NAME",
    "MAX_MODEL_BYTES",
    "GlbError",
    "ModelStore",
    "StoredModel",
    "is_valid_name",
    "validate_glb",
]

logger = logging.getLogger(__name__)

MAX_MODEL_BYTES = 64 * 1024 * 1024

_HEADER = struct.Struct("<4sII")
_CHUNK = struct.Struct("<II")
_JSON_CHUNK_TYPE = 0x4E4F534A

StoredModel = StoredFile


class GlbError(CodedError, ValueError):
    """Raised when bytes are not a self-contained glTF 2.0 binary."""


def validate_glb(data: bytes) -> None:
    """Check the GLB container and reject models that reference external files.

    Args:
        data: Uploaded file contents.

    Raises:
        GlbError: With a user-facing (Korean) message when the file cannot be displayed.
    """
    if len(data) < _HEADER.size + _CHUNK.size:
        raise GlbError("glbNotGlb", ".glb(glTF 바이너리) 파일 아님")
    magic, version, length = _HEADER.unpack_from(data)
    if magic != b"glTF":
        raise GlbError("glbNotGlb", ".glb(glTF 바이너리) 파일 아님")
    if version != 2:
        raise GlbError("glbVersion", "glTF 2.0 모델만 지원")
    if length != len(data):
        raise GlbError(
            "glbLengthMismatch",
            "GLB 헤더의 길이가 파일 크기와 다름 · 파일 손상 가능성 있음",
        )
    chunk_length, chunk_type = _CHUNK.unpack_from(data, _HEADER.size)
    start = _HEADER.size + _CHUNK.size
    if chunk_type != _JSON_CHUNK_TYPE or start + chunk_length > len(data):
        raise GlbError("glbJsonChunk", "GLB의 JSON 청크를 읽을 수 없음")
    try:
        document = json.loads(data[start : start + chunk_length])
    except ValueError as error:
        raise GlbError("glbJsonChunk", "GLB의 JSON 청크를 읽을 수 없음") from error
    if not isinstance(document, dict):
        raise GlbError("glbJsonChunk", "GLB의 JSON 청크를 읽을 수 없음")
    for key in ("buffers", "images"):
        for item in document.get(key) or []:
            uri = item.get("uri") if isinstance(item, dict) else None
            if isinstance(uri, str) and not uri.startswith("data:"):
                raise GlbError(
                    "glbExternalUri",
                    "외부 파일을 참조하는 모델은 사용 불가 · "
                    "텍스처와 버퍼를 포함한 .glb로 내보내야 함",
                )


class ModelStore(NamedFileStore):
    """Model files and their display settings in one directory."""

    def __init__(self, root: Path) -> None:
        super().__init__(root, ".glb", validate_glb)

    def _settings_path(self, name: str) -> Path:
        return self.path(name).with_suffix(".json")

    def read_settings(self, name: str) -> dict[str, Any]:
        """Raw sidecar settings; an unreadable sidecar is logged and treated as empty."""
        path = self._settings_path(name)
        try:
            raw = json.loads(path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return {}
        except (OSError, ValueError) as error:
            logger.warning("Ignoring unreadable model settings %s: %s", path, error)
            return {}
        if not isinstance(raw, dict):
            logger.warning("Ignoring model settings %s: expected a JSON object", path)
            return {}
        return raw

    def save_settings(self, name: str, settings: dict[str, Any]) -> None:
        """Atomically write the sidecar settings for a model."""
        path = self._settings_path(name)
        self.root.mkdir(parents=True, exist_ok=True)
        write_atomic(path, json.dumps(settings, indent=2).encode())

    def delete(self, name: str) -> bool:
        """Remove a model and its settings.

        Returns:
            Whether a model file existed.
        """
        existed = super().delete(name)
        with contextlib.suppress(FileNotFoundError):
            self._settings_path(name).unlink()
        return existed
