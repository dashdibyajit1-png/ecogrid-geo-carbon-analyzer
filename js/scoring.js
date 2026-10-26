/* ============================================================
   EcoGridScoring — weighted multi-criteria decision analysis.
   Mirrors the ArcGIS ModelBuilder weighted-overlay logic so the
   dashboard reproduces the desktop suitability scores.
   ============================================================ */
(function () {
  "use strict";

  const WEIGHTS = {
    highwayAccess: 0.25,
    gridProximity: 0.25,
    landAvailability: 0.15,
    terrainSlope: 0.10,
    gridHeadroom: 0.10,
    floodRisk: 0.08,
    solarIrradiance: 0.07
  };

  const LABELS = {
    highwayAccess: "Highway access",
    gridProximity: "Grid proximity",
    landAvailability: "Land availability",
    terrainSlope: "Terrain slope",
    gridHeadroom: "Grid headroom",
    floodRisk: "Flood risk",
    solarIrradiance: "Solar irradiance"
  };

  const clamp01 = v => Math.max(0, Math.min(1, v));

  /* Each criterion reclassifies a raw input to a 0–1 suitability value,
     exactly like the reclassify + weighted-overlay steps in ArcGIS Pro. */
  const CRITERIA = {
    highwayAccess: p => clamp01(200 / Math.max(p.highwayDistanceM, 1)),
    gridProximity: p => clamp01(400 / Math.max(p.gridDistanceM, 1)),
    landAvailability: p => clamp01(p.parcelAreaSqM / 1200),
    terrainSlope: p => (p.avgSlopeDeg <= 2 ? 1 : p.avgSlopeDeg >= 15 ? 0.05 : 1 - ((p.avgSlopeDeg - 2) / 13) * 0.95),
    gridHeadroom: p => clamp01((p.gridHeadroomPct - 8) / 22),
    floodRisk: p => ({ low: 1, medium: 0.55, high: 0.15 }[p.floodRisk] || 0.5),
    solarIrradiance: p => clamp01((p.solarPeakSunHours - 4.6) / 0.8)
  };

  function scoreSite(props) {
    const total = { weighted: 0, sum: 0 };
    const criteria = {};
    for (const key in WEIGHTS) {
      const s = CRITERIA[key](props);
      criteria[key] = { raw: null, score: s, weight: WEIGHTS[key], contribution: s * WEIGHTS[key] };
      total.weighted += s * WEIGHTS[key];
      total.sum += s;
    }
    return {
      id: props.id,
      weighted: total.weighted,      // 0–1, weights sum to 1
      percent: Math.round(total.weighted * 100),
      equalAverage: total.sum / 7,   // sensitivity-check variant
      criteria
    };
  }

  function classify(percent) {
    if (percent >= 85) return { key: "recommended", label: "Recommended" };
    if (percent >= 65) return { key: "viable", label: "Viable" };
    if (percent >= 45) return { key: "marginal", label: "Marginal" };
    return { key: "notrec", label: "Not recommended" };
  }

  function scoreAll(features) {
    return features
      .map(f => {
        const s = scoreSite(f.properties);
        s.props = f.properties;
        s.classification = classify(s.percent);
        return s;
      })
      .sort((a, b) => b.percent - a.percent);
  }

  window.EcoGridScoring = { WEIGHTS, LABELS, scoreSite, scoreAll, classify };
})();
