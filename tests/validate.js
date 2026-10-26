/* EcoGrid validation harness — run with: node tests/validate.js
   Verifies data integrity and re-checks the scoring/load/SCI modules
   against independently hand-computed expectations. */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const ROOT = path.join(__dirname, "..");
let failures = 0, checks = 0;

function check(name, cond, detail) {
  checks++;
  if (!cond) { failures++; console.error("  ✗ " + name + (detail ? " — " + detail : "")); }
  else console.log("  ✓ " + name);
}
const section = t => console.log("\n== " + t + " ==");

/* ---- module loading with a window shim ---- */
global.window = global;
for (const mod of ["scoring", "load", "sci"]) {
  vm.runInThisContext(fs.readFileSync(path.join(ROOT, "js", mod + ".js"), "utf8"),
    { filename: mod + ".js" });
}

/* ---- data files ---- */
section("data files parse + integrity");
const read = f => JSON.parse(fs.readFileSync(path.join(ROOT, f), "utf8"));
const sites = read("data/sites.geojson");
const subs = read("data/substations.geojson");
const hws = read("data/highways.geojson");
const carbon = read("data/grid-carbon.json");
const telemetry = read("data/telemetry.json");

const props = sites.features.map(f => f.properties);
check("8 candidate sites", props.length === 8, String(props.length));
check("15 substations", subs.features.length === 15, String(subs.features.length));
check("4 highway corridors", hws.features.length === 4, String(hws.features.length));
check("24 carbon hours", carbon.hours.length === 24);
check("24 telemetry hours", telemetry.hours.length === 24);

const REQ = ["id","name","district","parcelId","landUse","highwayId","highwayDistanceM",
  "nearestSubstationId","gridDistanceM","feederVoltage","parcelAreaSqM","avgSlopeDeg",
  "floodRisk","solarPeakSunHours","gridHeadroomPct","chargerCount","transformerCapacityKva",
  "estimatedCapexInrCrore","utilizationPct","carbonIntensityGPerKwh","carbonSavingsKgCO2e",
  "status","notes"];
check("all site properties present", props.every(p => REQ.every(k => p[k] !== undefined && p[k] !== "")));

const subIds = new Set(subs.features.map(f => f.properties.id));
const hwIds = new Set(hws.features.map(f => f.properties.id));
check("every site references a real substation", props.every(p => subIds.has(p.nearestSubstationId)));
check("every site references a real highway", props.every(p => hwIds.has(p.highwayId)));
check("coordinates inside Odisha bbox",
  sites.features.every(f => {
    const [lon, lat] = f.geometry.coordinates;
    return lon > 83 && lon < 87.6 && lat > 17.7 && lat < 22.6;
  }));

/* ---- scoring ---- */
section("weighted MCDA scoring (hand-computed expectations ±1)");
const S = global.EcoGridScoring;
check("weights sum to 1.0",
  Math.abs(Object.values(S.WEIGHTS).reduce((a, b) => a + b, 0) - 1) < 1e-9);

const scored = S.scoreAll(sites.features);
const byId = Object.fromEntries(scored.map(s => [s.id, s]));
/* expectations recomputed by hand from METHODOLOGY.md rules */
const EXPECT = {
  "EG-01": { pct: 99, band: "recommended" },
  "EG-02": { pct: 92, band: "recommended" },
  "EG-03": { pct: 83, band: "viable" },
  "EG-04": { pct: 72, band: "viable" },
  "EG-05": { pct: 75, band: "viable" },
  "EG-06": { pct: 44, band: "notrec" },
  "EG-07": { pct: 64, band: "marginal" },
  "EG-08": { pct: 70, band: "viable" }
};
for (const [id, e] of Object.entries(EXPECT)) {
  check(`${id} scores ${e.pct} (${e.band})`,
    byId[id].percent === e.pct && byId[id].classification.key === e.band,
    `got ${byId[id].percent} ${byId[id].classification.key}`);
}
check("ranking is descending", scored.every((s, i) => i === 0 || scored[i - 1].percent >= s.percent));
check("criterion contributions sum to the weighted score",
  scored.every(s => Math.abs(Object.values(s.criteria).reduce((a, c) => a + c.contribution, 0) - s.weighted) < 1e-9));

/* ---- load model ---- */
section("240 kW load model");
const L = global.EcoGridLoad;
const eg01 = props.find(p => p.id === "EG-01");
const user = { chargers: 4, utilization: 14, chargerKw: 240, diversity: 0.82, custom: false, minSubHeadroom: 25 };
const f = L.feasibility(eg01, user);
check("connected load 960 kW", f.connectedKw === 960, String(f.connectedKw));
check("diversified peak 787.2 kW", Math.abs(f.peakKw - 787.2) < 1e-6, String(f.peakKw));
check("apparent power ≈ 828.6 kVA", Math.abs(f.needKva - 787.2 / 0.95) < 1e-6);
check("EG-01 feasible on its 1,260 kVA bank", f.feasible === true && f.transformerKva === 1260);
check("annual energy ≈ 965 MWh", Math.abs(f.energyKwh - 787.2 * 0.14 * 8760) < 1 && f.energyKwh > 960000, String(f.energyKwh));
check("next standard transformer for 960 kW raw is 1,000 kVA", L.nextTransformerKva(960 * 0.82 / 0.95) === 1000);
const f04 = L.feasibility(props.find(p => p.id === "EG-04"),
  { chargers: 6, utilization: 16, chargerKw: 240, diversity: 0.82, custom: false, minSubHeadroom: 25 });
check("EG-04 constrained by substation headroom (12% spare)", f04.feasible === false, JSON.stringify(f04.notes));

/* ---- SCI ---- */
section("SCI + time-shift");
const G = global.EcoGridSCI;
const r = G.computeSCI(964912, 694, 4050, 34461);
check("SCI per session ≈ 19.55 kgCO2e", Math.abs(r.perUnit - 19.55) < 0.01, String(r.perUnit));
check("operational kg = E×I/1000", Math.abs(r.operationalKg - 964912 * 694 / 1000) < 1e-6);
check("embodied: 4 chargers + 1,260 kVA ≈ 993 kg/yr",
  Math.abs(G.embodiedPerYear(4, 1260, 0) - (4 * 400 + 1.26 * 250) / 4) < 1e-9,
  String(G.embodiedPerYear(4, 1260, 0)));

const I = {}, kWh = {};
carbon.hours.forEach(h => { I[h.hour] = h.gco2PerKwh; });
telemetry.hours.forEach(h => { kWh[h.hour] = h.avgKw; });
const plan = G.shiftPlan(kWh, I, 25);
const sumBefore = Object.values(kWh).reduce((a, b) => a + b, 0);
const after = { ...kWh };
for (const mv of plan.moves) { after[mv.from] -= mv.kwh; after[mv.to] += mv.kwh; }
const sumAfter = Object.values(after).reduce((a, b) => a + b, 0);
check("shift conserves energy", Math.abs(sumBefore - sumAfter) < 1e-6, `${sumBefore} vs ${sumAfter}`);
check("shift moves energy to cleaner hours and saves > 0",
  plan.movedTotal > 0 && plan.savingsKg > 0,
  `moved ${plan.movedTotal.toFixed(1)} kWh, saved ${plan.savingsKg.toFixed(2)} kg`);
check("no target hour overfilled past sink cap",
  Object.keys(plan.moved).every(src =>
    after[plan.moves.find(m => m.from === +src).to] <= plan.threshold * 0.75 + 1e-6));

/* ---- payload budget (static, from disk) ---- */
section("static payload budget");
const staticBytes = ["index.html", "css/styles.css", ...fs.readdirSync(path.join(ROOT, "js")).map(f => "js/" + f),
  ...fs.readdirSync(path.join(ROOT, "data")).map(f => "data/" + f)]
  .reduce((a, f) => a + fs.statSync(path.join(ROOT, f)).size, 0);
check(`first-party assets ≤ 500 KB (got ${(staticBytes / 1024).toFixed(1)} KB)`, staticBytes <= 500 * 1024);

console.log(`\n${checks - failures}/${checks} checks passed`);
process.exit(failures ? 1 : 0);
