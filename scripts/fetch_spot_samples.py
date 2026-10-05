"""Register a few SPOT World Heritage quicklooks with a running SODA server.

    uv run soda serve                              # in another terminal
    uv run python scripts/fetch_spot_samples.py    # --server http://127.0.0.1:1992

For each pinned scene the script asks the public SWH catalogue for its footprint and quicklook
(a 1000 px JPEG in sensor geometry) and posts it to the server as an image with four corners.
The scenes land in `data/imagery` as ordinary sets and can be deleted in the app; nothing is
bundled with the repository. Downloads are cached in `.cache/spot-swh/`. Only the catalogue
search and the quicklook are fetched; full products need a CNES account and are not touched.

These are low-resolution (60 to 80 m per pixel, false colour with vegetation in red), so they
show where a scene is rather than what is in it. They are what the catalogue gives without a
login. The server and the tests never run this script.

Source: CNES, SPOT World Heritage programme (https://regards.cnes.fr/html/swh/Home-swh3.html),
Open Licence 2.0 (Etalab). Attribution: "SPOT images acquired by CNES's Spot World Heritage
Programme".
"""

from __future__ import annotations

import argparse
import json
import logging
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path

logger = logging.getLogger("fetch_spot_samples")

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "spot-swh"
SEARCH_URL = "https://regards.cnes.fr/api/v1/rs-catalog/engines/legacy/dataobjects/search"
# The catalogue serves files only when the request names its project.
SCOPE = "swh"
ATTRIBUTION = "SPOT images acquired by CNES's Spot World Heritage Programme"
LICENSE = "Open Licence 2.0 (Etalab)"
# Scene id -> place. SPOT 5 HRG multispectral (10 m), nearly cloud-free, close to nadir, each
# with a coastline or a large river so a wrong orientation is obvious on the globe.
SCENES = {
    "53032750605070222151J": "Incheon",
    "53092791111150212392J": "Busan",
    "50422620802101058272J": "Toulouse",
    "50512631105071032342J": "Marseille",
}
# Which footprint vertex is each image corner, in the order top-left, top-right, bottom-right,
# bottom-left. The catalogue ring starts at the north-west corner and runs clockwise, and the
# quicklook has north up, so the two orders coincide. Checked against the basemap coastline
# for the Incheon and Marseille scenes.
CORNER_ORDER = (0, 1, 2, 3)


def fetch(url: str, path: Path) -> Path:
    """Download a URL into the cache on first use.

    Args:
        url: Address to fetch.
        path: Cache file to write.

    Returns:
        The cache file.
    """
    if not path.is_file():
        logger.info("Downloading %s", url)
        path.parent.mkdir(parents=True, exist_ok=True)
        with urllib.request.urlopen(url, timeout=60) as response:
            path.write_bytes(response.read())
    return path


def scene_record(scene_id: str) -> dict:
    """The catalogue entry for one scene.

    Args:
        scene_id: SPOT scene id (`properties.SceneID`).

    Returns:
        The `content` object of the single search hit.
    """
    query = urllib.parse.urlencode(
        {"scope": SCOPE, "q": f'properties.SceneID:"{scene_id}"', "page": 0, "size": 1}
    )
    record = json.loads(fetch(f"{SEARCH_URL}?{query}", CACHE / f"{scene_id}.json").read_text())
    hits = record["content"]
    if len(hits) != 1:
        raise SystemExit(f"{scene_id}: expected one catalogue hit, got {len(hits)}")
    return hits[0]["content"]


def register(server: str, scene_id: str, place: str, existing: set[str]) -> None:
    """Fetch one scene and post it to the server, unless a set with its name is already there.

    Args:
        server: Base URL of the SODA server.
        scene_id: SPOT scene id.
        place: Place name used in the set's name.
        existing: Names of the sets the server already has.
    """
    record = scene_record(scene_id)
    acquired = record["properties"]["DataDate"]
    name = f"SPOT 5 {place} {acquired[:10]}"
    if name in existing:
        logger.info("%s: already registered", name)
        return
    ring = record["geometry"]["coordinates"][0]
    corners = [value for index in CORNER_ORDER for value in ring[index][:2]]
    thumbnail = record["files"]["THUMBNAIL"][0]
    quicklook = fetch(f"{thumbnail['uri']}?scope={SCOPE}", CACHE / f"{scene_id}.jpg")
    query = urllib.parse.urlencode(
        {
            "source_format": "image",
            "name": name,
            "attribution": ATTRIBUTION,
            "license": LICENSE,
            "acquired_at": acquired,
            "corners_deg": ",".join(str(value) for value in corners),
        }
    )
    request = urllib.request.Request(
        f"{server}/api/v1/imagery?{query}",
        data=quicklook.read_bytes(),
        headers={"Content-Type": "application/octet-stream"},
        method="POST",
    )
    with urllib.request.urlopen(request, timeout=60) as response:
        created = json.load(response)
    logger.info("%s: queued as %s", name, created["id"])


def main() -> None:
    """Register every pinned scene."""
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--server", default="http://127.0.0.1:1992", help="SODA server (default: %(default)s)"
    )
    server = parser.parse_args().server.rstrip("/")
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    try:
        with urllib.request.urlopen(f"{server}/api/v1/imagery", timeout=10) as response:
            existing = {item["name"] for item in json.load(response)}
    except urllib.error.URLError as error:
        raise SystemExit(f"No SODA server at {server}: start `uv run soda serve` first") from error
    for scene_id, place in SCENES.items():
        register(server, scene_id, place, existing)


if __name__ == "__main__":
    main()
