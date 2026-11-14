"""Tests for NASA POWER parsing, area weighting, QC and anomalies (offline)."""

import json
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import pytest
from shapely.geometry import box

from fire_pipeline import weather as W

ROOT = Path(__file__).parent.parent


def power_json(tmp_path, var="T2M", unit="C", points=None, fill=-999.0):
    """Minimal POWER regional response. points: {(lon, lat): {"YYYYMM": value}}"""
    feats = [{"type": "Feature", "geometry": {"type": "Point", "coordinates": [x, y, 0.0]},
              "properties": {"parameter": {var: vals}}} for (x, y), vals in points.items()]
    d = {"type": "FeatureCollection", "features": feats, "messages": [],
         "header": {"fill_value": fill, "sources": ["MERRA2"], "time_standard": "LST",
                    "api": {"version": "v2.10.0"}, "start": "20200101", "end": "20201231"},
         "parameters": {var: {"units": unit, "longname": "x"}}}
    p = tmp_path / f"{var}.json"
    p.write_text(json.dumps(d))
    return p


def region(geom, rid="R"):
    return gpd.GeoDataFrame({"region_id": [rid]}, geometry=[geom], crs="EPSG:4326")


# ---------------------------------------------------------------- parsing
def test_parse_drops_annual_and_fill_values(tmp_path):
    p = power_json(tmp_path, points={(-115.0, 30.0): {"202001": 12.5, "202002": -999.0,
                                                      "202013": 18.0}})
    df, meta = W.parse(p)
    assert list(df["month"]) == ["2020-01", "2020-02"]
    assert df["value"].iloc[0] == 12.5 and np.isnan(df["value"].iloc[1])
    assert meta["unit"] == "C" and meta["variable"] == "T2M" and meta["time_standard"] == "LST"


def test_covering_bbox_matches_real_baja_request():
    from fire_pipeline.regions import load_regions
    b = load_regions(ROOT / "data/boundaries/mx_bcn_adm1.geojson").total_bounds
    assert W.covering_bbox(b) == (-118.125, 28.0, -112.5, 32.5)


# ---------------------------------------------------------------- area weighting
def test_weights_sum_to_one_and_follow_area():
    # region covers the whole left cell and half of the right cell
    reg = region(box(-115.3125, 29.75, -114.375, 30.25))
    w = W.cell_weights([-115.0, -114.375], [30.0, 30.0], reg).set_index("lon")["weight"]
    assert w.sum() == pytest.approx(1.0)
    assert w[-115.0] == pytest.approx(2 / 3, rel=1e-3) and w[-114.375] == pytest.approx(1 / 3, rel=1e-3)


def test_uncovered_region_raises():
    with pytest.raises(ValueError, match="cover only"):
        W.cell_weights([-115.0], [30.0], region(box(-116, 29, -114, 31)))


def cells_frame(vals, var="T2M", month="2020-01"):
    return pd.DataFrame({"lon": [-115.0, -114.375], "lat": [30.0, 30.0], "month": month,
                         "variable": var, "value": vals})


def weights_frame():
    return pd.DataFrame({"region_id": "R", "lon": [-115.0, -114.375], "lat": [30.0, 30.0],
                         "weight": [0.75, 0.25]})


def test_weighted_mean():
    g = W.regional_means(cells_frame([10.0, 20.0]), weights_frame())
    assert g["value"].iloc[0] == pytest.approx(12.5) and g["quality"].iloc[0] == "ok"


def test_missing_cell_gives_partial_and_null_not_reweighted():
    g = W.regional_means(cells_frame([10.0, np.nan]), weights_frame())
    assert g["quality"].iloc[0] == "partial_coverage" and np.isnan(g["value"].iloc[0])
    assert g["valid_weight_fraction"].iloc[0] == pytest.approx(0.75)


# ---------------------------------------------------------------- QC
def test_qc_flags_implausible_precip_and_excludes_whole_month():
    c = pd.concat([cells_frame([151.0, 2.0], "PRECTOTCORR", "2020-06"),
                   cells_frame([11.8, 0.5], "PRECTOTCORR", "1993-01")])
    qc = W.qc_suspect(c)
    assert list(qc["month"]) == ["2020-06"] and qc["max_value"].iloc[0] == 151.0
    g = W.regional_means(c, weights_frame(), set(zip(qc["variable"], qc["month"]))).set_index("month")
    assert g.loc["2020-06", "quality"] == "qc_excluded" and np.isnan(g.loc["2020-06", "value"])
    assert g.loc["1993-01", "quality"] == "ok"  # real wet month kept


# ---------------------------------------------------------------- anomalies
def regional_series(values, start=1991, cal="07", quality=None):
    rows = [{"region_id": "R", "variable": "T2M", "month": f"{start + i}-{cal}",
             "value": v, "quality": (quality or {}).get(start + i, "ok"),
             "n_cells": 1, "valid_weight_fraction": 1.0} for i, v in enumerate(values)]
    return pd.DataFrame(rows)


def test_anomaly_against_fixed_normal():
    vals = list(range(30)) + [100.0]  # 1991..2020 = 0..29, 2021 = 100
    a = W.anomalies(regional_series(vals)).set_index("month")
    assert a.loc["2021-07", "normal_mean"] == pytest.approx(14.5)
    assert a.loc["2021-07", "anomaly"] == pytest.approx(85.5)
    assert a.loc["2021-07", "anomaly_pct"] == 100.0
    assert a.loc["1991-07", "anomaly_pct"] == pytest.approx(100 * 0.5 / 30, abs=0.1)
    assert a.loc["2021-07", "normal_period"] == "1991-2020"


def test_qc_excluded_month_not_in_normal():
    vals = [10.0] * 29 + [1000.0] + [10.0]
    a = W.anomalies(regional_series(vals, quality={2020: "qc_excluded"})).set_index("month")
    assert a.loc["2021-07", "normal_mean"] == 10.0


def test_incomplete_normal_raises():
    with pytest.raises(ValueError, match="incomplete"):
        W.anomalies(regional_series([1.0] * 10))
