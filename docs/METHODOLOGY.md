# EcoGrid Methodology — Suitability Model, Load & SCI Math

This document is the audit trail for every number the dashboard computes. The client-side JavaScript (`js/scoring.js`, `js/load.js`, `js/sci.js`) is a faithful port of the desktop ArcGIS Pro / spreadsheet analysis; nothing is recomputed server-side.

---

## 1. Geospatial suitability model (MCDA)

### 1.1 Analysis environment

| Setting | Value |
|---|---|
| Projected CRS (analysis) | **UTM Zone 45N, EPSG:32645** (metres — correct for Odisha, 84°E–90°E) |
| Storage CRS (web export) | WGS 84, EPSG:4326 |
| Distance rasters | Euclidean (straight-line) from source features, 30 m cell size |
| Overlay method | Weighted overlay (reclassify → multiply by weight → sum) |

Straight-line distance is a deliberate simplification: at screening stage it approximates road-network travel for the 200 m / 400 m thresholds used, and avoids a least-cost-path stage that would multiply the geoprocessing cost.

### 1.2 Criteria and reclassification

All raw values are reclassified to a 0–1 suitability score `s`, then combined by

```
Suitability = Σ (wᵢ × sᵢ)        Σ wᵢ = 1.0
```

| # | Criterion | Weight | Raw input | Reclassification rule |
|---|---|---|---|---|
| 1 | Highway access | 0.25 | distance to NH corridor (`highwayDistanceM`) | `min(1, 200 / d)` — full score inside 200 m, hyperbolic decay beyond |
| 2 | Grid proximity | 0.25 | distance to 11/33 kV substation (`gridDistanceM`) | `min(1, 400 / d)` — full score inside 400 m |
| 3 | Land availability | 0.15 | parcel area (`parcelAreaSqM`) | `min(1, area / 1200)` — 1,200 m² fits 4 dispensers + canopies + turning radii |
| 4 | Terrain slope | 0.10 | mean parcel slope (`avgSlopeDeg`) | 1.0 ≤ 2°; 0.05 ≥ 15°; linear penalty between (grading cost + drainage) |
| 5 | Grid headroom | 0.10 | substation spare capacity (`gridHeadroomPct`) | `(spare − 8) / 22` clamped to [0, 1] — <8% means no firm connection offer |
| 6 | Flood risk | 0.08 | flood-hazard class (`floodRisk`) | low 1.0 · medium 0.55 · high 0.15 (coastal/deltaic Odisha — Kathajodi, Budhabalanga backwaters) |
| 7 | Solar irradiance | 0.07 | peak sun hours (`solarPeakSunHours`) | `(PSH − 4.6) / 0.8` clamped to [0, 1] |

**Weighting rationale:** access + grid together carry 50% because they are the two *unfixable* criteria — traffic you cannot move, feeders you must not overbuild. Land, slope and flood are partially mitigable (roofing, grading, plinth elevation), so they carry lower weights. Weights were stress-tested with an equal-weights variant (exposed as `equalAverage` in `scoring.js`); the recommended set is stable under both.

### 1.3 Decision bands

| Score | Class | Action |
|---|---|---|
| ≥ 85 | Recommended | proceed to detailed engineering |
| 65–84 | Viable | viable with mitigation / phase-2 |
| 45–64 | Marginal | re-evaluate if criteria change |
| < 45 | Not recommended | reject |

### 1.4 Worked example — EG-01 Khandagiri Corridor Hub

| Criterion | Raw | Score × Weight = Contribution |
|---|---|---|
| Highway access | 90 m | 1.000 × 0.25 = 0.250 |
| Grid proximity | 220 m | 1.000 × 0.25 = 0.250 |
| Land availability | 1,450 m² | 1.000 × 0.15 = 0.150 |
| Terrain slope | 1.8° | 1.000 × 0.10 = 0.100 |
| Grid headroom | 28% | 0.909 × 0.10 = 0.091 |
| Flood risk | low | 1.000 × 0.08 = 0.080 |
| Solar irradiance | 5.42 PSH | 1.000 × 0.07 = 0.070 |
| **Total** | | **0.991 → 99/100 · Recommended** |

---

## 2. Electrical load model (240 kW DCFC)

```
Connected load  P_c   = n × 240 kW                    (n dispensers)
Diversified peak P_pk = P_c × 0.82                    (coincidence/diversity factor)
Apparent power  S     = P_pk / 0.95                   (power factor)
Annual energy   E     = P_pk × (u/100) × 8,760 h      (u = utilization %)
```

* **Diversity factor 0.82** — field-observed coincidence for 4-bay highway plazas (vehicles rarely all charge at 240 kW simultaneously; battery pre-conditioning windows overlap).
* **Utilization 14%** default — first-year target capacity factor for a healthy NH corridor site; the slider spans 4–30% (mature highway DCFC utilization ranges ~8–20%).
* **Feasibility rule (N-1 friendly):** station apparent power ≤ 85% of the dedicated transformer **and** upstream substation spare capacity ≥ 25%. Both must hold.
* Transformer is selected from standard distribution sizes: 315/500/630/1000/1260/1600/2000/2500 kVA.
* **Capex (custom configs):** `₹(0.55n + 0.25·d_km + 0.6) Cr` — dispensers+install ≈ ₹55 L each, 33/11 kV line extension ≈ ₹25 L per km, fixed civil works ₹60 L. Indicative 2026 Indian market rates only.

### 2.1 Solar + storage dispatch (chart)

1. Solar canopy generation scales a reference 300 kWp shape (peak hour 201 kWh) linearly with slider kWp.
2. Grid draw baseline = charger demand − solar (surplus clipped at 0, i.e. no export modeled).
3. Battery (if > 0): charges at ≤ 0.5C from midday solar surplus (09–15 h), discharges at ≤ 0.5C against evening peak (17–21 h).

---

## 3. Software Carbon Intensity (GSF model)

```
SCI = ((E × I) + M) / R
```

| Term | Meaning | Default in dashboard |
|---|---|---|
| E | energy consumed (kWh/yr) | from the load model for the selected site |
| I | grid carbon intensity (gCO₂e/kWh) | annual mean of the 24 h profile (~694) |
| M | embodied carbon, amortized (kgCO₂e/yr) | 400 kg/dispenser + 250 kg per MVA transformer + 60 kg/kWh battery, straight-line over 4 years |
| R | functional unit (sessions/yr) | E ÷ 28 kWh avg session |

Unit care: `E × I` yields **grams** (kWh × g/kWh), converted to kg before combining with M.

### 3.1 Time-shift heuristic

For each hour `h` with energy `e[h]` and intensity `I[h]`:

1. Threshold `T = mean(e) × 1.25` — energy above the threshold is flexible.
2. Surplus at hour `h`: `max(0, e[h] − T)`.
3. Sinks = hours sorted by `I` ascending; sink capacity per hour `max(0, 0.75T − e[t])` (mimics a 0.5C battery dispatch cap; no hour is overfilled).
4. Greedy match: highest-intensity surplus → lowest-intensity sink with `I[t] < I[s]`.
5. Savings `Σ moved × (I[s] − I[t]) / 1000` kgCO₂e.

This is deliberately a **heuristic**, not an optimization: it demonstrates the lever with O(24 log 24) compute. Production scheduling would be a MILP over an OCPP 2.0.1 telemetry stream with charger-level power ramps and session-completion constraints.

---

## 4. Data schema — `sites.geojson` properties

| Property | Unit | Used by |
|---|---|---|
| `id`, `name`, `district`, `parcelId`, `landUse`, `status`, `notes` | — | display |
| `highwayId`, `highwayDistanceM` | m | criterion 1 |
| `nearestSubstationId`, `gridDistanceM`, `feederVoltage` | m / kV | criterion 2 |
| `parcelAreaSqM` | m² | criterion 3 |
| `avgSlopeDeg` | ° | criterion 4 |
| `gridHeadroomPct` | % | criterion 5 |
| `floodRisk` | class | criterion 6 |
| `solarPeakSunHours` | h/day | criterion 7 |
| `chargerCount`, `transformerCapacityKva`, `estimatedCapexInrCrore` | — | load model |
| `utilizationPct`, `carbonIntensityGPerKwh`, `carbonSavingsKgCO2e` | %, g/kWh, kg/yr | SCI + KPIs |

`carbonSavingsKgCO2e` compares served EV-km against a diesel baseline: diesel ≈ 2.68 kgCO₂e/L at 13.3 km/L, EV ≈ 0.18 kWh/km at site grid intensity.

---

## 5. Data honesty statement

* Site/substation/highway geometry and all attribute values are **synthetic demo data** authored for this portfolio piece. They follow realistic Indian planning norms but are not survey outputs.
* `data/grid-carbon.json` is a representative diurnal profile synthesized from published load-curve shapes for a thermal-heavy eastern-regional grid. A production build would consume a live signal (ElectricityMaps, grid operator APIs) and cache it per the green-software polling pattern.
* `data/telemetry.json` is generated by `scripts/simulate_telemetry.py` to emulate an OCPP 2.0.1 TransactionEvent stream at 120 samples/hour.
