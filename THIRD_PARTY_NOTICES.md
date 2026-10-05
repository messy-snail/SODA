# Third-Party Notices

## OrbitView

SODA uses [OrbitView](https://github.com/SpaceEngineerSS/OrbitView) as a structural reference.
No OrbitView source file, logo, 3D model, screenshot, or vendored Cesium build is copied.
The following parts are adapted from OrbitView logic:

| SODA file | Adapted from |
| --- | --- |
| `src/soda/gp/classify.py` | `src/lib/space-objects.ts` orbit category rules |
| `src/soda/orbit/footprint.py` | `src/lib/GroundTrack.ts` footprint radius and circle construction |
| `frontend/src/workers/satellites.worker.ts` | `src/workers/satellite.worker.ts` catalog propagation worker pattern |
| `tests/test_propagator.py` | `src/lib/__tests__/SGP4Validation.test.ts` ISS range check |

```
MIT License

Copyright (c) 2025 OrbitView Contributors

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Bundled organization logos

`src/soda/assets/logos/*.png` are operator logos painted onto satellite shapes so a satellite
can be recognized at a glance. Each file's source and the basis for including it are recorded in
[`src/soda/assets/logos/SOURCES.md`](src/soda/assets/logos/SOURCES.md).

These logos are the trademarks of their respective owners. SODA uses them for identification
only; no owner endorses, sponsors, or is affiliated with this project. **They are not covered by
this repository's MIT license** and remain the property of their owners; see
[`src/soda/assets/logos/LICENSE`](src/soda/assets/logos/LICENSE). If you own one of these
marks and want it removed, open an issue. A user who does not want a bundled logo can replace it
by uploading their own file under the same name, which shadows it.

Eighteen come from Wikimedia Commons. Most are tagged public domain there (`{{PD-textlogo}}`) —
free of copyright, but still trademarked. Two require attribution:

| File | Work | Author | License |
| --- | --- | --- | --- |
| `sitro.png` | [SITRONICS group eng logo horisontal.png](https://commons.wikimedia.org/wiki/File:SITRONICS_group_eng_logo_horisontal.png) | Vshcherbatyuk | [CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) |
| `chosun.png` | [Chosun-University-Symbol.jpg](https://commons.wikimedia.org/wiki/File:Chosun-University-Symbol.jpg) | 조선대학교 (Chosun University) | [CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/) |

Both were resized and converted to PNG; no other changes were made. Neither was cropped.

Twelve come from assets each organization publishes itself (its website or brand kit) and carry
no stated redistribution license: `telepix`, `kari`, `kasi`, `naraspace`, `ktsat`, `kairospace`,
`planet`, `iridium`, `eutelsat`, `glonass`, `beidou`, `cgstl`.
No permission was obtained from any of these organizations; the files are not MIT-licensed
and stay their owners' property.

- `kari.png` is the symbol mark from KARI's official CI distribution, unaltered: it was only
  scaled down in proportion and converted from JPEG to PNG.
- `telepix.png` is the logomark badge from the brand kit TELEPIX distributes
  (`telepix-logo-external-use`).

Five files (`oneweb`, `spire`, `ses`, `intelsat`, `beidou`) were cropped to the symbol mark of the
original wordmark, because a wide wordmark is illegible at the size a satellite marker is drawn.
What was kept is recorded in
[`src/soda/assets/logos/SOURCES.md`](src/soda/assets/logos/SOURCES.md).

## Ground station coordinates

`frontend/src/stations/catalog/*.ts` lists published ground stations so a pass can be predicted
without typing coordinates. Each entry records the page its coordinate came from and the date it
was read; the full table is in
[`frontend/src/stations/SOURCES.md`](frontend/src/stations/SOURCES.md).

Most coordinates come from Wikidata property P625 (CC0). Geographic coordinates are facts and
carry no copyright; the sources are recorded for traceability, not because attribution is
required. The minimum elevation on each preset is a convention for that kind of network, not a
figure its operator published, and is meant to be edited in the app.

## Country flags

The station catalogue groups stations by country under a flag. The flags are SVG files from
[flag-icons](https://github.com/lipis/flag-icons) 7.5.0, imported one by one in
`frontend/src/stations/flags.ts` so only the countries the catalogue uses are bundled. Place search
results can name any country, so `frontend/src/places/flags.ts` emits every 4:3 flag as its own
asset, and the browser loads a flag only when a result shows it. The files are used unchanged.

```
The MIT License (MIT)

Copyright (c) 2013 Panayiotis Lipiridis

Permission is hereby granted, free of charge, to any person obtaining a copy of
this software and associated documentation files (the "Software"), to deal in
the Software without restriction, including without limitation the rights to
use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies
of the Software, and to permit persons to whom the Software is furnished to do
so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## Fonts

`frontend/public/fonts/PretendardVariable.woff2` — Pretendard by Kil Hyung-jin,
SIL Open Font License 1.1 (`frontend/public/fonts/LICENSE.txt`).

## Runtime data and services

- **CelesTrak** GP data: <https://celestrak.org>. Downloads follow the published usage policy (one download per 2-hour update).
- **Space-Track.org** data (optional): subject to the Space-Track user agreement. Use it only for local analysis and do not redistribute it.
- **JPL DE421** planetary ephemeris: downloaded at runtime by Skyfield.
- **Esri basemaps** (World Imagery, World Street Map, Gray Canvas): tiles are requested from `services.arcgisonline.com` at runtime and nothing from them ships in this repository. The attribution for the active basemap stays on screen in the credit strip at the bottom right of the globe. Use is subject to Esri's terms; heavy or commercial use may require an ArcGIS account.
- **Cesium ion / Bing Maps Aerial** (optional): available only when the user builds with their own Cesium ion token. While it is active the Cesium ion logo and the credits ion supplies are shown; otherwise no request goes to ion and the SODA mark sits in that place.
- **Maxar Open Data Program** (optional, on request): <https://registry.opendata.aws/maxar-open-data/>. The imagery tab can search it and download tiles the user picks into `data/imagery`. Licensed CC BY-NC 4.0: attribution required, non-commercial use only. Nothing from it ships in this repository; see the sample imagery below.
- **OpenAerialMap** (optional, on request): <https://openaerialmap.org>. Searched and downloaded the same way; each item carries its own licence, mostly CC BY 4.0, which SODA records with the set.
- **Sample imagery** (optional, the `samples` git submodule): cut-outs of open satellite imagery, re-tiled for the globe. They are not part of this repository and are fetched only when the submodule is. Each file's source, licence and attribution are listed in `samples/SOURCES.md` and stored in its sidecar. Sources: Maxar Open Data Program (CC BY-NC 4.0, non-commercial use only), SpaceNet on AWS (CC BY-SA 4.0; the derived tiles are shared under the same licence), Satellogic EarthView (CC BY 4.0), Umbra Open Data Program (CC BY 4.0), Capella Space Open Data (CC BY 4.0), and CNES SPOT World Heritage (Open Licence 2.0, Etalab).
- **Natural Earth II** texture: bundled with CesiumJS.
- **Natural Earth** vector data (public domain, <https://www.naturalearthdata.com>): `frontend/public/geo/` holds country names, extents and polygons (1:50m admin-0 countries), and capitals and large cities (1:10m populated places). `scripts/build_geo_data.py` simplifies and reduces them from release v5.1.2. Natural Earth draws de facto boundaries, and some are disputed. See `frontend/public/geo/SOURCES.md`.

## Orbit force models

- **EGM96** geopotential coefficients (NASA GSFC and NIMA, a U.S. Government work in the public domain): `src/soda/assets/gravity/egm96_20x20.txt` holds degrees 2 to 20, taken from the ICGEM distribution of the model. Cite Lemoine et al., *The Development of the Joint NASA GSFC and NIMA Geopotential Model EGM96*, NASA/TP-1998-206861. See `src/soda/assets/gravity/SOURCES.md`.
- **Harris-Priester** density table and the Cunningham recursion for the geopotential: `src/soda/orbit/hpop/atmosphere.py` and `gravity.py` implement the formulas and table 3.8 of O. Montenbruck and E. Gill, *Satellite Orbits: Models, Methods and Applications*, Springer, 2000. No code was copied; the table values were checked against Orekit's `HarrisPriester` class.

## Libraries

- **Backend**: FastAPI (MIT), Uvicorn (BSD-3-Clause), HTTPX (BSD-3-Clause), NumPy (BSD-3-Clause),
  SciPy (BSD-3-Clause), Skyfield (MIT), sgp4 (MIT; Vallado verification data), and rasterio
  (BSD-3-Clause), whose wheels bundle GDAL (MIT) and the libraries GDAL is built with.
- **Frontend**: Vue (MIT), Vue I18n (MIT), Vuetify (MIT), Pinia (MIT), lucide-vue-next (ISC),
  CesiumJS (Apache-2.0), satellite.js (MIT), and flag-icons (MIT).

Each package's license ships with the package in `.venv` / `frontend/node_modules`.
