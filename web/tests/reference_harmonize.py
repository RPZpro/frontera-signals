"""Independent reference for the harmonized view (web/src/lib/harmonize.ts).

Standard library only. Reads data/export/monthly.json and prints the numbers that
tests/harmonize.test.mjs asserts against the TypeScript implementation.

    python web/tests/reference_harmonize.py

Exploratory method, version 0.1. See web/docs/HARMONIZATION.md.
"""
import json
import math
import statistics as st
from collections import defaultdict
from pathlib import Path

EXPORT = Path(__file__).resolve().parents[2] / "data" / "export" / "monthly.json"
SERIES = ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20"]
LIMITS_Z = 1.96


def pearson(a, b):
    ma, mb = st.mean(a), st.mean(b)
    num = sum((x - ma) * (y - mb) for x, y in zip(a, b))
    return num / math.sqrt(sum((x - ma) ** 2 for x in a) * sum((y - mb) ** 2 for y in b))


def deseasonalize(periods, values):
    groups = defaultdict(list)
    for period, value in zip(periods, values):
        groups[period[5:]].append(value)
    means = {month: st.mean(v) for month, v in groups.items()}
    return [value - means[period[5:]] for period, value in zip(periods, values)]


def main():
    records = json.loads(EXPORT.read_text(encoding="utf-8"))["records"]
    cells, percentile = {s: {} for s in SERIES}, {s: {} for s in SERIES}
    for r in records:
        m = r["metrics"]["active_cells"]
        if r["quality"] == "ok" and m["value"] is not None:
            cells[r["series"]][r["period"]] = m["value"]
            percentile[r["series"]][r["period"]] = m["seasonal"]["percentile"]

    periods = sorted(set.intersection(*(set(cells[s]) for s in SERIES)))  # calibration window
    logs = {s: {p: math.log1p(cells[s][p]) for p in periods} for s in SERIES}
    mean = {s: st.mean(logs[s].values()) for s in SERIES}
    sd = {s: st.stdev(logs[s].values()) for s in SERIES}
    z = {s: {p: (logs[s][p] - mean[s]) / sd[s] for p in periods} for s in SERIES}

    modis = z["MODIS"]
    viirs = {p: (z["VIIRS_SNPP"][p] + z["VIIRS_NOAA20"][p]) / 2 for p in periods}  # VIIRS counts once
    index = {p: (modis[p] + viirs[p]) / 2 for p in periods}

    gap = [viirs[p] - modis[p] for p in periods]
    gap_mean, gap_sd = st.mean(gap), st.stdev(gap)
    lower, upper = gap_mean - LIMITS_Z * gap_sd, gap_mean + LIMITS_Z * gap_sd
    a = deseasonalize(periods, [modis[p] for p in periods])
    b = deseasonalize(periods, [viirs[p] for p in periods])

    def consensus(p):
        return (percentile["MODIS"][p] + (percentile["VIIRS_SNPP"][p] + percentile["VIIRS_NOAA20"][p]) / 2) / 2

    out = {
        "calibration_months": len(periods),
        "mean_ln1p": {s: round(mean[s], 6) for s in SERIES},
        "sd_ln1p": {s: round(sd[s], 6) for s in SERIES},
        "typical_cells": {s: round(math.expm1(mean[s]), 3) for s in SERIES},
        "factor_per_point": {s: round(math.exp(sd[s]), 4) for s in SERIES},
        "r": round(pearson([modis[p] for p in periods], [viirs[p] for p in periods]), 6),
        "r_without_seasonal_cycle": round(pearson(a, b), 6),
        "gap_sd": round(gap_sd, 6),
        "limits": [round(lower, 6), round(upper, 6)],
        "months_outside_limits": [p for p, d in zip(periods, gap) if d < lower or d > upper],
        "index_sd": round(st.stdev(index.values()), 6),
        "index_2020-06": round(index["2020-06"], 6),
        "modis_score_2020-06": round(modis["2020-06"], 6),
        "viirs_score_2020-06": round(viirs["2020-06"], 6),
        "consensus_percentile_2020-06": consensus("2020-06"),
        "consensus_percentile_2020-01": consensus("2020-01"),
    }
    print(json.dumps(out, indent=2))


if __name__ == "__main__":
    main()
