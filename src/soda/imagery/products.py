"""Finding a satellite scene product in an inbox folder or archive.

A product is what an agency hands out: an image in sensor geometry plus metadata that says
where it lies. Only SPOT scenes (DIMAP, see ``dimap``) are known so far; another product kind
would be recognised here.

An archive is never unpacked as it is. The two members needed are found by name and copied
out under names of our own, so nothing in the archive decides where a file is written.
"""

import zipfile
from dataclasses import dataclass
from pathlib import Path, PurePosixPath

from .dimap import MAX_METADATA_BYTES, METADATA_NAME, Scene, invalid, read_scene
from .formats import ImageryError
from .limits import MAX_INBOX_BYTES

#: How far below a product folder the metadata may sit: ``<product>/SCENE01/METADATA.DIM``.
_MAX_DEPTH = 2
_COPY_BYTES = 1024 * 1024
#: Name the image gets when it is copied out of an archive.
EXTRACTED_NAME = "extracted.tif"


@dataclass(frozen=True)
class Product:
    """A scene found in the inbox, read far enough to queue its import."""

    scene: Scene
    #: The folder or archive it was found in.
    source: Path
    #: Path of the image inside a folder, or the member name inside an archive.
    data: str


def _too_large() -> ImageryError:
    limit = MAX_INBOX_BYTES // (1024 * 1024)
    return ImageryError("imageryTooLarge", f"영상 파일은 {limit} MB 이하만 등록 가능", max_mb=limit)


def _is_metadata(name: str) -> bool:
    return name.upper() == METADATA_NAME


def metadata_files(folder: Path) -> list[Path]:
    """Every ``METADATA.DIM`` in a folder, down to where a product keeps it."""
    found: list[Path] = []
    level = [folder]
    for _ in range(_MAX_DEPTH + 1):
        deeper: list[Path] = []
        for directory in level:
            for entry in sorted(directory.iterdir()):
                if entry.is_symlink():
                    continue
                if entry.is_dir():
                    deeper.append(entry)
                elif _is_metadata(entry.name):
                    found.append(entry)
        level = deeper
    return found


def _open_folder(folder: Path) -> Product:
    found = metadata_files(folder)
    if len(found) != 1:
        raise invalid(METADATA_NAME)
    metadata = found[0]
    if metadata.stat().st_size > MAX_METADATA_BYTES:
        raise invalid(METADATA_NAME)
    scene = read_scene(metadata.read_bytes())
    data = metadata.with_name(scene.data_file)
    if data.is_symlink() or not data.is_file():
        raise invalid(scene.data_file)
    if data.stat().st_size > MAX_INBOX_BYTES:
        raise _too_large()
    return Product(scene, folder, str(data))


def _open_archive(archive: Path) -> Product:
    try:
        with zipfile.ZipFile(archive) as bundle:
            members = {info.filename: info for info in bundle.infolist() if not info.is_dir()}
            found = [name for name in members if _is_metadata(PurePosixPath(name).name)]
            if len(found) != 1 or members[found[0]].file_size > MAX_METADATA_BYTES:
                raise invalid(METADATA_NAME)
            with bundle.open(members[found[0]]) as handle:
                scene = read_scene(handle.read(MAX_METADATA_BYTES + 1))
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError) as error:
        raise invalid("zip") from error
    data = str(PurePosixPath(found[0]).with_name(scene.data_file))
    if data not in members:
        raise invalid(scene.data_file)
    if members[data].file_size > MAX_INBOX_BYTES:
        raise _too_large()
    return Product(scene, archive, data)


def open_product(source: Path) -> Product:
    """Read the metadata of the product in a folder or a ``.zip`` archive.

    Raises:
        ImageryError: ``imageryProductInvalid`` when there is not exactly one scene in it or
            its metadata cannot be used; ``imageryTooLarge`` when its image is over the limit.
    """
    return _open_folder(source) if source.is_dir() else _open_archive(source)


def image_file(product: Product, scratch_dir: Path) -> Path:
    """The scene's image as a file on disk, copied out of the archive when it is in one.

    Args:
        product: What ``open_product`` returned.
        scratch_dir: Where an archive's image is written, as ``EXTRACTED_NAME``.

    Raises:
        ImageryError: When the member cannot be read or turns out larger than declared.
    """
    if product.source.is_dir():
        return Path(product.data)
    target = scratch_dir / EXTRACTED_NAME
    written = 0
    try:
        with (
            zipfile.ZipFile(product.source) as bundle,
            bundle.open(product.data) as member,
            target.open("wb") as handle,
        ):
            # The declared size was checked already; this guards against a member that lies.
            while chunk := member.read(_COPY_BYTES):
                written += len(chunk)
                if written > MAX_INBOX_BYTES:
                    raise _too_large()
                handle.write(chunk)
    except (zipfile.BadZipFile, OSError, RuntimeError, NotImplementedError) as error:
        target.unlink(missing_ok=True)
        raise invalid("zip") from error
    except ImageryError:
        target.unlink(missing_ok=True)
        raise
    return target


def folder_state(folder: Path) -> tuple[int, int]:
    """Total size and newest modification time of a folder's files, to tell when a copy ends."""
    size, newest = 0, folder.stat().st_mtime_ns
    for entry in folder.rglob("*"):
        if entry.is_symlink() or not entry.is_file():
            continue
        stat = entry.stat()
        size, newest = size + stat.st_size, max(newest, stat.st_mtime_ns)
    return size, newest
