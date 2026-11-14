"""Sensor-specific seasonal percentiles (harmonization Stage 3).

For each region x series x calendar month (Jan..Dec), a month's value is ranked
against the same calendar month in the other years of the reference period,
always within the same series. MODIS is never ranked against VIIRS.

Method
------
* Reference values: months with quality "ok" inside ``ref_years``.
* Leave-one-out: when the evaluated month is itself in the reference period,
  its own year is excluded. With short records (e.g. 6 years) including it
  would pull every value towards the middle and cap the maximum at 91.7 %.
* Percentile = mid-rank empirical percentile:
      100 * (n_below + 0.5 * n_equal) / n_ref
  Ties (for example several zero months) are handled symmetrically.
* activity_class is chosen to be honest about a small n:
      above_range  value > every reference value (a record for that month)
      below_range  value < every reference value
      within_range otherwise
  With n_ref = 5, "above_range" is the most that can be said. A "90th
  percentile" from 5 numbers would be false precision.
* Months that are not "ok" (partial or no coverage) are not evaluated. They are
  never extrapolated.
"""

from __future__ import annotations

import numpy as np
import pandas as pd

MIN_REF = 3  # below this, no percentile is reported

SEASONAL_COLUMNS = (
    "region_id", "series", "sensor", "month", "cal_month", "metric", "value",
    "ref_period", "n_ref", "ref_median", "ref_min", "ref_max",
    "percentile", "activity_class",
)


def _mid_rank_pct(x: float, ref: np.ndarray) -> float:
    return float(100.0 * ((ref < x).sum() + 0.5 * (ref == x).sum()) / len(ref))


def seasonal_percentiles(
    monthly: pd.DataFrame,
    metric: str = "active_cells",
    ref_years: tuple[int, int] | None = None,
    min_ref: int = MIN_REF,
) -> pd.DataFrame:
    """Return one row per monthly row with its seasonal percentile.

    ref_years : inclusive (first, last) year of the reference period.
        None means all years that have "ok" data.
    """
    if metric not in monthly.columns:
        raise KeyError(f"metric {metric!r} not in monthly table")
    df = monthly.reset_index(drop=True)  # robust to duplicate input indices
    df["year"] = df["month"].str[:4].astype(int)
    df["cal_month"] = df["month"].str[5:7]
    df["value"] = pd.to_numeric(df[metric], errors="coerce").astype("float64")
    usable = (df["quality"] == "ok") & df["value"].notna()

    if ref_years is None:
        yrs = df.loc[usable, "year"]
        ref_years = (int(yrs.min()), int(yrs.max())) if len(yrs) else (0, -1)
    y0, y1 = ref_years
    in_ref = usable & df["year"].between(y0, y1)

    out = []
    for _, g in df.groupby(["region_id", "series", "cal_month"], sort=False):
        ref = g.loc[in_ref.loc[g.index], ["year", "value"]]
        for idx, row in g.iterrows():
            rec = {"n_ref": 0, "ref_median": np.nan, "ref_min": np.nan,
                   "ref_max": np.nan, "percentile": np.nan}
            if not usable.loc[idx]:
                rec["activity_class"] = "not_evaluated"
            else:
                others = ref.loc[ref["year"] != row["year"], "value"].to_numpy()
                rec["n_ref"] = len(others)
                if len(others) < min_ref:
                    rec["activity_class"] = "insufficient_reference"
                else:
                    x = row["value"]
                    rec.update(ref_median=float(np.median(others)),
                               ref_min=float(others.min()), ref_max=float(others.max()),
                               percentile=round(_mid_rank_pct(x, others), 1))
                    rec["activity_class"] = ("above_range" if x > others.max() else
                                             "below_range" if x < others.min() else
                                             "within_range")
            out.append({"_idx": idx, **rec})

    res = pd.DataFrame(out).set_index("_idx").sort_index()
    df = df.join(res)
    df["metric"] = metric
    df["ref_period"] = f"{y0}-{y1}"
    df["n_ref"] = df["n_ref"].astype("Int64")
    return (df[list(SEASONAL_COLUMNS)]
            .sort_values(["region_id", "series", "month"]).reset_index(drop=True))
