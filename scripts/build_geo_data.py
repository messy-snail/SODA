"""Build the bundled country and city data from Natural Earth (public domain).

Run once when the data should be refreshed; the output is committed:

    uv run python scripts/build_geo_data.py

Downloads land in `.cache/natural-earth/` and are reused on later runs. The script writes
`frontend/public/geo/countries.json`, `country-shapes.json` and `places.json`.
"""

from __future__ import annotations

import json
import logging
import math
import urllib.request
from pathlib import Path

logger = logging.getLogger("build_geo_data")

ROOT = Path(__file__).resolve().parents[1]
CACHE = ROOT / ".cache" / "natural-earth"
OUT = ROOT / "frontend" / "public" / "geo"
BASE_URL = "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/v5.1.2/geojson/"
SOURCES = {
    "countries": "ne_50m_admin_0_countries.geojson",
    "places": "ne_10m_populated_places.geojson",
}
# Degrees; 0.01 deg is about 1 km, finer than the 1:50m source is accurate.
QUANTUM_DEG = 0.01
SIMPLIFY_DEG = 0.02
# Cities with a scale rank at or below this, plus every capital, are searchable.
MAX_CITY_RANK = 6


def fetch(name: str) -> dict:
    """Load a Natural Earth GeoJSON file, downloading it into the cache on first use.

    Args:
        name: File name under the Natural Earth `geojson/` directory.

    Returns:
        The parsed GeoJSON document.
    """
    path = CACHE / name
    if not path.exists():
        CACHE.mkdir(parents=True, exist_ok=True)
        logger.info("downloading %s", name)
        urllib.request.urlretrieve(BASE_URL + name, path)
    return json.loads(path.read_text(encoding="utf-8"))


def q(value: float) -> float:
    """Round a coordinate to the output grid."""
    return round(round(value / QUANTUM_DEG) * QUANTUM_DEG, 2)


def simplify(points: list[list[float]], tolerance: float) -> list[list[float]]:
    """Douglas-Peucker simplification in plain degrees (iterative, keeps the endpoints)."""
    if len(points) < 3:
        return points
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        first, last = stack.pop()
        ax, ay = points[first]
        bx, by = points[last]
        dx, dy = bx - ax, by - ay
        norm = math.hypot(dx, dy)
        worst, index = 0.0, -1
        for i in range(first + 1, last):
            px, py = points[i]
            if norm == 0:
                dist = math.hypot(px - ax, py - ay)
            else:
                dist = abs(dy * (px - ax) - dx * (py - ay)) / norm
            if dist > worst:
                worst, index = dist, i
        if worst > tolerance and index > 0:
            keep[index] = True
            stack.append((first, index))
            stack.append((index, last))
    return [p for p, k in zip(points, keep, strict=True) if k]


def flat_line(points: list[list[float]]) -> list[float]:
    """Simplify, quantise and flatten a line to `[lon0, lat0, lon1, ...]`."""
    out: list[float] = []
    for lon, lat in simplify(points, SIMPLIFY_DEG):
        lon, lat = q(lon), q(lat)
        if len(out) >= 2 and out[-2] == lon and out[-1] == lat:
            continue
        out += [lon, lat]
    return out


def polygons(geometry: dict) -> list[list[list[list[float]]]]:
    """Polygons of a Polygon or MultiPolygon geometry."""
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    return geometry["coordinates"]


def ring_area(ring: list[list[float]]) -> float:
    """Unsigned planar area of a ring in square degrees, enough to rank parts."""
    total = 0.0
    for (x0, y0), (x1, y1) in zip(ring, ring[1:], strict=False):
        total += x0 * y1 - x1 * y0
    return abs(total) / 2


def bbox(ring: list[list[float]]) -> list[float]:
    """West, south, east, north of a ring."""
    lons = [p[0] for p in ring]
    lats = [p[1] for p in ring]
    return [q(min(lons)), q(min(lats)), q(max(lons)), q(max(lats))]


def iso2(props: dict) -> str:
    """ISO 3166-1 alpha-2 code, using the 'EH' column where the strict one is -99."""
    for key in ("ISO_A2", "ISO_A2_EH"):
        code = str(props.get(key) or "")
        if len(code) == 2 and code.isalpha():
            return code.upper()
    return ""


def name_of(props: dict, key: str, fallback: str) -> str:
    """A localised name column, falling back when Natural Earth leaves it empty."""
    value = props.get(key)
    return value.strip() if isinstance(value, str) and value.strip() else fallback


def build_countries() -> list[dict]:
    """Country labels and search entries; the camera frames the largest polygon."""
    out = []
    for feature in fetch(SOURCES["countries"])["features"]:
        props = feature["properties"]
        en = name_of(props, "NAME_EN", props["NAME"])
        largest = max(polygons(feature["geometry"]), key=lambda poly: ring_area(poly[0]))
        out.append(
            {
                "a3": props["ADM0_A3"],
                "iso2": iso2(props),
                "name": {"ko": name_of(props, "NAME_KO", en), "en": en},
                "label": [q(props["LABEL_X"]), q(props["LABEL_Y"])],
                "bbox": bbox(largest[0]),
                "rank": int(props.get("LABELRANK") or 10),
            }
        )
    out.sort(key=lambda c: c["name"]["en"])
    return out


def build_shapes() -> list[dict]:
    """Country polygons for the tint overlay and point-in-country lookups.

    Each ring is a flat, closed `[lon0, lat0, ...]` list; the first ring of a polygon is its
    outline and the rest are holes, which the even-odd fill rule leaves unpainted. Natural
    Earth splits polygons at the antimeridian, so no ring crosses it.
    """
    out = []
    for feature in fetch(SOURCES["countries"])["features"]:
        props = feature["properties"]
        rings = []
        for polygon in polygons(feature["geometry"]):
            for ring in polygon:
                line = flat_line(ring)
                if len(line) >= 8:
                    rings.append(line)
        if rings:
            out.append(
                {
                    "a3": props["ADM0_A3"],
                    "iso2": iso2(props),
                    "color": int(props.get("MAPCOLOR7") or 1),
                    "rings": rings,
                }
            )
    return out


def build_places() -> list[dict]:
    """Capitals and large cities, most populous first."""
    out = []
    for feature in fetch(SOURCES["places"])["features"]:
        props = feature["properties"]
        capital = str(props.get("FEATURECLA", "")).startswith("Admin-0 capital")
        if not capital and int(props.get("SCALERANK", 99)) > MAX_CITY_RANK:
            continue
        en = name_of(props, "NAME_EN", props["NAME"])
        lon, lat = feature["geometry"]["coordinates"]
        out.append(
            {
                "name": {"ko": name_of(props, "NAME_KO", en), "en": en},
                "iso2": iso2({"ISO_A2": props.get("ISO_A2")}),
                "lon": q(lon),
                "lat": q(lat),
                "pop": int(props.get("POP_MAX") or 0),
                "capital": capital,
            }
        )
    out.sort(key=lambda p: -p["pop"])
    return out


def write(name: str, payload: object) -> None:
    """Write compact JSON and log its size."""
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / name
    path.write_text(
        json.dumps(payload, ensure_ascii=False, separators=(",", ":")), encoding="utf-8"
    )
    logger.info("%s: %.0f kB", path.relative_to(ROOT), path.stat().st_size / 1024)


def main() -> None:
    """Build every output file."""
    logging.basicConfig(level=logging.INFO, format="%(message)s")
    write("countries.json", build_countries())
    write("country-shapes.json", build_shapes())
    write("places.json", build_places())


if __name__ == "__main__":
    main()
