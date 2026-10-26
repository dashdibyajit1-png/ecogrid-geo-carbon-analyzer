/* ============================================================
   EcoGridApp — orchestrates data loading, scoring, the table,
   the map, the load estimator, the SCI calculator and the
   green-software budget panel. No framework, no build step.
   ============================================================ */
(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const fmt = (v, d) => Number(v).toLocaleString("en-IN", { maximumFractionDigits: d == null ? 2 : d });
  const DATA_FILES = ["sites", "substations", "highways", "grid-carbon", "telemetry"];

  const state = {
    data: {},
    scored: [],
    selectedId: null,
    sortKey: "percent",
    sortDir: -1,
    carbonChartShifted: null
  };

  /* ---------------- data loading ---------------- */

  async function loadData() {
    const results = await Promise.all(DATA_FILES.map(async name => {
      const res = await fetch("data/" + name + (name === "sites" || name === "substations" || name === "highways" ? ".geojson" : ".json"));
      if (!res.ok) throw new Error("Failed to load data/" + name + " (HTTP " + res.status + ")");
      return [name, await res.json()];
    }));
    results.forEach(([name, json]) => { state.data[name] = json; });
  }

  /* ---------------- helpers ---------------- */

  const BAND_LABELS = { recommended: "Recommended", viable: "Viable", marginal: "Marginal", notrec: "Not recommended" };
  const BAND_COLORS = { recommended: "#34d399", viable: "#38bdf8", marginal: "#fbbf24", notrec: "#fb7185" };

  function siteById(id) { return state.scored.find(s => s.id === id); }
  function intensityMap() {
    const m = {};
    state.data["grid-carbon"].hours.forEach(h => { m[h.hour] = h.gco2PerKwh; });
    return m;
  }

  function showFatal(err) {
    const box = $("app-error");
    if (!box) return;
    box.classList.add("show");
    $("app-error-msg").textContent =
      err.message + " — if you opened index.html directly from disk, serve the folder over HTTP instead (see README → Local development).";
    console.error(err);
  }

  /* ---------------- KPIs ---------------- */

  function renderKpis() {
    const s = state.scored;
    const totalChargers = s.reduce((a, x) => a + x.props.chargerCount, 0);
    const carbonT = s.reduce((a, x) => a + x.props.carbonSavingsKgCO2e, 0) / 1e6;
    const recommended = s.filter(x => x.classification.key === "recommended").length;

    $("kpi-sites").textContent = s.length;
    $("kpi-sites-sub").textContent = "candidate parcels · Odisha corridors";
    $("kpi-recommended").textContent = recommended;
    $("kpi-recommended-sub").textContent = "score ≥ 85 of 100";
    $("kpi-capacity").textContent = totalChargers + " × 240 kW";
    $("kpi-capacity-sub").textContent = fmt(totalChargers * 240 / 1000, 1) + " MW connected DC capacity";
    $("kpi-carbon").textContent = carbonT.toFixed(1) + " kt";
    $("kpi-carbon-sub").textContent = "CO₂e avoided per year vs diesel, at target utilization";
    const est = estimatePayload();
    if (est.total > 0) {
      $("kpi-payload").textContent = (est.total / 1024).toFixed(0) + " KB";
      $("kpi-payload-sub").textContent = "measured app payload vs 500 KB green budget";
      $("kpi-payload").closest(".kpi").classList.add(est.total / 1024 <= 500 ? "accent" : "warn");
    } else {
      $("kpi-payload").textContent = "≤ 200 KB";
      $("kpi-payload-sub").textContent = "engineered budget (open the live site to measure)";
    }
  }

  function estimatePayload() {
    let total = 0; const rows = [];
    const nav = performance.getEntriesByType("navigation")[0];
    if (nav && (nav.transferSize || nav.encodedBodySize)) {
      const html = nav.transferSize || nav.encodedBodySize;
      rows.push({ name: "index.html", bytes: html });
      total += html;
    }
    performance.getEntriesByType("resource").forEach(r => {
      if (!/\.(js|css|json|geojson|png)(\?|$)/.test(r.name)) return;
      const bytes = r.transferSize || r.encodedBodySize || r.decodedBodySize || 0;
      rows.push({ name: r.name.split("/").pop().split("?")[0], bytes });
      total += bytes;
    });
    return { total, rows };
  }

  /* ---------------- rank table ---------------- */

  const COLUMNS = [
    { key: "id", label: "ID" },
    { key: "name", label: "Site" },
    { key: "district", label: "District" },
    { key: "percent", label: "Score" },
    { key: "highwayDistanceM", label: "Hwy" },
    { key: "gridDistanceM", label: "Grid" },
    { key: "chargers", label: "Config" },
    { key: "estimatedCapexInrCrore", label: "Capex" },
    { key: "status", label: "Status" }
  ];

  function renderTable() {
    const dir = state.sortDir, key = state.sortKey;
    const rows = state.scored.slice().sort((a, b) => {
      const av = key === "chargers" ? a.props.chargerCount : key === "percent" ? a[key] : a.props[key];
      const bv = key === "chargers" ? b.props.chargerCount : key === "percent" ? b[key] : b.props[key];
      if (typeof av === "number") return (av - bv) * dir;
      return String(av).localeCompare(String(bv)) * dir;
    });

    const thead = $("rank-thead");
    thead.innerHTML = COLUMNS.map(c => {
      const arrow = c.key === key ? '<span class="arrow">' + (dir === 1 ? "▲" : "▼") + "</span>" : "";
      return "<th data-sort='" + c.key + "'>" + c.label + arrow + "</th>";
    }).join("");

    const tb = $("rank-tbody");
    tb.innerHTML = "";
    rows.forEach(s => {
      const p = s.props;
      const tr = document.createElement("tr");
      tr.className = s.id === state.selectedId ? "selected" : "";
      tr.innerHTML =
        "<td class='mono'>" + s.id + "</td>" +
        "<td><strong>" + p.name + "</strong></td>" +
        "<td>" + p.district + "</td>" +
        "<td><div class='score-cell'><div class='bar" +
          (s.percent >= 85 ? "" : s.percent >= 65 ? " cyan" : s.percent >= 45 ? " warn" : " danger") +
          "'><span style='width:" + s.percent + "%'></span></div><span class='num'>" + s.percent + "</span>" +
          "<span class='badge " + s.classification.key + "' style='margin-left:6px'>" + BAND_LABELS[s.classification.key] + "</span></div></td>" +
        "<td class='num'>" + p.highwayDistanceM + " m</td>" +
        "<td class='num'>" + p.gridDistanceM + " m</td>" +
        "<td class='num'>" + p.chargerCount + " × 240 kW</td>" +
        "<td class='num'>₹" + p.estimatedCapexInrCrore + " Cr</td>" +
        "<td class='small muted'>" + p.status + "</td>";
      tr.addEventListener("click", () => selectSite(s.id));
      tb.appendChild(tr);
    });

    thead.querySelectorAll("th").forEach(th =>
      th.addEventListener("click", () => {
        const k = th.getAttribute("data-sort");
        if (state.sortKey === k) state.sortDir *= -1;
        else { state.sortKey = k; state.sortDir = k === "id" || k === "name" || k === "district" || k === "status" ? 1 : -1; }
        renderTable();
      })
    );
  }

  /* ---------------- site detail scorecard ---------------- */

  const RAW_FMT = {
    highwayAccess: p => p.highwayDistanceM + " m to " + p.highwayId,
    gridProximity: p => p.gridDistanceM + " m · " + p.feederVoltage,
    landAvailability: p => fmt(p.parcelAreaSqM, 0) + " m² · " + p.landUse,
    terrainSlope: p => p.avgSlopeDeg + "° avg",
    gridHeadroom: p => p.gridHeadroomPct + "% spare at substation",
    floodRisk: p => p.floodRisk + " exposure",
    solarIrradiance: p => p.solarPeakSunHours + " peak-sun-h/day"
  };

  function renderDetail(container, s) {
    const p = s.props;
    const band = BAND_COLORS[s.classification.key];
    container.innerHTML =
      "<div class='site-detail-head'><div><h3>" + s.id + " · " + p.name + "</h3>" +
      "<p class='muted small'>" + p.district + " · parcel " + p.parcelId + " · " + p.status + "</p></div>" +
      "<span class='badge " + s.classification.key + "'>" + BAND_LABELS[s.classification.key] + "</span></div>" +
      "<div style='display:flex;gap:20px;align-items:center;flex-wrap:wrap;margin:10px 0'>" +
        "<div class='score-ring' style='--pct:" + s.percent + "'><div><div class='big' style='color:" + band + "'>" + s.percent + "</div><div class='of'>of 100</div></div></div>" +
        "<div style='flex:1;min-width:240px'><p class='muted'>" + p.notes + "</p>" +
        "<div class='actions' style='display:flex;gap:8px;margin-top:8px'>" +
          "<button class='btn sm' id='d-map'>Locate on map</button>" +
          "<button class='btn sm ghost' id='d-load'>Open in load estimator</button>" +
        "</div></div></div>" +
      "<div class='stat-grid'>" +
        stat("Est. annual energy", fmt(EcoGridLoad.annualEnergyKwh(p.chargerCount * 240, p.utilizationPct) / 1000, 0) + " MWh") +
        stat("Capacity factor", p.utilizationPct + "% of diversified peak") +
        stat("Indicative capex", "₹" + p.estimatedCapexInrCrore + " Cr") +
        stat("CO₂e avoided", fmt(p.carbonSavingsKgCO2e / 1000, 0) + " t/yr") +
      "</div>" +
      "<h3>Criterion breakdown <span class='muted small'>(weighted overlay — weights sum to 1.0)</span></h3>" +
      "<div>" + Object.keys(EcoGridScoring.WEIGHTS).map(k => {
        const c = s.criteria[k];
        return "<div class='criterion'>" +
          "<span class='cname'>" + EcoGridScoring.LABELS[k] + " <span class='cweight'>× " + c.weight.toFixed(2) + "</span></span>" +
          "<span class='craw'>" + RAW_FMT[k](p) + "</span>" +
          "<div class='bar" + (c.score >= 0.75 ? "" : c.score >= 0.45 ? " warn" : " danger") + "'><span style='width:" + Math.round(c.score * 100) + "%'></span></div>" +
          "<span class='ccontrib'>" + c.contribution.toFixed(3) + "</span></div>";
      }).join("") + "</div>";

    container.querySelector("#d-map").addEventListener("click", () => switchView("explore", s.id));
    container.querySelector("#d-load").addEventListener("click", () => { $("load-site").value = s.id; syncLoadInputs(); switchView("load"); });
  }

  function stat(k, v) { return "<div class='stat'><div class='k'>" + k + "</div><div class='v'>" + v + "</div></div>"; }

  function selectSite(id, opts) {
    state.selectedId = id;
    const s = siteById(id);
    if (!s) return;
    renderTable();
    renderDetail($("over-detail"), s);
    renderDetail($("explore-detail"), s);
    $("explore-detail-empty").style.display = "none";
    $("load-site").value = id;
    syncLoadInputs();
    EcoGridMap.setSelected(id);
    if (!opts || !opts.keepView) EcoGridMap.flyToSite(id);
    updateSciDefaults(s);
  }

  /* ---------------- load estimator ---------------- */

  const loadState = { chargers: 4, utilization: 14, solarKwp: 150, batteryKwh: 0 };

  function syncLoadInputs() {
    const s = siteById(state.selectedId) || state.scored[0];
    if (!s) return;
    $("in-chargers").value = s.props.chargerCount;
    $("in-util").value = s.props.utilizationPct;
    loadState.solarKwp = 150; loadState.batteryKwh = 0;
    $("in-solar").value = 150; $("in-battery").value = 0;
    $("out-chargers").textContent = s.props.chargerCount;
    $("out-util").textContent = s.props.utilizationPct + "%";
    $("out-solar").textContent = "150 kWp";
    $("out-battery").textContent = "0 kWh";
    runLoadEstimator();
  }

  function runLoadEstimator() {
    const s = siteById(state.selectedId) || state.scored[0];
    if (!s) return;
    const user = {
      chargers: +$("in-chargers").value,
      utilization: +$("in-util").value,
      chargerKw: 240,
      diversity: 0.82,
      custom: false,
      minSubHeadroom: 25
    };
    loadState.chargers = user.chargers; loadState.utilization = user.utilization;
    loadState.solarKwp = +$("in-solar").value; loadState.batteryKwh = +$("in-battery").value;

    const f = EcoGridLoad.feasibility(s.props, user);
    $("out-connected").textContent = fmt(f.connectedKw, 0) + " kW";
    $("out-peak").textContent = fmt(f.peakKw, 0) + " kW";
    $("out-transformer").textContent = fmt(f.transformerKva, 0) + " kVA (" + f.source + ")";
    $("out-loadpct").textContent = f.loadPct.toFixed(0) + "%";
    $("out-energy").textContent = fmt(f.energyKwh / 1000, 0) + " MWh/yr";
    $("out-headroom").textContent = f.subHeadroom.toFixed(0) + "% spare";
    $("out-verdict").className = "badge " + (f.feasible ? "recommended" : "notrec");
    $("out-verdict").textContent = f.feasible ? "Feasible" : "Constrained";
    $("out-notes").innerHTML = f.notes.map(n => "<li><span class='tick'>" + (f.feasible ? "✓" : "▲") + "</span>" + n + "</li>").join("");

    drawLoadProfile();
    updateSciDefaults(s);
  }

  function loadProfile() {
    const t = state.data.telemetry.hours;
    const scaleC = loadState.chargers / 4;
    const scaleU = loadState.utilization / 14;
    const load = t.map(h => +(h.avgKw * scaleC * scaleU).toFixed(1));
    const solar = t.map(h => +(h.solarKwh * loadState.solarKwp / 300).toFixed(1)); // reference canopy ≈ 300 kWp, peak 201 kWh/h
    const gridBase = load.map((l, h) => Math.max(0, l - solar[h]));

    const gridOpt = [], soc = [];
    let b = 0;
    const cap = loadState.batteryKwh;
    const maxPw = cap / 2;                                     // ≈ 0.5C charge/discharge
    const basePeak = Math.max.apply(null, gridBase);
    const target = basePeak * 0.85;                            // shave anything above this
    for (let h = 0; h < 24; h++) {
      let g = gridBase[h];
      if (cap > 0) {
        if (g > target && b > 0) {                             // discharge into any peak
          const dis = Math.min(maxPw, b, g - target);
          b -= dis; g -= dis;
        } else if (h >= 9 && h <= 15 && solar[h] > load[h]) {  // absorb midday solar surplus
          const ch = Math.min(maxPw, cap - b, solar[h] - load[h]);
          b += ch; g += ch;
        } else if ((h <= 6 || h >= 22) && b < cap && g < target * 0.6) {  // off-peak grid charging
          const ch = Math.min(maxPw, cap - b);
          b += ch; g += ch;
        }
      }
      gridOpt.push(+g.toFixed(1)); soc.push(+b.toFixed(1));
    }
    return { load, solar, gridBase, gridOpt, soc };
  }

  function drawLoadProfile() {
    const { load, gridBase, gridOpt } = loadProfile();
    const canvas = $("load-chart");
    EcoGridCharts.line(canvas, [
      { label: "Charger demand", color: "#8ba0bf", points: load.map((y, x) => ({ x, y })), dash: true },
      { label: "Grid draw — solar only", color: "#38bdf8", points: gridBase.map((y, x) => ({ x, y })) },
      { label: "Grid draw — solar + storage", color: "#34d399", points: gridOpt.map((y, x) => ({ x, y })) }
    ], {
      xLabels: Array.from({ length: 24 }, (_, i) => i),
      unit: "kW",
      onHover: (payload, px, py) =>
        EcoGridCharts.tooltip(canvas.parentElement, payload
          ? "<b>" + String(payload.x).padStart(2, "0") + ":00</b><br>" +
            payload.vals.map(v => "<span style='color:" + v.color + "'>■</span> " + v.label + ": " + fmt(v.y, 0) + " kW").join("<br>")
          : null, px, py)
    });
    const peakBase = Math.max.apply(null, gridBase);
    const peakOpt = Math.max.apply(null, gridOpt);
    $("out-shave").textContent = peakBase ? "Peak grid draw " + fmt(peakBase, 0) + " kW → " + fmt(peakOpt, 0) + " kW (" +
      fmt((1 - peakOpt / peakBase) * 100, 0) + "% shaved)" : "—";
  }

  /* ---------------- SCI calculator + time shift ---------------- */

  function updateSciDefaults(s) {
    const user = {
      chargers: +$("in-chargers").value || s.props.chargerCount,
      utilization: +$("in-util").value || s.props.utilizationPct
    };
    const energy = EcoGridLoad.annualEnergyKwh(user.chargers * 240, user.utilization, 0.82);
    $("sci-e").value = Math.round(energy);
    const I = Math.round(state.data["grid-carbon"].hours.reduce((a, h) => a + h.gco2PerKwh, 0) / 24);
    $("sci-i").value = I;
    const batt = +$("in-battery").value;
    $("sci-m").value = Math.round(EcoGridSCI.embodiedPerYear(user.chargers, s.props.transformerCapacityKva, batt));
    $("sci-r").value = Math.round(EcoGridSCI.sessionsPerYear(energy, 28));
    runSciCalc();
  }

  function runSciCalc() {
    const E = +$("sci-e").value, I = +$("sci-i").value, M = +$("sci-m").value, R = +$("sci-r").value;
    const r = EcoGridSCI.computeSCI(E, I, M, R);
    const fEl = $("sci-formula");
    if (!r) { fEl.textContent = "SCI = ((E × I) + M) / R — enter values above"; return; }
    fEl.innerHTML =
      "SCI <span class='op'>=</span> ((<span class='v'>" + fmt(E, 0) + " kWh</span> <span class='op'>×</span> <span class='v2'>" + fmt(I, 0) +
      " gCO₂e/kWh</span>) <span class='op'>+</span> <span class='v'>" + fmt(M, 0) + " kg</span>) <span class='op'>/</span> <span class='v2'>" +
      fmt(R, 0) + " sessions</span>";
    $("sci-result").textContent = r.perUnit.toFixed(2) + " kgCO₂e";
    $("sci-note").textContent =
      "Operational share " + ((r.operationalKg / (r.operationalKg + M)) * 100).toFixed(0) +
      "% — dominated by grid intensity. Shifting sessions toward low-carbon hours (below) cuts E × I directly, and a lighter web dashboard cuts the platform's own SCI.";
  }

  function drawCarbonChart() {
    const m = intensityMap();
    const t = state.data.telemetry.hours;
    const scaleC = +$("in-chargers").value / 4;
    const scaleU = (+$("in-util").value || 14) / 14;
    const hourlyKwh = t.map(h => +(h.avgKw * scaleC * scaleU).toFixed(1));
    const canvas = $("carbon-chart");
    const series = [{ label: "Charging energy — baseline", color: "#38bdf8", points: hourlyKwh.map((y, x) => ({ x, y })) }];
    if (state.carbonChartShifted) {
      const after = hourlyKwh.slice();
      for (const mv of state.carbonChartShifted.moves) { after[mv.from] -= mv.kwh; after[mv.to] += mv.kwh; }
      series.push({ label: "After carbon-aware shift", color: "#34d399", points: after.map((y, x) => ({ x, y })) });
    }
    EcoGridCharts.line(canvas, series, {
      xLabels: Array.from({ length: 24 }, (_, i) => i),
      onHover: (payload, px, py) =>
        EcoGridCharts.tooltip(canvas.parentElement, payload
          ? "<b>" + String(payload.x).padStart(2, "0") + ":00</b> · " + m[payload.x] + " gCO₂e/kWh<br>" +
            payload.vals.map(v => "<span style='color:" + v.color + "'>■</span> " + v.label + ": " + fmt(v.y, 1) + " kWh").join("<br>")
          : null, px, py)
    });
  }

  function runShiftSim() {
    const m = intensityMap();
    const t = state.data.telemetry.hours;
    const scaleC = +$("in-chargers").value / 4;
    const scaleU = (+$("in-util").value || 14) / 14;
    const hourlyKwh = t.map(h => +(h.avgKw * scaleC * scaleU).toFixed(1));
    const plan = EcoGridSCI.shiftPlan(hourlyKwh, m, 25);
    state.carbonChartShifted = plan;
    drawCarbonChart();
    const s = siteById(state.selectedId) || state.scored[0];
    $("shift-result").style.display = "";
    $("shift-stats").innerHTML =
      stat("Energy shifted", fmt(plan.movedTotal, 0) + " kWh/day") +
      stat("Savings", fmt(plan.savingsKg, 1) + " kgCO₂e/day") +
      stat("Reduction", fmt(plan.savingsPct, 1) + "% of daily charging carbon") +
      stat("Annualized", fmt(plan.savingsKg * 365 / 1000, 0) + " tCO₂e/yr at " + s.id);
  }

  /* ---------------- green page: payload audit ---------------- */

  function runPayloadAudit() {
    const { total, rows } = estimatePayload();
    const list = $("measure-list");
    if (!total || !rows.length) {
      list.innerHTML = "<li>Browser did not expose transfer sizes (typical when opened from <code>file://</code> or fully cached). Open the GitHub Pages deployment to measure live bytes.</li>";
      $("measure-total").textContent = "—";
      return;
    }
    rows.sort((a, b) => b.bytes - a.bytes);
    list.innerHTML = rows.map(r =>
      "<li><span class='tick'>▪</span><code>" + r.name + "</code>&nbsp;— " + (r.bytes / 1024).toFixed(1) + " KB" +
      " <span class='note'>(" + ((r.bytes / total) * 100).toFixed(0) + "%)</span></li>").join("");
    $("measure-total").textContent = (total / 1024).toFixed(1) + " KB of " + 500 + " KB budget";
    const pct = Math.min(100, (total / (500 * 1024)) * 100);
    const bar = $("measure-bar");
    bar.className = "bar" + (pct > 90 ? " danger" : pct > 65 ? " warn" : "");
    bar.innerHTML = "<span style='width:" + pct + "%'></span>";
    renderKpis();
  }

  /* ---------------- views / tabs ---------------- */

  function switchView(name, siteId) {
    document.querySelectorAll(".tabs button").forEach(b =>
      b.setAttribute("aria-selected", String(b.getAttribute("data-view") === name)));
    document.querySelectorAll(".view").forEach(v =>
      v.classList.toggle("active", v.id === "view-" + name));
    if (history.replaceState) history.replaceState(null, "", "#" + name);
    if (name === "explore") {
      EcoGridMap.invalidateSize();
      if (siteId) selectSite(siteId);
    }
    if (name === "carbon") { drawCarbonChart(); runSciCalc(); }
    if (name === "load") drawLoadProfile();
  }

  /* ---------------- boot ---------------- */

  async function boot() {
    try {
      await loadData();
    } catch (err) { showFatal(err); return; }

    state.data.sites.features.forEach(f => { f.properties._coords = f.geometry.coordinates; });
    state.scored = EcoGridScoring.scoreAll(state.data.sites.features);

    /* map */
    EcoGridMap.init(id => selectSite(id));
    EcoGridMap.setSiteData(state.scored);
    $("lay-sites").addEventListener("change", e => EcoGridMap.setLayerVisible("sites", e.target.checked));
    $("lay-highways").addEventListener("change", e => EcoGridMap.setLayerVisible("highways", e.target.checked));
    $("lay-substations").addEventListener("change", e => EcoGridMap.setLayerVisible("substations", e.target.checked));
    $("basemap-select").addEventListener("change", e => EcoGridMap.setBasemap(e.target.value));
    EcoGridMap.setLayerVisible("sites", true);

    /* hero chart: regional carbon intensity */
    const m = intensityMap();
    const hero = $("hero-canvas");
    EcoGridCharts.line(hero, [{ label: "Grid carbon intensity", color: "#22d3ee", points: Array.from({ length: 24 }, (_, h) => ({ x: h, y: m[h] })) }], {
      xLabels: Array.from({ length: 24 }, (_, i) => i),
      yMax: Math.max.apply(null, Object.values(m)) * 1.15,
      onHover: (p, px, py) => EcoGridCharts.tooltip(hero.parentElement, p
        ? "<b>" + String(p.x).padStart(2, "0") + ":00</b> — " + m[p.x] + " gCO₂e/kWh"
        : null, px, py)
    });

    /* table + first selection */
    renderTable();

    /* site selector on the load tab */
    const sel = $("load-site");
    sel.innerHTML = state.scored.map(s =>
      "<option value='" + s.id + "'>" + s.id + " · " + s.props.name + "</option>").join("");

    selectSite(state.scored[0].id, { keepView: true });

    /* hero action buttons */
    document.querySelectorAll("[data-goto]").forEach(b =>
      b.addEventListener("click", () => switchView(b.getAttribute("data-goto"))));

    /* load estimator inputs */
    ["in-chargers", "in-util", "in-solar", "in-battery"].forEach(id =>
      $(id).addEventListener("input", () => {
        $("out-chargers").textContent = $("in-chargers").value;
        $("out-util").textContent = $("in-util").value + "%";
        $("out-solar").textContent = $("in-solar").value + " kWp";
        $("out-battery").textContent = $("in-battery").value + " kWh";
        runLoadEstimator();
      }));
    $("load-site").addEventListener("change", () => {
      state.selectedId = $("load-site").value;
      syncLoadInputs();
      renderTable();
      EcoGridMap.setSelected(state.selectedId);
    });

    /* carbon page */
    ["sci-e", "sci-i", "sci-m", "sci-r"].forEach(id => $(id).addEventListener("input", runSciCalc));
    $("btn-shift").addEventListener("click", runShiftSim);
    $("in-chargers").addEventListener("input", drawCarbonChart);

    /* green page */
    $("btn-measure").addEventListener("click", runPayloadAudit);
    setTimeout(runPayloadAudit, 400);

    /* tabs */
    document.querySelectorAll(".tabs button").forEach(b =>
      b.addEventListener("click", () => switchView(b.getAttribute("data-view"))));
    const initial = (location.hash || "#overview").slice(1);
    switchView(["overview", "explore", "load", "carbon", "green"].includes(initial) ? initial : "overview");
  }

  document.addEventListener("DOMContentLoaded", boot);
})();
