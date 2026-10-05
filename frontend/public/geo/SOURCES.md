# Geographic data sources

These files come from [Natural Earth](https://www.naturalearthdata.com) (public domain), release
v5.1.2 on [GitHub](https://github.com/nvkelso/natural-earth-vector/tree/v5.1.2/geojson).
`scripts/build_geo_data.py` simplifies them to a 0.01° grid and keeps only the fields the app
uses. Edit that script and run it again rather than editing the JSON by hand.

| File | Natural Earth layer | Contents |
| --- | --- | --- |
| `countries.json` | `ne_50m_admin_0_countries` | Korean and English names, label point, and mainland extent for each country (joined to the polygons by `a3`) |
| `country-shapes.json` | `ne_50m_admin_0_countries` | Country polygons with the MAPCOLOR7 colour group, for the tint overlay and pin names |
| `places.json` | `ne_10m_populated_places` | Capitals, plus cities with scale rank 6 or lower |

Natural Earth draws de facto boundaries, and some of them are disputed. The data was retrieved
on 2026-09-25.
