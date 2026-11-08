# Data and sources

## Flight data
- **Flight history:** adsb.lol globe_history (github.com/adsblol/globe_history_2025, _2026), made available under the Open Database License (ODbL 1.0, opendatacommons.org/licenses/odbl/1.0/). The per-day extracts in `data/history/` and everything derived from them in `web/data/` are a derived database and are published under the same ODbL 1.0 terms. Format: readsb trace JSON (github.com/wiedehopf/readsb, README-json.md).
- **Live traffic:** adsb.lol API (api.adsb.lol), ODbL 1.0, through a small cache proxy (the API sends no CORS header).
- ADS-B coverage depends on volunteer receivers. A day the archive lacks is listed as missing, never filled in.

## Boeing figures
- Monthly deliveries by model: Boeing Orders and Deliveries and Boeing quarterly delivery releases, with monthly splits from Forecast International's monthly reports. Every row in `web/data/deliveries.json` carries its source URL.
- Boeing is not affiliated with this project and does not endorse it. No Boeing logos or artwork are used.

## Map
- Terrain: Terrarium elevation tiles (AWS Open Data, Mapzen/Tilezen; sources include USGS 3DEP and SRTM).
- Imagery: USGS The National Map, Imagery Only basemap (public domain).
- Buildings and runways: OpenStreetMap contributors, ODbL 1.0 (openstreetmap.org/copyright).
- Weather: Open-Meteo (CC BY 4.0).

## Code
three.js 0.169.0 (MIT) via jsDelivr. Project code: MIT (see LICENSE).
