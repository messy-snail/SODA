"""User files named ``default``, after an operator, or after a NORAD catalog number.

A file named ``default`` applies to every satellite; a file named after a NORAD catalog number
applies to that satellite only. Logos additionally allow an operator slug (``starlink``,
``kari``) that applies to every satellite of that operator; 3D models do not.

A store may also read a second, read-only directory of files shipped with the package. A user
file shadows the bundled one with the same name, and deleting it brings the bundled file back.
"""

import contextlib
import os
import re
import tempfile
from collections.abc import Callable
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path

DEFAULT_NAME = "default"
NAME_PATTERN = re.compile(r"(default|[1-9]\d{0,8})")
# Lowercase only: a case-insensitive filesystem would otherwise treat SI.png and si.png as one.
OPERATOR_PATTERN = re.compile(r"[a-z][a-z0-9-]{1,31}")


def is_valid_name(name: str) -> bool:
    """Whether ``name`` is ``default`` or a NORAD catalog number without leading zeros."""
    return NAME_PATTERN.fullmatch(name) is not None


def is_operator_name(name: str) -> bool:
    """Whether ``name`` is an operator slug such as ``starlink`` (never ``default``)."""
    return name != DEFAULT_NAME and OPERATOR_PATTERN.fullmatch(name) is not None


def write_atomic(path: Path, data: bytes) -> None:
    """Write ``data`` to a temporary file in the same directory, then replace ``path``."""
    fd, temp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.stem}-", suffix=".tmp")
    try:
        with os.fdopen(fd, "wb") as target:
            target.write(data)
        os.replace(temp, path)
    except BaseException:
        with contextlib.suppress(OSError):
            os.unlink(temp)
        raise


@dataclass(frozen=True)
class StoredFile:
    """A named file on disk."""

    name: str
    path: Path
    size_bytes: int
    updated_at: datetime
    #: Whether this file came from the package's read-only directory rather than the data one.
    builtin: bool = False

    @property
    def norad_id(self) -> int | None:
        # isdecimal, not isdigit: the latter also accepts characters int() cannot parse.
        return int(self.name) if self.name.isdecimal() else None

    @property
    def operator(self) -> str | None:
        return None if self.name == DEFAULT_NAME or self.name.isdecimal() else self.name


def _sort_key(stored: StoredFile) -> tuple[int, str, int]:
    """Order files: the default first, then operators by name, then by NORAD number."""
    if stored.name == DEFAULT_NAME:
        return (0, "", 0)
    if stored.operator is not None:
        return (1, stored.operator, 0)
    return (2, "", stored.norad_id or 0)


class NamedFileStore:
    """Validated files with one suffix, in a writable directory over an optional bundled one."""

    def __init__(
        self,
        root: Path,
        suffix: str,
        validate: Callable[[bytes], None],
        *,
        builtin_root: Path | None = None,
        allow_operators: bool = False,
    ) -> None:
        self.root = root
        self.builtin_root = builtin_root
        self.suffix = suffix
        self.allow_operators = allow_operators
        self._validate = validate

    def is_valid(self, name: str) -> bool:
        """Whether ``name`` may address a file in this store."""
        return is_valid_name(name) or (self.allow_operators and is_operator_name(name))

    def path(self, name: str) -> Path:
        """Path of the writable file for a validated name.

        Raises:
            ValueError: If the name could escape the directory.
        """
        if not self.is_valid(name):
            raise ValueError(f"invalid file name: {name!r}")
        return self.root / f"{name}{self.suffix}"

    def builtin_path(self, name: str) -> Path | None:
        """Path of the bundled file for a validated name, when this store has a bundled root.

        Raises:
            ValueError: If the name could escape the directory.
        """
        if not self.is_valid(name):
            raise ValueError(f"invalid file name: {name!r}")
        return None if self.builtin_root is None else self.builtin_root / f"{name}{self.suffix}"

    @staticmethod
    def _stat(name: str, path: Path, *, builtin: bool) -> StoredFile | None:
        try:
            stat = path.stat()
        except FileNotFoundError:
            return None
        updated_at = datetime.fromtimestamp(stat.st_mtime, UTC)
        return StoredFile(name, path, stat.st_size, updated_at, builtin=builtin)

    def has_builtin(self, name: str) -> bool:
        """Whether a bundled file with this name exists, shadowed or not."""
        path = self.builtin_path(name)
        return path is not None and path.is_file()

    def get(self, name: str) -> StoredFile | None:
        """The user file, else the bundled one, else ``None``."""
        stored = self._stat(name, self.path(name), builtin=False)
        if stored is not None:
            return stored
        path = self.builtin_path(name)
        return None if path is None else self._stat(name, path, builtin=True)

    def _names_in(self, root: Path | None) -> set[str]:
        if root is None or not root.is_dir():
            return set()
        return {p.stem for p in root.glob(f"*{self.suffix}") if self.is_valid(p.stem)}

    def entries(self) -> list[StoredFile]:
        """All files, user ones shadowing bundled ones, in display order."""
        names = self._names_in(self.root) | self._names_in(self.builtin_root)
        files = [stored for stored in map(self.get, names) if stored is not None]
        return sorted(files, key=_sort_key)

    def save(self, name: str, data: bytes) -> StoredFile:
        """Validate and atomically write a user file, shadowing any bundled one.

        Raises:
            ValueError: From the validator (a subclass with a user-facing message) when the
                data is not usable.
        """
        path = self.path(name)
        self._validate(data)
        self.root.mkdir(parents=True, exist_ok=True)
        write_atomic(path, data)
        stored = self.get(name)
        assert stored is not None
        return stored

    def delete(self, name: str) -> bool:
        """Remove the user file, uncovering any bundled file with the same name.

        Returns:
            Whether a user file existed. Bundled files are never removed.
        """
        try:
            self.path(name).unlink()
        except FileNotFoundError:
            return False
        return True
