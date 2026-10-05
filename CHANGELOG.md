# Changelog

All notable changes to SODA are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and versions follow
[Semantic Versioning](https://semver.org/).

## 0.1.0 - 2026-10-05

First public release.

### Added

- **Orbit propagation** with SGP4, or HPOP numerical integration (EGM96 gravity
  up to 20×20, Sun and Moon gravity, Harris-Priester drag, solar radiation
  pressure). Up to 8 satellites at once, shown Earth-fixed or inertial, with
  altitude and beta-angle charts.
- **Orbit sources**: CelesTrak elements with a one-request-per-two-hours budget,
  optional Space-Track history, pasted or imported TLE and OMM (JSON, XML, KVN,
  CSV), CCSDS OPM state vectors and OEM ephemerides.
- **Swath and field of regard** on the WGS84 ellipsoid, with a daylight filter
  and a 3D sensor cone.
- **Pass prediction** for up to 8 ground stations and 8 satellites, with azimuth
  masks, priority scheduling of conflicts, a sky plot and 43 published stations.
- **Imaging plan**: opportunities for point and area targets within roll and
  pitch limits and a minimum Sun elevation.
- **Onboard storage** recorder and **power budget** with an equivalent-circuit
  battery.
- **TC/TM mock link** exchanging CCSDS packets with a simulated spacecraft.
- **User imagery**: MBTiles, GeoTIFF/COG and georeferenced images cut into tiles,
  an inbox folder, and search of Maxar Open Data and OpenAerialMap.
- 2D map, day and night shading, eclipse display, place search and pins.
- Korean and English interface.

### Known limitations

- HPOP started from a TLE or OMM inherits the error of those elements; it is for
  comparing perturbing forces, not for better accuracy than SGP4.
- Passes, imaging opportunities and TC/TM are computed with SGP4 only.
- Sensor presets and the default battery curve are illustrative values.
- Scene products (SPOT DIMAP) are fitted to their four corners, not
  orthorectified.
- The server has no authentication and is meant for `127.0.0.1` only.
