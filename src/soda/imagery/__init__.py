"""User-supplied imagery shown on the globe above the basemap.

Every accepted input is normalised to one MBTiles file per set, the way every orbital element
input is normalised to OMM: an uploaded MBTiles is validated and kept as it is, while a plain
image with its four corners and a GeoTIFF are warped to Web Mercator and cut into tiles. The
server then has a single way to serve a tile.

Only ``warp`` needs rasterio, and it imports it inside its functions, so the server starts and
serves existing sets without it.
"""
