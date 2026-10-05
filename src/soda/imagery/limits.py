"""Limits for user imagery.

``MAX_IMAGERY_BYTES`` is mirrored in ``frontend/src/utils/imagery.ts``.
"""

#: Largest accepted upload, whatever the format.
MAX_IMAGERY_BYTES = 1024 * 1024 * 1024
#: Sets kept at once, counting the ones still being imported.
MAX_IMAGERY_SETS = 200
#: Largest plain image the server will warp; it is copied whole into a scratch GeoTIFF.
MAX_IMAGERY_PIXELS = 150_000_000
#: Largest GeoTIFF the server will warp. It is read in place, block by block, so the bound is
#: generous; ``MAX_IMPORT_TILES`` is what keeps the work in check.
MAX_GEOTIFF_PIXELS = 1_600_000_000
#: Deepest level cut from an image or GeoTIFF; finer sources are clamped, not rejected.
MAX_IMPORT_ZOOM = 20
#: Tiles one import may write, over all its levels. A source that needs more is cut shallower.
MAX_IMPORT_TILES = 60_000
#: Imports that may wait or run at once; more are refused until some finish.
MAX_IMPORT_QUEUE = 20
#: Largest file taken from the inbox folder. It is already on disk, so it may be far larger
#: than an upload.
MAX_INBOX_BYTES = 8 * 1024 * 1024 * 1024
#: Catalogue items one request may import.
MAX_CATALOG_IMPORT_ITEMS = 10
#: Widest box, in degrees, a catalogue search accepts.
MAX_CATALOG_SEARCH_SPAN_DEG = 20
#: Items a catalogue search returns at most.
MAX_CATALOG_RESULTS = 50
#: Largest catalogue document read into memory.
MAX_CATALOG_JSON_BYTES = 2 * 1024 * 1024
#: Deepest level accepted in an uploaded MBTiles.
MAX_MBTILES_ZOOM = 22

MAX_NAME_LENGTH = 60
MAX_ATTRIBUTION_LENGTH = 200
MAX_LICENSE_LENGTH = 60
