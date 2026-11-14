"""Fetch NASA POWER monthly data and build regional weather context.

Usage:
    python -m fire_pipeline.run_weather                 # 1991-2025, normal 1991-2020
    python -m fire_pipeline.run_weather --offline       # use cached raw JSON only

Writes:
    data/raw/power/power_monthly_<VAR>_<bbox>_<years>.json   raw API responses
    data/processed/weather_<tag>.csv                         region x month x variable
    data/processed/weather_report.json                       provenance, cell weights,
                                                             exploratory association
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from . import weather as W
from .regions import load_regions

ROOT = Path(__file__).resolve().parent.parent


def association(weather: pd.DataFrame, seasonal: pd.DataFrame, metric="active_cells") -> list[dict]:
    """Exploratory same-month Spearman between fire percentile and weather anomaly percentile.

    Descriptive only. Short record, autocorrelated months, no causal claim.
    """
    f = seasonal[(seasonal["metric"] == metric) & seasonal["percentile"].notna()]
    w = weather[weather["anomaly_pct"].notna()]
    out = []
    for (rid, series), fg in f.groupby(["region_id", "series"]):
        for var, wg in w[w["region_id"] == rid].groupby("variable"):
            m = fg.merge(wg[["month", "anomaly_pct"]], on="month")
            rho = (m["percentile"].rank().corr(m["anomaly_pct"].rank())
                   if len(m) >= 12 else None)
            out.append({"region_id": rid, "series": series, "metric": metric,
                        "variable": var, "n_months": len(m),
                        "spearman": None if rho is None else round(float(rho), 3)})
    return out


def run(boundary: Path, raw_dir: Path, out_dir: Path, start: int, end: int,
        normal: tuple[int, int], offline: bool) -> dict:
    regions = load_regions(boundary)
    bbox = W.covering_bbox(regions.total_bounds)

    frames, metas = [], []
    for var in W.VARIABLES:
        if offline:
            name = f"power_monthly_{var}_{bbox[0]}_{bbox[1]}_{bbox[2]}_{bbox[3]}_{start}-{end}.json"
            path = raw_dir / name
            if not path.exists():
                raise FileNotFoundError(path)
        else:
            path = W.fetch(var, bbox, start, end, raw_dir)
        df, meta = W.parse(path)
        frames.append(df)
        metas.append(meta)
        print(f"{var:12s} {meta['unit']:7s} points={df[['lon', 'lat']].drop_duplicates().shape[0]} "
              f"months={df['month'].nunique()} missing={int(df['value'].isna().sum())}  {path.name}")

    cells = pd.concat(frames, ignore_index=True)
    weights = W.cell_weights(cells["lon"], cells["lat"], regions)
    qc = W.qc_suspect(cells)
    excluded = set(zip(qc["variable"], qc["month"]))
    for r in qc.itertuples():
        print(f"QC excluded: {r.variable} {r.month} ({r.n_cells_over} cells > "
              f"{W.PLAUSIBLE_MAX[r.variable]}, max {r.max_value})")
    reg = W.anomalies(W.regional_means(cells, weights, excluded), normal)
    units = {m["variable"]: m["unit"] for m in metas}
    reg["unit"] = reg["variable"].map(units)
    reg["source"] = f"NASA POWER {metas[0]['api_version']} ({'/'.join(metas[0]['sources'])})"
    reg = reg[list(W.WEATHER_COLUMNS)].sort_values(["region_id", "variable", "month"])

    out_dir.mkdir(parents=True, exist_ok=True)
    tag = "_".join(regions["region_id"]).lower().replace("-", "_")
    reg.to_csv(out_dir / f"weather_{tag}.csv", index=False)

    seasonal_csv = out_dir / f"seasonal_{tag}.csv"
    assoc = []
    if seasonal_csv.exists():
        seasonal = pd.read_csv(seasonal_csv, dtype={"month": "str"})
        assoc = association(reg, seasonal)

    report = {
        "api": W.API, "community": "AG", "bbox_cell_centres": bbox,
        "grid": {"dlon": W.DLON, "dlat": W.DLAT, "source": "MERRA-2 native"},
        "years": [start, end], "normal_period": list(normal),
        "variables": metas,
        "cell_weights": weights.to_dict(orient="records"),
        "aggregation": "area-weighted mean of native cells, intersection areas in EPSG:6933",
        "qc": {"plausible_max_cell_monthly_mean": W.PLAUSIBLE_MAX,
               "excluded": qc.to_dict(orient="records"),
               "note": "Whole variable-month set to null when any native cell exceeds the "
                       "bound (source artifact, e.g. PRECTOTCORR 2020-06 with 2110 mm on "
                       "2020-06-10 at -115.0/28.5 in the POWER daily API)."},
        "association_exploratory": {
            "note": "Same-month Spearman between fire seasonal percentile and weather "
                    "anomaly percentile, 2020-2025. Descriptive only; not causal; "
                    "no significance claimed (short, autocorrelated record).",
            "results": assoc,
        },
    }
    (out_dir / "weather_report.json").write_text(json.dumps(report, indent=2))
    return report


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--boundary", type=Path, default=ROOT / "data/boundaries/mx_bcn_adm1.geojson")
    ap.add_argument("--raw", type=Path, default=ROOT / "data/raw/power")
    ap.add_argument("--out", type=Path, default=ROOT / "data/processed")
    ap.add_argument("--start", type=int, default=1991)
    ap.add_argument("--end", type=int, default=2025)
    ap.add_argument("--normal", nargs=2, type=int, default=list(W.NORMAL))
    ap.add_argument("--offline", action="store_true")
    a = ap.parse_args(argv)
    rep = run(a.boundary, a.raw, a.out, a.start, a.end, tuple(a.normal), a.offline)
    print(f"\ncells used: {len(rep['cell_weights'])}  normal: {rep['normal_period']}")
    for r in rep["association_exploratory"]["results"]:
        print(f"  {r['series']:13s} {r['variable']:12s} n={r['n_months']} rho={r['spearman']}")


if __name__ == "__main__":
    main()
