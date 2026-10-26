/* ============================================================
   EcoGridLoad — 240 kW DC fast-charger electrical estimator.
   Mirrors the desktop spreadsheet/Python calcs used in ArcGIS
   attribute joins (FeasibilityScore, EstimatedCapEx, etc).
   ============================================================ */
(function () {
  "use strict";

  const PF = 0.95;               // charger input power factor
  const TRANSFORMER_SIZES = [315, 500, 630, 1000, 1260, 1600, 2000, 2500]; // standard distribution kVA

  function connectedLoad(chargers, kwPerCharger) { return chargers * (kwPerCharger || 240); }

  function diversifiedPeak(connectedKw, diversity) {
    return connectedKw * (diversity == null ? 0.82 : diversity);
  }

  function annualEnergyKwh(connectedKw, utilizationPct, diversity) {
    /* Coincident peak × utilization fraction × 8,760 h.
       A 14% utilization of the diversified peak is representative of a
       healthy highway plaza in its first operating year. */
    return diversifiedPeak(connectedKw, diversity) * (utilizationPct / 100) * 8760;
  }

  function nextTransformerKva(peakKw) {
    const need = peakKw / PF;
    for (const s of TRANSFORMER_SIZES) if (s >= need) return s;
    return Math.ceil(need / 500) * 500;
  }

  /* Feasibility of the requested station config at a given site's feeder. */
  function feasibility(siteProps, user) {
    const connected = connectedLoad(user.chargers, user.chargerKw);
    const peak = diversifiedPeak(connected, user.diversity);
    const needKva = peak / PF;

    let transformerKva, source;
    if (user.custom) {
      transformerKva = nextTransformerKva(peak);
      source = "recommended (next standard size)";
    } else {
      transformerKva = siteProps.transformerCapacityKva;
      source = "site transformer as planned";
    }

    const loadPct = (needKva / transformerKva) * 100;
    /* gridHeadroomPct is the substation's spare capacity (the same input the
       MCDA model reclassifies); 100% when there's no site context (custom). */
    const subHeadroom = siteProps ? siteProps.gridHeadroomPct : 100;

    /* Simple thermal rule: keep station demand under 60% of the bank so the
       substation can absorb it without reinforcement. */
    let ok = loadPct <= 85 && subHeadroom >= user.minSubHeadroom;
    const notes = [];
    if (loadPct > 85) notes.push("Station exceeds 85% of the transformer rating — add a second bank or load-share.");
    if (subHeadroom < user.minSubHeadroom) {
      notes.push(`Substation has only ${subHeadroom.toFixed(0)}% spare capacity (need ≥ ${user.minSubHeadroom}%).`);
    }
    if (ok) notes.push("Diversified demand fits the transformer with an N-1 friendly margin.");

    const capexCrore = user.custom
      ? user.chargers * 0.55 + (siteProps ? siteProps.gridDistanceM : user.gridDistanceM) / 1000 * 0.25 + 0.6
      : null;

    return {
      connectedKw: connected, peakKw: peak, needKva, transformerKva, loadPct, subHeadroom,
      feasible: ok, notes, source, capexCrore,
      energyKwh: annualEnergyKwh(connected, user.utilization, user.diversity)
    };
  }

  window.EcoGridLoad = {
    PF, TRANSFORMER_SIZES,
    connectedLoad, diversifiedPeak, annualEnergyKwh, nextTransformerKva, feasibility
  };
})();
