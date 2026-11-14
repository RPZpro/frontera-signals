"""Tests for frontend exports: JSON Schema compatibility, nulls, consistency."""

import json
import math
from pathlib import Path

import numpy as np
import pandas as pd
import pytest
from jsonschema import Draft202012Validator

from fire_pipeline import export as E
from fire_pipeline.aggregate import monthly_activity
from fire_pipeline.percentiles import seasonal_percentiles

ROOT = Path(__file__).parent.parent
SCHEMAS = ROOT / "docs" / "schemas"
EXPORT = ROOT / "data" / "export"


def validator(name):
    schema = json.loads((SCHEMAS / f"{name}.schema.json").read_text())
    Draft202012Validator.check_schema(schema)
    return Draft202012Validator(schema)


def assert_valid(name, obj):
    errors = sorted(validator(name).iter_errors(obj), key=lambda e: list(e.path))
    assert not errors, "\n".join(f"{list(e.path)}: {e.message}" for e in errors[:5])


def roundtrip(obj, tmp_path):
    p = tmp_path / "x.json"
    E.write_json(p, obj)
    return json.loads(p.read_text())


# ---------------------------------------------------------------- synthetic builders
@pytest.fixture
def small_monthly():
    rows = []
    for y in range(2020, 2026):
        for s in ("MODIS", "VIIRS_SNPP"):
            rows.append({"region_id": "R1", "sensor": s.split("_")[0], "series": s,
                         "latitude": 32.5, "longitude": -116.0, "frp_mw": 5.0,
                         "acq_datetime_utc": pd.Timestamp(f"{y}-08-10 10:00", tz="UTC")})
    det = pd.DataFrame(rows)
    cov = {"MODIS": ("2020-01-01", "2025-12-31"), "VIIRS_SNPP": ("2020-06-01", "2025-12-31")}
    return monthly_activity(det, ["R1"], cov)


def seasonal_all(monthly):
    return pd.concat([seasonal_percentiles(monthly, m) for m in E.METRICS], ignore_index=True)


def test_monthly_builder_valid_and_uses_null(small_monthly, tmp_path):
    coll = {"MODIS": {"2020": ["C6.0"]}, "VIIRS_SNPP": {}}
    out = roundtrip(E.build_monthly(small_monthly, seasonal_all(small_monthly), coll), tmp_path)
    assert_valid("monthly", out)
    rec = {(r["series"], r["period"]): r for r in out["records"]}
    jan = rec[("VIIRS_SNPP", "2020-01")]  # before VIIRS coverage
    assert jan["quality"] == "no_data" and jan["metrics"]["hotspot_count"]["value"] is None
    assert jan["product_version"] is None
    assert rec[("MODIS", "2020-01")]["metrics"]["hotspot_count"]["value"] == 0  # covered zero
    assert rec[("MODIS", "2020-01")]["product_version"] == "C6.0"
    hc = rec[("MODIS", "2021-08")]["metrics"]["hotspot_count"]
    assert hc["kind"] == "raw" and hc["unit"] == "detections"
    assert rec[("MODIS", "2021-08")]["metrics"]["active_cells"]["kind"] == "derived"


def test_hotspot_builder_valid(tmp_path):
    det = pd.DataFrame([{
        "longitude": -116.123456, "latitude": 32.5, "series": "VIIRS_SNPP", "platform": "Suomi NPP",
        "version": "2", "acq_datetime_utc": "2024-08-10T10:00Z", "daynight": "D",
        "frp_mw": np.nan, "bright_primary_k": 330.0, "confidence_raw": "n",
        "confidence_class": "nominal", "fire_type": 2.0}])
    out = roundtrip(E.build_hotspots(det, [0], "R1", 2024), tmp_path)
    assert_valid("hotspots", out)
    p = out["features"][0]["properties"]
    assert p["frp_mw"] is None and p["fire_type"] == 2 and p["counted"] is False
    assert out["features"][0]["geometry"]["coordinates"][0] == -116.12346


def test_write_json_refuses_nan(tmp_path):
    with pytest.raises(ValueError):
        E.write_json(tmp_path / "x.json", {"v": float("nan")})


def test_clean():
    assert E.clean(np.float64("nan")) is None and E.clean(pd.NA) is None
    assert E.clean(np.int64(3)) == 3 and type(E.clean(np.int64(3))) is int


def test_monthly_builder_reproducible(small_monthly):
    s = seasonal_all(small_monthly)
    assert E.build_monthly(small_monthly, s, {}) == E.build_monthly(small_monthly, s, {})


# ---------------------------------------------------------------- committed exports
needs_export = pytest.mark.skipif(not (EXPORT / "metadata.json").exists(),
                                  reason="run python -m fire_pipeline.export first")


@needs_export
@pytest.mark.parametrize("name", ["metadata", "monthly", "weather", "agreement"])
def test_exported_files_match_schema(name):
    assert_valid(name, json.loads((EXPORT / f"{name}.json").read_text()))


@needs_export
def test_exported_hotspots_match_schema_and_monthly_counts():
    meta = json.loads((EXPORT / "metadata.json").read_text())
    monthly = json.loads((EXPORT / "monthly.json").read_text())
    counted = {}
    for f in meta["files"]:
        if not f.startswith("hotspots_"):
            continue
        fc = json.loads((EXPORT / f).read_text())
        assert_valid("hotspots", fc)
        for ft in fc["features"]:
            p = ft["properties"]
            if p["counted"]:
                key = (p["series"], p["t"][:7])
                counted[key] = counted.get(key, 0) + 1
    # every original observation counted in monthly.json is present in the hotspot files
    for r in monthly["records"]:
        v = r["metrics"]["hotspot_count"]["value"]
        if v is not None:
            assert counted.get((r["series"], r["period"]), 0) == v, (r["series"], r["period"])


@needs_export
def test_exported_files_listed_and_present():
    meta = json.loads((EXPORT / "metadata.json").read_text())
    for f in meta["files"]:
        assert (EXPORT / f).exists(), f
    assert any(l["id"] == "no_cause" for l in meta["limitations"])
    text = (EXPORT / "monthly.json").read_text()
    assert "NaN" not in text and "Infinity" not in text
