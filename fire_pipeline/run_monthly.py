"""Build the monthly activity table from FIRMS country-yearly files.

Usage:
    python -m fire_pipeline.run_monthly                # defaults below
    python -m fire_pipeline.run_monthly --cell-km 10 --out data/processed

Inputs: data/raw/firms/{modis,viirs}/*_<YEAR>_<Country>.csv, which are the FIRMS
"Yearly summary by country" standard-processing files. Each one covers the
calendar year (UTC) in its filename, and that is how coverage is declared.

Outputs (data/processed/):
    detections_<region>.csv   canonical detections inside the region
    monthly_<region>.csv      region x series x month table (default: type 0 only)
    run_report.json           inputs (SHA-256), validation, filter counts, coverage
"""

from __future__ import annotations

import argparse
import json
import re
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd

from . import load_firms_csv
from .aggregate import monthly_activity
from .grid import grid_metadata
from .regions import filter_to_regions, load_regions

ROOT = Path(__file__).resolve().parent.parent
YEAR_RE = re.compile(r"_(\d{4})_[^_]+\.csv$")


def _year_of(path: Path) -> int:
    m = YEAR_RE.search(path.name)
    if not m:
        raise ValueError(f"{path.name}: cannot read year; expected '<product>_<YEAR>_<Country>.csv'")
    return int(m.group(1))


def _coverage(years_by_series: dict[str, list[int]]) -> dict[str, tuple[str, str]]:
    cov = {}
    for s, years in years_by_series.items():
        ys = sorted(set(years))
        if ys != list(range(ys[0], ys[-1] + 1)):
            raise ValueError(f"{s}: non-contiguous years {ys}; coverage would include gaps")
        cov[s] = (f"{ys[0]}-01-01", f"{ys[-1]}-12-31")
    return cov


def run(raw_dir: Path, boundary: Path, out_dir: Path, cell_km: float,
        fire_types: list[int] | None = (0,)) -> dict:
    regions = load_regions(boundary)
    files = sorted(raw_dir.glob("modis/*.csv")) + sorted(raw_dir.glob("viirs/*.csv"))
    if not files:
        raise FileNotFoundError(f"no CSV files under {raw_dir}/{{modis,viirs}}")

    kept, inputs, years_by_series = [], [], {}
    for f in files:
        df, rep = load_firms_csv(f)
        series = sorted(df["series"].unique())
        if len(series) != 1:
            raise ValueError(f"{f.name}: expected one series, found {series}")
        years_by_series.setdefault(series[0], []).append(_year_of(f))
        inside, frep = filter_to_regions(df, regions)
        kept.append(inside)
        inputs.append({**rep.to_dict(), "series": series[0], "year": _year_of(f),
                       "path": str(f.relative_to(ROOT) if f.is_relative_to(ROOT) else f),
                       "region_filter": frep.to_dict()})
        print(f"{f.name:34s} read={rep.rows_read:>7} valid={rep.rows_valid:>7} "
              f"in_region={frep.rows_matched:>6} {rep.collections} {rep.dropped or ''}")

    det = pd.concat(kept, ignore_index=True)
    cov = _coverage(years_by_series)

    # Fire-type filter for the monthly table (detections file keeps everything).
    # Rows without `type` (NRT files) are kept and counted, since they cannot be classified.
    if fire_types is None:
        season = det
    else:
        season = det[det["fire_type"].isin(fire_types) | det["fire_type"].isna()]
    excluded = (det.drop(season.index).groupby(["series", "fire_type"]).size()
                   .unstack(fill_value=0).to_dict(orient="index"))
    monthly = monthly_activity(season, regions["region_id"], cov, cell_m=cell_km * 1000)

    out_dir.mkdir(parents=True, exist_ok=True)
    tag = "_".join(regions["region_id"]).lower().replace("-", "_")
    det_out = det.assign(acq_datetime_utc=det["acq_datetime_utc"].dt.strftime("%Y-%m-%dT%H:%MZ"))
    det_out.to_csv(out_dir / f"detections_{tag}.csv", index=False)
    monthly.to_csv(out_dir / f"monthly_{tag}.csv", index=False)

    report = {
        "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "boundary": str(boundary.relative_to(ROOT) if boundary.is_relative_to(ROOT) else boundary),
        "regions": list(regions["region_id"]),
        "coverage": cov,
        "grid": grid_metadata(cell_km * 1000),
        "monthly_fire_types": None if fire_types is None else list(fire_types),
        "monthly_unclassified_type_rows": int(season["fire_type"].isna().sum()),
        "monthly_excluded_by_type": {s: {str(k): int(v) for k, v in d.items()}
                                     for s, d in excluded.items()},
        "collections_by_series_year": {
            s: {str(i["year"]): i["collections"] for i in inputs if i["series"] == s}
            for s in cov
        },
        "inputs": inputs,
        "outputs": {"detections_rows": len(det), "monthly_input_rows": len(season),
                    "monthly_rows": len(monthly)},
    }
    (out_dir / "run_report.json").write_text(json.dumps(report, indent=2, default=str))
    return report


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--raw", type=Path, default=ROOT / "data" / "raw" / "firms")
    ap.add_argument("--boundary", type=Path,
                    default=ROOT / "data" / "boundaries" / "mx_bcn_adm1.geojson")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--cell-km", type=float, default=10.0)
    ap.add_argument("--fire-types", default="0",
                    help="comma list of FIRMS `type` codes counted in monthly table, or 'all' "
                         "(0 vegetation, 1 volcano, 2 static land source, 3 offshore)")
    a = ap.parse_args(argv)
    types = None if a.fire_types == "all" else [int(t) for t in a.fire_types.split(",")]
    rep = run(a.raw, a.boundary, a.out, a.cell_km, types)
    print(f"monthly table fire types: {a.fire_types}; excluded: {rep['monthly_excluded_by_type']}")
    print(f"\ncoverage: {rep['coverage']}\noutputs: {rep['outputs']} -> {a.out}")


if __name__ == "__main__":
    main()
