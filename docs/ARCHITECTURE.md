# EcoGrid Architecture — Green Software Engineering Decisions

Every architectural choice in EcoGrid is made against two budgets: a **page-weight budget (≤ 500 KB total, layers ≤ 180 KB each)** and a **compute budget (no periodic work, render on demand only)**. This document records the decisions and their measured consequences.

```
┌──────────────────────────────────────────────────────────────┐
│  OFFLINE / DESKTOP GEOSPATIAL ETL (Esri ArcGIS Pro)          │
│  raw satellite imagery + parcels + highways + grid assets    │
│  → reproject to UTM 45N → buffers/Euclidean distance         │
│  → reclassify → weighted overlay → Douglas-Peucker simplify  │
│  → export GeoJSON under byte budget (scripts/simplify_…)     │
└──────────────────────┬───────────────────────────────────────┘
                       │  pre-computed artifacts (data/*.geojson|json)
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  STATIC WEB DASHBOARD (this repo, no backend)                │
│  index.html + 6 small ES5-compatible JS modules + Leaflet    │
│  scoring · load model · SCI · time-shift  → all client-side  │
└──────────────────────┬───────────────────────────────────────┘
                       │  telemetry artifacts
                       ▼
┌──────────────────────────────────────────────────────────────┐
│  CARBON-AWARE TELEMETRY LAYER                                │
│  simulated OCPP 2.0.1 stream (scripts/simulate_telemetry.py) │
│  → hourly aggregation → SCI computation → shift scheduling   │
└──────────────────────────────────────────────────────────────┘
```

## Decision log

### 1. No SPA framework — static HTML + vanilla JS
**Decision:** hand-written ES2017+ JS split into 6 small modules, no bundler, no `node_modules`.
**Why:** the equivalent feature set on Angular/Next.js starts around 200 KB gzipped of framework + hydration runtime, most of which re-renders things this app renders once. EcoGrid ships ~35 KB of first-party JS. The burn-down is visible on the *Green engineering* tab, which measures real transferred bytes via the Resource Timing API.
**Tradeoff accepted:** no component ecosystem; acceptable because the UI surface is small and stable.

### 2. Pre-computed geospatial artifacts instead of a geo-API
**Decision:** the dashboard consumes finalized GeoJSON/JSON files; no PostGIS/API tier.
**Why:** suitability scores change at the cadence of GIS analysis (weekly/seasonal), not per request. Serving pre-computed artifacts turns every user visit into a CDN cache hit — near-zero marginal compute and the lowest possible operational SCI. A PostGIS + Mapbox GL/Deck.gl rebuild is the planned next iteration (see README).
**Tradeoff accepted:** no ad-hoc spatial queries in the browser.

### 3. Douglas-Peucker geometry simplification with a byte budget
**Decision:** `scripts/simplify_geojson.py` simplifies polylines/polygons to a tolerance and coordinate precision chosen so each layer fits its budget (highways < 40 KB, sites < 30 KB), keeping ≥ 99% boundary fidelity at the dashboard's working zoom (z ≤ 13).
**Why:** raw 400 MB+ shapefile/imagery inputs cannot reach a browser; the browser only needs *screen* fidelity.
**Details:** quantize coordinates to 3 decimals (~100 m at this latitude) with `round-half-even`, drop degenerate rings, minify JSON (no whitespace), and fail the export if the budget is exceeded — the budget is enforced, not aspirational.

### 4. Raster tiles tinted with one CSS filter, not a vector-tile stack
**Decision:** OSM raster tiles + `.map-dark .leaflet-tile { filter: brightness(0.6) invert(1) contrast(3) hue-rotate(200deg) saturate(0.3) brightness(0.7) }`.
**Why:** vector basemaps (Mapbox/Protomaps) need their own runtime + token + ~150 KB extra JS. One CSS line costs effectively zero bytes and zero client CPU beyond the GPU compositing the browser already does.
**Tradeoff accepted:** tile rasterization happens upstream; slightly higher tile bytes than true vector tiles, still tiny at our zoom ceiling.

### 5. Charts: a ~3 KB canvas module, not a chart library
**Decision:** `js/charts.js` — DPR-aware canvas line charts, one hover tooltip, grid ticks. ~120 lines.
**Why:** Chart.js/ECharts would add 50–100 KB+ for features this dashboard never uses. The module is measured in the payload audit like everything else.
**Accessibility:** every canvas carries an `aria-label`; the same numbers are available in the tables.

### 6. Compute on demand — no polling loops, no `setInterval`
**Decision:** every widget renders on user interaction (slider input, tab switch, click) or once at boot. No heartbeat fetches, no live-clock timers, no scroll handlers.
**Why:** polling is the classic carbon smell in monitoring software: identical requests returning identical bytes burn both network and client CPU. The (simulated) OCPP feed is aggregated hourly *upstream* precisely so the dashboard never has to poll.
**Note:** `setTimeout(runPayloadAudit, 400)` at boot is a single delayed measurement, not a loop.

### 7. Payload measurement as a first-class feature
**Decision:** the *Green engineering* tab sums `transferSize` for every resource and displays the total against the 500 KB budget, with a per-file breakdown. The Overview KPI mirrors it.
**Why:** a green-software claim you can't measure is marketing. The audit is the receipt and doubles as a regression check after edits.

### 8. Dark theme, system fonts, reduced motion
**Decision:** dark palette tuned for OLED (fewer lit pixels), `system-ui` font stack (0 webfont bytes, 0 layout shift), `prefers-reduced-motion` disables the view transitions.
**Why:** end-user device energy is part of the SCI of the software *using* this dashboard, not just the server.

### 9. Caching strategy (deployment)
**Decision:** served via GitHub Pages with long-lived caching for `css/`, `js/`, `data/` (content-hash via cache-busting on releases when needed), short TTL for `index.html`.
**Why:** repeat visits should hit the browser cache, not the network — the cheapest kilobyte is the one never transferred.

## What the next iteration would add

1. **PostGIS + live tiles** — real parcel/feeder datasets, tile-server rendering (tl_ / Martin), Mapbox GL JS or Deck.gl front end.
2. **OCPP 2.0.1 WebSocket telemetry** — real charger sessions streaming in, driving the load profile and SCI per station.
3. **Live grid signal** — ElectricityMaps/POSOCO API fetched hourly *server-side*, cached, and exposed as a static JSON so the client still makes zero polling requests.
4. **CSRD/GRI reporting export** — one-click PDF of avoided-emissions reporting per site.
