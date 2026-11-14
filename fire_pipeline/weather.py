"""NASA POWER environmental context: regional monthly means and anomalies.

Source: NASA POWER Monthly & Annual API, regional endpoint, MERRA-2 native grid
(0.5 deg lat x 0.625 deg lon; each value represents a grid cell centred on the
returned point). Community "AG".

Variables (units as returned by POWER, AG community):
    T2M          air temperature at 2 m           degC
    RH2M         relative humidity at 2 m         %
    PRECTOTCORR  bias-corrected precipitation     mm/day (monthly mean of daily totals)
    WS10M        wind speed at 10 m               m/s

Regional value = area-weighted mean of the native cells. A cell's weight is its
intersection area with the region polygon (computed in equal-area EPSG:6933).
Native resolution is kept: nothing is interpolated or downscaled. A region mean
is only produced when the cells with valid data cover the whole region.

Anomalies are computed against a fixed climatological normal (default
1991-2020, the WMO standard normal), per calendar month:
    anomaly     = value - normal_mean
    anomaly_pct = percentile of value within the normal-period values
Quality control
---------------
A known source artifact exists: PRECTOTCORR for 2020-06 reports up to 2,110 mm
in one day (2020-06-10, -115.0/28.5) in the central Baja California desert,
which is physically impossible (the world one-day record is about 1,825 mm). It
yields monthly means up to 151 mm/day, while every other cell-month in 1991-2025
stays at or below 11.8 mm/day. Rule: if any native cell in a variable-month
exceeds PLAUSIBLE_MAX, the whole variable-month is set to null with quality
"qc_excluded" for every region, because the artifact also contaminates nearby
cells. Excluded months are also left out of the normal. No replacement values.

These describe environmental context only. Association with fire activity
does not imply causation.

POWER monthly values follow local solar time (LST). FIRMS months are UTC; the
difference (~8 h at month boundaries) is negligible for monthly means.
"""

from __future__ import annotations

import json
import math
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import requests
from shapely.geometry import box

API = "https://power.larc.nasa.gov/api/temporal/monthly/regional"
VARIABLES = ("T2M", "RH2M", "PRECTOTCORR", "WS10M")
DLON, DLAT = 0.625, 0.5  # MERRA-2 native grid
EQUAL_AREA = "EPSG:6933"
NORMAL = (1991, 2020)
# Upper plausibility bound for a native cell's monthly mean (variable units).
# 30 mm/day is ~2.5x the highest legitimate cell-month in this region's 1991-2025 record.
PLAUSIBLE_MAX = {"PRECTOTCORR": 30.0}

WEATHER_COLUMNS = (
    "region_id", "month", "cal_month", "variable", "unit", "value",
    "normal_period", "normal_mean", "anomaly", "anomaly_pct",
    "n_cells", "valid_weight_fraction", "quality", "source",
)


def covering_bbox(bounds) -> tuple[float, float, float, float]:
    """Smallest bbox of native cell *centres* whose cells cover ``bounds``."""
    x0, y0, x1, y1 = bounds
    lon0 = math.floor((x0 + DLON / 2) / DLON) * DLON
    lon1 = math.ceil((x1 - DLON / 2) / DLON) * DLON
    lat0 = math.floor((y0 + DLAT / 2) / DLAT) * DLAT
    lat1 = math.ceil((y1 - DLAT / 2) / DLAT) * DLAT
    return lon0, lat0, lon1, lat1


def fetch(variable: str, bbox, start: int, end: int, out_dir: Path,
          timeout: int = 300) -> Path:
    """Download one variable to ``out_dir`` (skipped if already present)."""
    lon0, lat0, lon1, lat1 = bbox
    name = f"power_monthly_{variable}_{lon0}_{lat0}_{lon1}_{lat1}_{start}-{end}.json"
    path = out_dir / name
    if path.exists():
        return path
    params = {"parameters": variable, "community": "AG", "format": "json",
              "longitude-min": lon0, "longitude-max": lon1,
              "latitude-min": lat0, "latitude-max": lat1, "start": start, "end": end}
    r = requests.get(API, params=params, timeout=timeout,
                     headers={"User-Agent": "fire-seasons-pipeline/0.1"})
    r.raise_for_status()
    data = r.json()
    if data.get("messages"):
        raise RuntimeError(f"POWER returned messages for {variable}: {data['messages']}")
    out_dir.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(data))
    return path


def parse(path: Path) -> tuple[pd.DataFrame, dict]:
    """POWER regional JSON -> long table [lon, lat, month, variable, value] + metadata."""
    d = json.loads(Path(path).read_text())
    fill = d["header"].get("fill_value", -999.0)
    (var,) = d["parameters"].keys()
    rows = []
    for f in d["features"]:
        lon, lat = f["geometry"]["coordinates"][:2]
        for k, v in f["properties"]["parameter"][var].items():
            if k.endswith("13"):  # annual value
                continue
            rows.append((lon, lat, f"{k[:4]}-{k[4:6]}", var,
                         np.nan if v is None or v == fill else float(v)))
    df = pd.DataFrame(rows, columns=["lon", "lat", "month", "variable", "value"])
    meta = {"variable": var, "unit": d["parameters"][var]["units"],
            "longname": d["parameters"][var]["longname"],
            "sources": d["header"].get("sources"), "api_version": d["header"]["api"]["version"],
            "time_standard": d["header"].get("time_standard"),
            "start": d["header"].get("start"), "end": d["header"].get("end"),
            "file": Path(path).name}
    return df, meta


def cell_weights(lons, lats, regions: gpd.GeoDataFrame) -> pd.DataFrame:
    """Area weight of each native cell in each region (weights sum to 1 per region)."""
    pts = sorted(set(zip(lons, lats)))
    cells = gpd.GeoDataFrame(
        {"lon": [p[0] for p in pts], "lat": [p[1] for p in pts]},
        geometry=[box(x - DLON / 2, y - DLAT / 2, x + DLON / 2, y + DLAT / 2) for x, y in pts],
        crs="EPSG:4326").to_crs(EQUAL_AREA)
    reg = regions.to_crs(EQUAL_AREA)
    out = []
    for rid, geom in zip(reg["region_id"], reg.geometry):
        inter = cells.geometry.intersection(geom).area
        total = geom.area
        covered = inter.sum() / total
        if covered < 0.999:
            raise ValueError(f"{rid}: POWER cells cover only {covered:.1%} of the region; "
                             "request a larger bbox")
        w = cells.assign(region_id=rid, weight=inter / total)[["region_id", "lon", "lat", "weight"]]
        out.append(w[w["weight"] > 0])
    return pd.concat(out, ignore_index=True)


def qc_suspect(cells: pd.DataFrame, limits: dict | None = None) -> pd.DataFrame:
    """Variable-months where any native cell exceeds its plausibility bound."""
    limits = PLAUSIBLE_MAX if limits is None else limits
    lim = cells["variable"].map(limits)
    bad = cells[lim.notna() & (cells["value"] > lim)]
    return (bad.groupby(["variable", "month"])
               .agg(n_cells_over=("value", "size"), max_value=("value", "max"))
               .reset_index())


def regional_means(cells: pd.DataFrame, weights: pd.DataFrame,
                   excluded: set[tuple[str, str]] = frozenset()) -> pd.DataFrame:
    """Area-weighted regional mean per region x month x variable.

    ``excluded``: {(variable, month)} pairs forced to null / "qc_excluded".
    """
    m = cells.merge(weights, on=["lon", "lat"], how="inner")
    m["valid_w"] = m["weight"].where(m["value"].notna(), 0.0)
    m["wv"] = (m["value"] * m["weight"]).fillna(0.0)
    g = (m.groupby(["region_id", "month", "variable"])
          .agg(wv=("wv", "sum"), valid_weight_fraction=("valid_w", "sum"),
               n_cells=("weight", "size"))
          .reset_index())
    g["valid_weight_fraction"] = g["valid_weight_fraction"].round(6)
    complete = g["valid_weight_fraction"] >= 0.999
    g["value"] = (g["wv"] / g["valid_weight_fraction"]).where(complete).round(3)
    g["quality"] = np.where(complete, "ok",
                            np.where(g["valid_weight_fraction"] > 0, "partial_coverage", "no_data"))
    if excluded:
        ex = pd.Series([(v, m) in excluded for v, m in zip(g["variable"], g["month"])],
                       index=g.index)
        g.loc[ex, "value"] = np.nan
        g.loc[ex, "quality"] = "qc_excluded"
    return g.drop(columns="wv")


def anomalies(reg: pd.DataFrame, normal: tuple[int, int] = NORMAL) -> pd.DataFrame:
    """Add calendar-month normal, anomaly and percentile within the normal period."""
    df = reg.copy()
    df["cal_month"] = df["month"].str[5:7]
    year = df["month"].str[:4].astype(int)
    in_normal = year.between(*normal) & (df["quality"] == "ok")
    # WMO-style completeness: each calendar month needs >= 80 % of normal years.
    n_years = normal[1] - normal[0] + 1
    ref = df[in_normal].groupby(["region_id", "variable", "cal_month"])["value"]
    counts = ref.count().reindex(
        pd.MultiIndex.from_frame(df[["region_id", "variable", "cal_month"]].drop_duplicates()),
        fill_value=0)
    short = counts[counts < 0.8 * n_years]
    if len(short):
        raise ValueError(f"normal period {normal} incomplete (<80 % of years) for "
                         f"{short.to_dict()}")

    df = df.join(ref.mean().rename("normal_mean").round(3),
                 on=["region_id", "variable", "cal_month"])
    df["anomaly"] = (df["value"] - df["normal_mean"]).round(3)

    refvals = {k: v.to_numpy() for k, v in ref}
    def pct(row):
        r = refvals.get((row.region_id, row.variable, row.cal_month))
        if r is None or pd.isna(row.value):
            return np.nan
        return round(100 * ((r < row.value).sum() + 0.5 * (r == row.value).sum()) / len(r), 1)
    df["anomaly_pct"] = [pct(r) for r in df.itertuples()]
    df["normal_period"] = f"{normal[0]}-{normal[1]}"
    return df
