/* ============================================================
   EcoGridSCI — Software Carbon Intensity per the Green Software
   Foundation model: SCI = ((E × I) + M) / R
     E  energy consumed by the software system (kWh)
     I  carbon intensity of the grid that produced it (gCO2e/kWh)
     M  embodied carbon amortized per functional unit (kgCO2e)
     R  functional unit (here: one charging session)
   ============================================================ */
(function () {
  "use strict";

  /* Embodied carbon of one 240 kW dispenser + its transformer + battery share.
     Conservative hardware mass estimate for the 4-year write-off. */
  const EMBODIED = {
    perChargerKg: 400,
    perTransformerKg: 250,
    batteryKgPerKwh: 60,       // pack manufacturing footprint
    amortizationYears: 4
  };

  function embodiedPerYear(chargers, transformerKva, batteryKwh) {
    const total =
      chargers * EMBODIED.perChargerKg +
      transformerKva / 1000 * EMBODIED.perTransformerKg +
      (batteryKwh || 0) * EMBODIED.batteryKgPerKwh;
    return total / EMBODIED.amortizationYears;
  }

  function computeSCI(E, I, M, R) {
    if (!E || !R) return null;
    const operational = (E * I) / 1000;   // kWh × g/kWh → kgCO2e
    const perUnit = (operational + (M || 0)) / R;
    return { operationalKg: operational, perUnit };
  }

  function sessionsPerYear(energyKwh, avgSessionKwh) {
    return energyKwh / (avgSessionKwh || 28);
  }

  /* Carbon-intensity-weighted average for a day's charging profile. */
  function weightedIntensity(hourlyKwh, hourlyIntensity) {
    let e = 0, ei = 0;
    for (const h in hourlyKwh) {
      e += hourlyKwh[h];
      ei += hourlyKwh[h] * (hourlyIntensity[h] != null ? hourlyIntensity[h] : 0);
    }
    return e ? ei / e : 0;
  }

  /* Time-shift heuristic: move flexible evening surplus into the lowest-intensity
     windows of the day. threshold = mean × (1 + headroom); sink capacity is
     capped so the target hours don't overfill. Returns a per-hour moved map. */
  function shiftPlan(hourlyKwh, hourlyIntensity, headroomPct) {
    const hours = Array.from({ length: 24 }, (_, h) => h);
    const total = hours.reduce((s, h) => s + (hourlyKwh[h] || 0), 0);
    const mean = total / 24;
    const threshold = mean * (1 + (headroomPct == null ? 20 : headroomPct) / 100);

    const surplus = hours.map(h => Math.max(0, (hourlyKwh[h] || 0) - threshold));
    const filled = {};                    // kWh already poured into each sink hour
    const sinkCap = h => Math.max(0, threshold * 0.75 - ((hourlyKwh[h] || 0) + (filled[h] || 0)));

    const sources = hours.slice().sort((a, b) => hourlyIntensity[b] - hourlyIntensity[a]);
    const sinks = hours.slice().sort((a, b) => hourlyIntensity[a] - hourlyIntensity[b]);

    const moved = {};                     // source hour → kWh shifted out
    const moves = [];                     // explicit dispatch: {from, to, kwh}
    let savings = 0, movedTotal = 0;

    for (const s of sources) {
      let avail = surplus[s];
      if (avail <= 0.5) continue;
      for (const t of sinks) {
        if (avail <= 0.5) break;
        if (t === s || hourlyIntensity[t] >= hourlyIntensity[s]) continue;
        const cap = Math.min(sinkCap(t), avail);
        if (cap < 0.5) continue;
        moved[s] = (moved[s] || 0) + cap;
        moves.push({ from: s, to: t, kwh: cap });
        movedTotal += cap;
        savings += cap * (hourlyIntensity[s] - hourlyIntensity[t]) / 1000; // g → kg
        filled[t] = (filled[t] || 0) + cap;
        avail -= cap;
      }
    }

    const dayIntensity = weightedIntensity(hourlyKwh, hourlyIntensity);
    const dayKg = total * dayIntensity / 1000;
    return {
      threshold, movedTotal, moved, moves,
      savingsKg: savings,
      savingsPct: dayKg ? (savings / dayKg) * 100 : 0,
      avgIntensity: dayIntensity
    };
  }

  window.EcoGridSCI = { EMBODIED, embodiedPerYear, computeSCI, sessionsPerYear, weightedIntensity, shiftPlan };
})();
