"""Agreement between sensor series (harmonization Stages 4 and 5).

Comparisons use only months that both series evaluated (quality "ok",
percentile present). For each pair of series:

* spearman_raw: rank correlation of the raw metric. It is inflated by the
  shared seasonal cycle and is reported only for context.
* spearman_percentile: rank correlation of the seasonal percentiles, i.e. of
  each series' anomaly relative to its own climatology. This is the main
  agreement statistic, because it removes the seasonal cycle and the
  sensitivity difference.
* mean / median absolute percentile difference.
* above_range agreement: contingency table of "record month" flags,
  plus Cohen's kappa and Jaccard index.
* ratio b/a of the raw metric: how many VIIRS cells per MODIS cell. A stable
  ratio suggests a consistent sensitivity difference, a varying one does not.

No p-values are reported. Monthly series are autocorrelated and the record is
short, so naive p-values would overstate significance.

Stage 5 assessment uses documented heuristic thresholds (ASSESSMENT_RULES).
They decide what kind of comparison the data supports. They do not show
physical equivalence, and raw counts are never declared comparable.
"""

from __future__ import annotations

import itertools

import numpy as np
import pandas as pd

ASSESSMENT_RULES = {
    "min_months": 24,
    "strong_percentile_spearman": 0.6,
    "moderate_percentile_spearman": 0.4,
    "min_kappa_for_event_agreement": 0.4,
    "max_ratio_iqr_over_median": 0.5,
}


def _spearman(a: pd.Series, b: pd.Series) -> float | None:
    if len(a) < 3 or a.nunique() < 2 or b.nunique() < 2:
        return None
    return round(float(a.rank().corr(b.rank())), 3)


def _kappa(x: np.ndarray, y: np.ndarray) -> float | None:
    n = len(x)
    if n == 0:
        return None
    po = float((x == y).mean())
    px, py = x.mean(), y.mean()
    pe = px * py + (1 - px) * (1 - py)
    if pe >= 1:
        return None  # both series constant: kappa undefined
    return round(float((po - pe) / (1 - pe)), 3)


def _assess(r: dict) -> dict:
    R = ASSESSMENT_RULES
    notes = ["Raw hotspot counts are not comparable between sensors (resolution, "
             "sensitivity, overpass time differ); compare percentiles instead."]
    sp = r["spearman_percentile"]
    if r["n_months"] < R["min_months"] or sp is None:
        level = "insufficient_data"
    elif sp >= R["strong_percentile_spearman"]:
        level = "strong"
    elif sp >= R["moderate_percentile_spearman"]:
        level = "moderate"
    else:
        level = "weak"
    k = r["above_range"]["kappa"]
    events = bool(k is not None and k >= R["min_kappa_for_event_agreement"])
    rr = r["ratio_b_over_a"]
    ratio_stable = (rr["median"] not in (None, 0) and rr["iqr"] is not None
                    and rr["iqr"] / rr["median"] <= R["max_ratio_iqr_over_median"])
    if level in ("strong", "moderate"):
        notes.append(f"{level.capitalize()} agreement in relative (seasonal-percentile) activity.")
    if not events:
        notes.append("Record-month (above_range) flags do not agree well enough to treat "
                     "one sensor's anomaly as confirming the other's.")
    if not ratio_stable:
        notes.append("Cell ratio between series varies a lot month to month; "
                     "do not convert one series into the other with a fixed factor.")
    return {"percentile_agreement": level, "event_agreement": events,
            "stable_ratio": bool(ratio_stable), "notes": notes, "rules": R}


def sensor_agreement(seasonal: pd.DataFrame) -> list[dict]:
    """Pairwise agreement for every region and metric in a seasonal table."""
    results = []
    for (region, metric), g in seasonal.groupby(["region_id", "metric"]):
        val = g.pivot(index="month", columns="series", values="value")
        pct = g.pivot(index="month", columns="series", values="percentile")
        cls = g.pivot(index="month", columns="series", values="activity_class")
        for a, b in itertools.combinations(sorted(g["series"].unique()), 2):
            both = pct[a].notna() & pct[b].notna()
            n = int(both.sum())
            pa, pb = pct.loc[both, a], pct.loc[both, b]
            va, vb = val.loc[both, a], val.loc[both, b]
            ea = (cls.loc[both, a] == "above_range").to_numpy()
            eb = (cls.loc[both, b] == "above_range").to_numpy()
            pos = va > 0
            ratio = (vb[pos] / va[pos]) if pos.any() else pd.Series(dtype=float)
            diff = (pa - pb).abs()
            r = {
                "region_id": region, "metric": metric, "series_a": a, "series_b": b,
                "n_months": n,
                "period": [str(pct.index[both].min()), str(pct.index[both].max())] if n else None,
                "spearman_raw": _spearman(va, vb),
                "spearman_percentile": _spearman(pa, pb),
                "mean_abs_percentile_diff": round(float(diff.mean()), 1) if n else None,
                "median_abs_percentile_diff": round(float(diff.median()), 1) if n else None,
                "above_range": {
                    "both": int((ea & eb).sum()), "only_a": int((ea & ~eb).sum()),
                    "only_b": int((~ea & eb).sum()), "neither": int((~ea & ~eb).sum()),
                    "kappa": _kappa(ea, eb),
                    "jaccard": (round(float((ea & eb).sum() / (ea | eb).sum()), 3)
                                if (ea | eb).any() else None),
                },
                "ratio_b_over_a": {
                    "n": int(len(ratio)),
                    "median": round(float(ratio.median()), 2) if len(ratio) else None,
                    "iqr": (round(float(ratio.quantile(.75) - ratio.quantile(.25)), 2)
                            if len(ratio) else None),
                },
            }
            r["assessment"] = _assess(r)
            results.append(r)
    return results
