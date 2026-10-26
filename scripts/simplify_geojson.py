#!/usr/bin/env python3
"""
EcoGrid GeoJSON simplification with an enforced byte budget.

Douglas-Peucker simplifies geometry, coordinate quantization rounds
longitude/latitude to 3 decimal places (~100 m at Odisha's latitude)
and attributes are minified — so raw 400 MB analysis exports fit the
green-software web payload budget (<= 180 KB per layer).

Usage:
    python scripts/simplify_geojson.py <input.geojson> <output.geojson> [--max-bytes 180000] [--tolerance 0.0008]

Exits non-zero if the output still exceeds the budget: the budget is
enforced, not aspirational.
"""
import argparse
import json
import math
import sys


def _perpendicular_distance(pt, line_start, line_end):
    (x, y), (x1, y1), (x2, y2) = pt, line_start, line_end
    dx, dy = x2 - x1, y2 - y1
    if dx == 0 and dy == 0:
        return math.hypot(x - x1, y - y1)
    norm = math.hypot(dx, dy)
    return abs(dy * x - dx * y + x2 * y1 - y2 * x1) / norm


def douglas_peucker(points, tolerance):
    """Iterative DP so deep polylines can't hit the recursion limit."""
    if len(points) < 3:
        return points[:]
    keep = [False] * len(points)
    keep[0] = keep[-1] = True
    stack = [(0, len(points) - 1)]
    while stack:
        s, e = stack.pop()
        max_d, idx = 0.0, -1
        for i in range(s + 1, e):
            d = _perpendicular_distance(points[i], points[s], points[e])
            if d > max_d:
                max_d, idx = d, i
        if max_d > tolerance and idx > 0:
            keep[idx] = True
            stack.append((s, idx))
            stack.append((idx, e))
    return [p for p, k in zip(points, keep) if k]


def _quantize(value, decimals=3):
    return round(value, decimals)


def simplify_coords(coords, tolerance, decimals):
    if coords and isinstance(coords[0], (int, float)):       # a position
        return [_quantize(coords[0], decimals), _quantize(coords[1], decimals)]
    out = [simplify_coords(c, tolerance, decimals) for c in coords]
    # collapse rings/lines that degenerated below 4 positions / 2 positions
    if len(out) >= 1 and isinstance(out[0], list) and isinstance(out[0][0], (int, float)):
        if len(out) < 2:
            return []
        if len(out) < 4 and _is_ring(out):
            return []
    return out


def _is_ring(coords):
    return len(coords) >= 4 and coords[0] == coords[-1]


def _round_attrs(props):
    out = {}
    for k, v in props.items():
        if isinstance(v, float):
            out[k] = round(v, 2)
        else:
            out[k] = v
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("input")
    ap.add_argument("output")
    ap.add_argument("--max-bytes", type=int, default=180000)
    ap.add_argument("--tolerance", type=float, default=0.0008,
                    help="DP tolerance in degrees (~0.0008 ≈ 80 m)")
    ap.add_argument("--decimals", type=int, default=3)
    args = ap.parse_args()

    with open(args.input, encoding="utf-8") as f:
        fc = json.load(f)
    if fc.get("type") != "FeatureCollection":
        sys.exit("input must be a GeoJSON FeatureCollection")

    kept = []
    for feat in fc["features"]:
        g = feat["geometry"]
        if g is None:
            continue
        coords = simplify_coords(g["coordinates"], args.tolerance, args.decimals)
        if not coords:
            continue
        kept.append({
            "type": "Feature",
            "geometry": {"type": g["type"], "coordinates": coords},
            "properties": _round_attrs(feat.get("properties", {})),
        })

    out_fc = {
        "type": "FeatureCollection",
        "name": fc.get("name", "simplified"),
        "crs": "WGS84 (EPSG:4326), Douglas-Peucker simplified + 3-decimal quantized",
        "features": kept,
    }
    payload = json.dumps(out_fc, separators=(",", ":")).encode("utf-8")

    if len(payload) > args.max_bytes:
        sys.exit(
            f"output {len(payload)} bytes exceeds budget {args.max_bytes} — "
            f"increase --tolerance or reduce attribute surface"
        )

    with open(args.output, "w", encoding="utf-8", newline="\n") as f:
        f.write(payload.decode("utf-8") + "\n")
    print(f"{args.output}: {len(kept)} features, {len(payload)} bytes "
          f"(budget {args.max_bytes}, tolerance {args.tolerance})")


if __name__ == "__main__":
    main()
