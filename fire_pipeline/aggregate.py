"""Monthly activity series per region x sensor (harmonization Stages 1 and 2).

Key rule: zero vs null
----------------------
A month with no detections is 0 *only if the input files cover that month*
for that sensor. A month outside the declared coverage is null with
quality "no_data". That is why coverage must be declared explicitly, from the
date range that was downloaded. It cannot be inferred from the first and last
detection, because months with no detections are real zeros.

Even then, 0 means "no detections", not "no fire" (clouds, overpass timing,
small or short fires).

Months are calendar months in UTC (FIRMS timestamps are UTC). In Baja
California (UTC-8/-7) a detection late on the last local evening of a month can
fall into the next UTC month.
"""

from __future__ import annotations

import itertools

import pandas as pd

from .grid import DEFAULT_CELL_M, assign_cells

# metric -> (raw|derived, unit)
METRICS: dict[str, tuple[str, str | None]] = {
    "hotspot_count": ("raw", "detections"),
    "frp_sum_mw": ("raw", "MW"),
    "active_cells": ("derived", "cells"),
    "active_cell_days": ("derived", "cell-days"),
}

MONTHLY_COLUMNS = (
    "region_id", "sensor", "month", "days_in_month", "days_covered",
    "coverage_fraction", "quality", *METRICS,
)


def _coverage_days(month: pd.Period, start: pd.Timestamp, end: pd.Timestamp) -> int:
    lo = max(month.start_time.normalize(), start)
    hi = min(month.end_time.normalize(), end)
    return max((hi - lo).days + 1, 0)


def monthly_activity(
    detections: pd.DataFrame,
    region_ids,
    coverage: dict[str, tuple[str, str]],
    cell_m: float = DEFAULT_CELL_M,
) -> pd.DataFrame:
    """Build a complete region x sensor x month table.

    Parameters
    ----------
    detections : output of ``filter_to_regions`` (must have ``region_id``).
    region_ids : every region that must appear, including ones with no detections.
    coverage : {sensor: ("YYYY-MM-DD", "YYYY-MM-DD")}, the inclusive UTC date
        range the input files cover for that sensor.
    """
    if not coverage:
        raise ValueError("coverage must declare at least one sensor")
    cov = {s.upper(): (pd.Timestamp(a), pd.Timestamp(b)) for s, (a, b) in coverage.items()}
    for s, (a, b) in cov.items():
        if b < a:
            raise ValueError(f"coverage for {s}: end {b.date()} before start {a.date()}")

    region_ids = [str(r) for r in region_ids]
    det = detections
    unknown_sensor = set(det["sensor"]) - set(cov)
    if unknown_sensor:
        raise ValueError(f"detections for sensors without declared coverage: {unknown_sensor}")
    unknown_region = set(det["region_id"]) - set(region_ids)
    if unknown_region:
        raise ValueError(f"detections for undeclared regions: {unknown_region}")

    day = det["acq_datetime_utc"].dt.strftime("%Y-%m-%d")
    for s, (a, b) in cov.items():
        d = pd.to_datetime(day[det["sensor"] == s])
        if len(d) and (d.min() < a or d.max() > b):
            raise ValueError(
                f"{s} detections span {d.min().date()}..{d.max().date()}, "
                f"outside declared coverage {a.date()}..{b.date()}"
            )

    months = pd.period_range(min(a for a, _ in cov.values()),
                             max(b for _, b in cov.values()), freq="M")
    sensors = sorted(cov)
    rows = []
    for r, s, m in itertools.product(region_ids, sensors, months):
        covered = _coverage_days(m, *cov[s])
        rows.append({"region_id": r, "sensor": s, "month": str(m),
                     "days_in_month": m.days_in_month, "days_covered": covered})
    sk = pd.DataFrame(rows)
    sk["coverage_fraction"] = sk["days_covered"] / sk["days_in_month"]
    sk["quality"] = "partial_coverage"
    sk.loc[sk["days_covered"] == 0, "quality"] = "no_data"
    sk.loc[sk["days_covered"] == sk["days_in_month"], "quality"] = "ok"

    if len(det):
        g = assign_cells(det, cell_m)
        g["month"] = g["acq_datetime_utc"].dt.strftime("%Y-%m")
        g["cell_day"] = g["cell_id"] + "@" + day
        agg = (g.groupby(["region_id", "sensor", "month"])
                .agg(hotspot_count=("sensor", "size"),
                     frp_sum_mw=("frp_mw", "sum"),
                     active_cells=("cell_id", "nunique"),
                     active_cell_days=("cell_day", "nunique"))
                .reset_index())
        out = sk.merge(agg, on=["region_id", "sensor", "month"], how="left")
    else:
        out = sk.assign(**{m: pd.NA for m in METRICS})

    has_data = out["quality"] != "no_data"
    for col in ("hotspot_count", "active_cells", "active_cell_days"):
        out[col] = out[col].astype("Float64").fillna(0).where(has_data).astype("Int64")
    out["frp_sum_mw"] = (out["frp_sum_mw"].astype("Float64").fillna(0.0)
                         .where(has_data).round(3))

    return (out[list(MONTHLY_COLUMNS)]
            .sort_values(["region_id", "sensor", "month"])
            .reset_index(drop=True))
