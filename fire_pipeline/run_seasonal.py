"""Seasonal percentiles + sensor agreement from the monthly table.

Usage:
    python -m fire_pipeline.run_seasonal
    python -m fire_pipeline.run_seasonal --ref-years 2020 2025 --metrics active_cells

Reads  data/processed/monthly_<tag>.csv  (from run_monthly)
Writes data/processed/seasonal_<tag>.csv   long format, one row per month x series x metric
       data/processed/agreement_<tag>.json pairwise agreement + Stage 5 assessment
"""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import pandas as pd

from .agreement import sensor_agreement
from .percentiles import seasonal_percentiles

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_METRICS = ("active_cells", "active_cell_days", "hotspot_count", "frp_sum_mw")


def run(monthly_csv: Path, out_dir: Path, metrics, ref_years) -> tuple[pd.DataFrame, list[dict]]:
    monthly = pd.read_csv(monthly_csv, dtype={"month": "str"})
    seasonal = pd.concat([seasonal_percentiles(monthly, m, ref_years) for m in metrics],
                         ignore_index=True)
    agreement = sensor_agreement(seasonal)
    tag = monthly_csv.stem.removeprefix("monthly_")
    out_dir.mkdir(parents=True, exist_ok=True)
    seasonal.to_csv(out_dir / f"seasonal_{tag}.csv", index=False)
    (out_dir / f"agreement_{tag}.json").write_text(json.dumps(
        {"source": monthly_csv.name, "ref_years": seasonal["ref_period"].iloc[0],
         "metrics": list(metrics), "pairs": agreement}, indent=2))
    return seasonal, agreement


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--monthly", type=Path, default=ROOT / "data/processed/monthly_mx_bcn.csv")
    ap.add_argument("--out", type=Path, default=ROOT / "data/processed")
    ap.add_argument("--metrics", nargs="+", default=list(DEFAULT_METRICS))
    ap.add_argument("--ref-years", nargs=2, type=int, default=None, metavar=("FIRST", "LAST"))
    a = ap.parse_args(argv)
    seasonal, agreement = run(a.monthly, a.out, a.metrics, tuple(a.ref_years) if a.ref_years else None)

    print(f"{'metric':17s} {'pair':28s} {'n':>3} {'rho_raw':>7} {'rho_pct':>7} "
          f"{'|dP|':>5} {'kappa':>6} {'ratio':>6}  assessment")
    for r in agreement:
        print(f"{r['metric']:17s} {r['series_a'] + ' vs ' + r['series_b']:28s} {r['n_months']:>3} "
              f"{r['spearman_raw']!s:>7} {r['spearman_percentile']!s:>7} "
              f"{r['mean_abs_percentile_diff']!s:>5} {r['above_range']['kappa']!s:>6} "
              f"{r['ratio_b_over_a']['median']!s:>6}  {r['assessment']['percentile_agreement']}")


if __name__ == "__main__":
    main()
