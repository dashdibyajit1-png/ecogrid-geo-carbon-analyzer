# EcoGrid · Geo-Spatial & Carbon-Aware EV Charging Analyzer

A static-first web dashboard that fuses **geospatial multi-criteria siting analysis for 240 kW DC fast-charging stations** with **carbon-aware software telemetry** (Green Software Foundation SCI). Built for the Odisha (India) highway corridors, 2026.

**No backend, no build step, no framework.** All scoring runs client-side over pre-computed, Douglas-Peucker-simplified GeoJSON — in line with Sustainable Software Engineering (HPI / AWS Sustainability Pillar / Green Software Foundation).

## ✨ Features

| Tab | What it does |
|---|---|
| **Overview** | Weighted suitability ranking of 8 candidate sites with per-criterion scorecards, 24 h grid-carbon curve, portfolio KPIs |
| **Site explorer** | Leaflet map with band-colored site markers, highway corridors and grid substations, clickable scorecards |
| **Load estimator** | Interactive 240 kW charger sizing: diversified peak, transformer loading, N-1 headroom rule, solar-canopy + battery dispatch profile |
| **Carbon & SCI** | Live `SCI = ((E × I) + M) / R` calculator and a time-shifted charging simulation that moves flexible kWh into low-carbon grid windows |
| **Green engineering** | The green-software rationale + a **live payload audit** measured in your browser against a 500 KB budget |

## 🚀 Run it

```bash
# any static file server works — the app is pure HTML/JS/JSON
git clone https://github.com/dashdibyajit1-png/ecogrid-geo-carbon-analyzer
cd ecogrid-geo-carbon-analyzer

# Windows PowerShell (no Node/Python needed):
powershell -ExecutionPolicy Bypass -File scripts/serve.ps1
# → http://localhost:8080

# or Python:
python -m http.server 8080
# or Node:
npx serve .
```

Live deployment: **GitHub Pages** serves the repo root directly (see *Deployment* below).

> Opening `index.html` directly from disk (`file://`) will fail to `fetch()` the data files — that's a browser security restriction, not a bug. Serve the folder over HTTP as shown above.

## 🗂 Repository layout

```
├── index.html               # the whole dashboard shell
├── css/styles.css           # single stylesheet, system fonts, dark palette
├── js/
│   ├── charts.js            # ~3 KB dependency-free canvas line chart
│   ├── scoring.js           # weighted MCDA — mirrors the ArcGIS weighted overlay
│   ├── load.js              # 240 kW charger electrical estimator
│   ├── sci.js               # SCI + time-shift heuristics
│   ├── map.js               # Leaflet layers/markers
│   └── app.js               # orchestration, no framework
├── data/
│   ├── sites.geojson        # 8 candidate parcels + engineering attributes
│   ├── substations.geojson  # grid substations (132/33/11 kV)
│   ├── highways.geojson     # simplified NH-16 / NH-55 alignments
│   ├── grid-carbon.json     # hourly gCO2e/kWh profile (eastern region)
│   └── telemetry.json       # simulated OCPP 2.0.1 station telemetry
├── scripts/
│   ├── simplify_geojson.py  # Douglas-Peucker export with byte budget
│   ├── simulate_telemetry.py# generates data/telemetry.json
│   └── serve.ps1            # zero-dependency local HTTP server
└── docs/
    ├── METHODOLOGY.md       # scoring model, formulas, data sources
    └── ARCHITECTURE.md      # green-software engineering decisions
```

## 🧮 The suitability model (short version)

Seven weighted criteria reproduce the ArcGIS Pro weighted-overlay logic in `js/scoring.js`:

| Criterion | Weight | Reclassification |
|---|---|---|
| Highway access | 0.25 | 200 m ingress target, decaying with distance |
| Grid proximity | 0.25 | 400 m feeder target, decaying with distance |
| Land availability | 0.15 | parcel area vs 1,200 m² minimum |
| Terrain slope | 0.10 | full score ≤ 2°, linear penalty to 15° |
| Grid headroom | 0.10 | substation spare capacity, 8–30% band |
| Flood risk | 0.08 | low 1.0 / medium 0.55 / high 0.15 |
| Solar irradiance | 0.07 | peak-sun-hours vs 4.6–5.4 h band |

Bands: **Recommended ≥ 85 · Viable 65–84 · Marginal 45–64 · Not recommended < 45.**
Full derivations: [docs/METHODOLOGY.md](docs/METHODOLOGY.md).

## ⚡ SCI model

`SCI = ((E × I) + M) / R` per the Green Software Foundation specification — energy × grid intensity + amortized embodied hardware, divided by the functional unit (one charging session). The dashboard also demonstrates **time-shifting**: the biggest lever when I is fixed, identical to scheduling batch compute into clean grid windows.

## 🌍 Deployment (GitHub Pages)

The repo is Pages-ready — root `index.html`, relative paths only:

1. **Settings → Pages → Source: Deploy from a branch → `main` / `(root)`**, or
2. Push and the included GitHub Actions deploy (`.github/workflows/deploy-pages.yml`) publishes automatically if you prefer Actions as the source.

## 📊 Data provenance & honesty

* Geometry and attribute values are **synthetic demo data** built for portfolio illustration — they follow realistic Indian DISCOM planning norms (11/33 kV feeders, 1,200 m² parcels, ₹3–5 Cr capex) but are **not for engineering or construction use**.
* The grid-carbon curve is a representative synthesized diurnal profile; production integrations would use a live signal (e.g. ElectricityMaps API) — see `data/grid-carbon.json` header.
* Basemap © [OpenStreetMap](https://www.openstreetmap.org/copyright) contributors (dark-tinted via CSS), OpenTopoMap for terrain.

## 🛠 Extending

* Swap `data/*.geojson` with your own exports (keep the property schema from `docs/METHODOLOGY.md`).
* Tune the weights or bands in `js/scoring.js` — every scorecard recomputes instantly.
* `scripts/simplify_geojson.py --max-bytes 180000 data_raw/sites_full.geojson data/sites.geojson` enforces the payload budget on export.

## License

MIT — see [LICENSE](LICENSE).
