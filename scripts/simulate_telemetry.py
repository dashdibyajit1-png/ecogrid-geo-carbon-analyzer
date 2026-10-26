#!/usr/bin/env python3
"""
EcoGrid telemetry simulator — generates data/telemetry.json.

Emulates an OCPP 2.0.1 TransactionEvent stream for one 4-dispenser
240 kW plaza, aggregated hourly upstream (the green pattern: the
dashboard never polls chargers directly, it reads hourly aggregates).

The day shape is calibrated to a pre-monsoon weekday on an NH corridor:
morning commuter peak, midday trough with solar surplus, evening freight
peak. Solar figures correspond to a ~300 kWp canopy (peak hour 201 kWh).
"""
import json
import random
import sys
from pathlib import Path

HOURS = 24
SAMPLES_PER_HOUR = 120          # OCPP MeterValues at 30 s cadence
REF_PEAK_KW = 238               # diversified peak of 4 x 240 kW * 0.82 * headroom

# (sessions, load factor) per hour — tuned day shape
DAY = [
    (0, 0.00), (0, 0.00), (0, 0.00), (0, 0.00), (0, 0.00),   # 0-4 dead hours
    (1, 0.26),                                               # 05 early riser
    (2, 0.50), (3, 0.78), (4, 0.97),                         # 06-08 morning peak
    (3, 0.86), (4, 1.01), (3, 0.83), (4, 0.95),              # 09-12
    (3, 0.79), (4, 0.99), (4, 1.03), (5, 1.06),              # 13-16
    (5, 1.10), (4, 1.00), (4, 1.04), (3, 0.90),              # 17-20 evening peak
    (2, 0.64), (2, 0.52), (1, 0.37),                         # 21-23
]

SOLAR_SHAPE = [0.01, 0.05, 0.09, 0.18, 0.32, 0.51, 0.66, 0.82,   # 05-12
               0.95, 1.00, 0.90, 0.77, 0.57, 0.38, 0.19, 0.05]   # 13-20


def main(out_path="data/telemetry.json", seed=42):
    rng = random.Random(seed)
    solar_canopy_kwp = 300.0
    hours = []
    for h, (sessions, lf) in enumerate(DAY):
        avg_kw = 0.0 if sessions == 0 else round(REF_PEAK_KW * lf + rng.uniform(-6, 6), 1)
        if avg_kw < 0:
            avg_kw = 0.0
        energy_kwh = round(avg_kw * 1.0, 1)  # avg kW over the hour == kWh that hour
        solar_kwh = round(solar_canopy_kwp * SOLAR_SHAPE[h - 5] if 5 <= h <= 20 else 0.0, 1)
        # split energy across grid / solar: solar serves load first
        solar_used = round(min(solar_kwh, energy_kwh), 1)
        grid_kwh = round(energy_kwh - solar_used, 1)
        hours.append({
            "hour": h,
            "sessions": sessions,
            "avgKw": avg_kw,
            "gridKwh": grid_kwh,
            "solarKwh": solar_used,
        })

    doc = {
        "asset": "EG-01 · Khandagiri Corridor Hub",
        "period": "typical day, pre-monsoon season",
        "note": ("Synthetic telemetry from scripts/simulate_telemetry.py "
                 f"(seed={seed}, {SAMPLES_PER_HOUR} samples/hour) emulating an "
                 "OCPP 2.0.1 TransactionEvent stream, aggregated hourly upstream."),
        "sampleCountPerHour": SAMPLES_PER_HOUR,
        "hours": hours,
    }

    path = Path(out_path)
    path.write_text(json.dumps(doc, indent=2) + "\n", encoding="utf-8")
    total = sum(h["avgKw"] for h in hours)
    print(f"{path}: {len(hours)} hours, {total:.0f} kWh charging demand "
          f"({sum(h['solarKwh'] for h in hours):.0f} kWh served by canopy)")


if __name__ == "__main__":
    out = sys.argv[1] if len(sys.argv) > 1 else "data/telemetry.json"
    main(out)
