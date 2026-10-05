"""Turn the recorded demo clips into the GIFs the README shows.

The clips come from ``npx pnpm --dir frontend demo:record``, which leaves a folder per clip
in ``.cache/demo-videos``: lossless frames and ``frames.txt``, an ffmpeg concat list with
their timing. This script scales each clip and writes ``docs/media/<name>.gif`` with a
per-clip palette.

Run by a maintainer, never by the server or the tests. Needs ``ffmpeg`` on the PATH::

    uv run python scripts/build_readme_media.py            # every clip
    uv run python scripts/build_readme_media.py hero swath  # only these
"""

from __future__ import annotations

import argparse
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SOURCE = ROOT / ".cache" / "demo-videos"
TARGET = ROOT / "docs" / "media"

FPS = 15
WIDTH = 760
#: Clips that get more pixels than the rest.
WIDE = {"hero": 960}
#: GitHub shows a README image of any size, but the repository carries every byte forever.
MAX_CLIP_BYTES = 8 * 1024 * 1024
MAX_TOTAL_BYTES = 40 * 1024 * 1024


def build(name: str) -> Path:
    """Scale and palettize one recording.

    Args:
        name: Clip name, the folder of its frames in the source folder.

    Returns:
        The path of the GIF that was written.
    """
    frames = SOURCE / name / "frames.txt"
    width = WIDE.get(name, WIDTH)
    filters = (
        f"fps={FPS},scale={width}:-1:flags=lanczos,split[a][b];"
        "[a]palettegen=max_colors=192:stats_mode=diff[p];"
        "[b][p]paletteuse=dither=bayer:bayer_scale=5:diff_mode=rectangle"
    )
    output = TARGET / f"{name}.gif"
    subprocess.run(
        [
            "ffmpeg", "-loglevel", "error", "-y",
            "-f", "concat", "-safe", "0", "-i", str(frames),
            "-filter_complex", filters, str(output),
        ],
        check=True,
    )  # fmt: skip
    return output


def main() -> int:
    """Build the requested clips and check the size budget."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument("names", nargs="*", help="clip names; every recorded clip when omitted")
    args = parser.parse_args()
    if shutil.which("ffmpeg") is None:
        print("ffmpeg is not on the PATH", file=sys.stderr)
        return 1
    names = args.names or sorted(path.parent.name for path in SOURCE.glob("*/frames.txt"))
    if not names:
        print(f"no recordings in {SOURCE}; run demo:record first", file=sys.stderr)
        return 1
    TARGET.mkdir(parents=True, exist_ok=True)
    too_big = []
    for name in names:
        output = build(name)
        size = output.stat().st_size
        print(f"{output.relative_to(ROOT)}  {size / 1024 / 1024:.2f} MiB")
        if size > MAX_CLIP_BYTES:
            too_big.append(name)
    total = sum(path.stat().st_size for path in TARGET.glob("*.gif"))
    print(f"total  {total / 1024 / 1024:.2f} MiB")
    if too_big or total > MAX_TOTAL_BYTES:
        print(f"over budget: {', '.join(too_big) or 'total'}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
