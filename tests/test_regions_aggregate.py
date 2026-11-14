"""Tests for polygon filtering, the common grid and monthly aggregation."""

from pathlib import Path

import geopandas as gpd
import pandas as pd
import pytest
from shapely.geometry import Point, Polygon, box

from fire_pipeline import load_firms_csv
from fire_pipeline.aggregate import monthly_activity
from fire_pipeline.grid import assign_cells
from fire_pipeline.regions import RegionError, filter_to_regions, load_regions

ROOT = Path(__file__).parent.parent
BCN = ROOT / "data" / "boundaries" / "mx_bcn_adm1.geojson"
FIX = Path(__file__).parent / "fixtures"


def det(lat, lon, when="2024-08-15 10:00", sensor="MODIS", frp=10.0, region="R1"):
    return {"region_id": region, "sensor": sensor, "latitude": lat, "longitude": lon,
            "acq_datetime_utc": pd.Timestamp(when, tz="UTC"), "frp_mw": frp}


def frame(*rows):
    return pd.DataFrame(list(rows))


# ---------------------------------------------------------------- 3. geographic filtering
@pytest.fixture(scope="module")
def bcn():
    return load_regions(BCN)


@pytest.mark.parametrize("lat,lon,inside", [
    (32.5149, -117.0382, True),    # Tijuana
    (32.6245, -115.4523, True),    # Mexicali
    (31.8667, -116.5964, True),    # Ensenada
    (32.7157, -117.1611, False),   # San Diego, USA
    (32.4560, -114.7710, False),   # San Luis Rio Colorado, Sonora
    (32.0000, -118.0000, False),   # Pacific Ocean
])
def test_real_polygon_point_in_polygon(bcn, lat, lon, inside):
    df = pd.DataFrame({"latitude": [lat], "longitude": [lon],
                       "acq_datetime_utc": [pd.Timestamp("2024-01-01", tz="UTC")]})
    out, rep = filter_to_regions(df, bcn)
    assert (len(out) == 1) is inside
    assert rep.rows_matched + rep.rows_outside == 1


def test_real_fixture_filtering_drops_usa_and_sonora(bcn):
    df, _ = load_firms_csv(FIX / "viirs_n20_c2_nrt_baja_sample.csv")
    out, rep = filter_to_regions(df, bcn)
    assert rep.rows_in == 122 and 0 < rep.rows_matched < rep.rows_in
    assert set(out["region_id"]) == {"MX-BCN"}
    poly = bcn.geometry.iloc[0]
    assert all(poly.intersects(Point(x, y)) for x, y in zip(out.longitude, out.latitude))
    # the fixture bbox reaches lat 34 (California); Baja California tops out ~32.72
    assert out["latitude"].max() <= 32.72


def test_overlapping_regions_assign_point_to_each():
    regions = gpd.GeoDataFrame({"region_id": ["A", "B"]},
                               geometry=[box(0, 0, 2, 2), box(1, 1, 3, 3)], crs="EPSG:4326")
    df = pd.DataFrame({"latitude": [1.5, 0.5], "longitude": [1.5, 0.5],
                       "acq_datetime_utc": pd.Timestamp("2024-01-01", tz="UTC")})
    out, rep = filter_to_regions(df, regions)
    assert rep.per_region == {"A": 2, "B": 1} and rep.rows_matched == 2


def test_projected_regions_are_reprojected():
    regions = gpd.GeoDataFrame({"region_id": ["A"]}, geometry=[box(0, 0, 2, 2)],
                               crs="EPSG:4326").to_crs("EPSG:3857")
    df = pd.DataFrame({"latitude": [1.0], "longitude": [1.0],
                       "acq_datetime_utc": pd.Timestamp("2024-01-01", tz="UTC")})
    assert len(filter_to_regions(df, regions)[0]) == 1


def test_invalid_or_duplicate_regions_rejected(tmp_path):
    bowtie = Polygon([(0, 0), (1, 1), (1, 0), (0, 1)])
    p = tmp_path / "bad.geojson"
    gpd.GeoDataFrame({"region_id": ["A"]}, geometry=[bowtie], crs="EPSG:4326").to_file(p)
    with pytest.raises(RegionError, match="invalid"):
        load_regions(p)
    p2 = tmp_path / "dup.geojson"
    gpd.GeoDataFrame({"region_id": ["A", "A"]}, geometry=[box(0, 0, 1, 1)] * 2,
                     crs="EPSG:4326").to_file(p2)
    with pytest.raises(RegionError, match="unique"):
        load_regions(p2)


# ---------------------------------------------------------------- common grid
def test_grid_same_and_different_cells():
    df = pd.DataFrame({"latitude": [32.50, 32.501, 32.90], "longitude": [-116.0, -116.001, -116.0]})
    ids = assign_cells(df, 10_000)["cell_id"]
    assert ids[0] == ids[1] != ids[2]
    assert list(assign_cells(df, 10_000)["cell_id"]) == list(ids)  # deterministic


def test_grid_rejects_bad_cell_size():
    with pytest.raises(ValueError):
        assign_cells(pd.DataFrame({"latitude": [0.0], "longitude": [0.0]}), 0)


# ---------------------------------------------------------------- 4. monthly aggregation
COV = {"MODIS": ("2024-07-01", "2024-09-30")}


def test_counts_preserved_and_zero_months_are_zero():
    d = frame(det(32.5, -116.0), det(32.5, -116.0, "2024-08-16 10:00"),
              det(32.9, -116.0, "2024-08-20 10:00"))
    m = monthly_activity(d, ["R1"], COV).set_index("month")
    assert list(m.index) == ["2024-07", "2024-08", "2024-09"]
    assert m.loc["2024-08", "hotspot_count"] == 3          # raw count kept
    assert m.loc["2024-08", "active_cells"] == 2           # two distinct cells
    assert m.loc["2024-08", "active_cell_days"] == 3
    assert m.loc["2024-08", "frp_sum_mw"] == 30.0
    assert m.loc["2024-07", "hotspot_count"] == 0 and m.loc["2024-07", "quality"] == "ok"
    assert m["hotspot_count"].sum() == len(d)


# ---------------------------------------------------------------- 5. missing data / coverage
def test_months_outside_coverage_are_null_not_zero():
    cov = {"MODIS": ("2024-07-01", "2024-09-30"), "VIIRS": ("2024-08-10", "2024-08-31")}
    d = frame(det(32.5, -116.0), det(32.5, -116.0, sensor="VIIRS"))
    m = monthly_activity(d, ["R1"], cov).set_index(["sensor", "month"])
    v = m.loc["VIIRS"]
    assert v.loc["2024-07", "quality"] == "no_data"
    assert pd.isna(v.loc["2024-07", "hotspot_count"]) and pd.isna(v.loc["2024-07", "frp_sum_mw"])
    assert v.loc["2024-08", "quality"] == "partial_coverage"
    assert v.loc["2024-08", "days_covered"] == 22
    assert v.loc["2024-08", "hotspot_count"] == 1  # raw, not scaled up


def test_region_without_detections_still_listed():
    m = monthly_activity(frame(det(32.5, -116.0)), ["R1", "R2"], COV)
    r2 = m[m.region_id == "R2"]
    assert len(r2) == 3 and (r2["hotspot_count"] == 0).all()


def test_detection_outside_declared_coverage_raises():
    with pytest.raises(ValueError, match="outside declared coverage"):
        monthly_activity(frame(det(32.5, -116.0, "2024-10-02 01:00")), ["R1"], COV)


def test_undeclared_sensor_or_region_raises():
    with pytest.raises(ValueError, match="without declared coverage"):
        monthly_activity(frame(det(32.5, -116.0, sensor="VIIRS")), ["R1"], COV)
    with pytest.raises(ValueError, match="undeclared regions"):
        monthly_activity(frame(det(32.5, -116.0, region="X")), ["R1"], COV)


def test_month_boundary_uses_utc():
    # 2024-08-01 03:00 UTC is still July 31 in Tijuana; we bin by UTC.
    m = monthly_activity(frame(det(32.5, -116.0, "2024-08-01 03:00")), ["R1"], COV)
    assert m.set_index("month").loc["2024-08", "hotspot_count"] == 1


# ---------------------------------------------------------------- 7. sensor separation
def test_sensors_never_summed():
    cov = {"MODIS": COV["MODIS"], "VIIRS": COV["MODIS"]}
    d = frame(det(32.5, -116.0), *[det(32.5, -116.0, sensor="VIIRS")] * 4)
    m = monthly_activity(d, ["R1"], cov)
    aug = m[m.month == "2024-08"].set_index("sensor")["hotspot_count"]
    assert aug["MODIS"] == 1 and aug["VIIRS"] == 4
    assert len(m) == 2 * 3  # one row per sensor per month, no combined row


# ---------------------------------------------------------------- end to end on real data
def test_end_to_end_real_fixtures(bcn):
    frames = []
    for f in ("modis_c61_nrt_baja_sample.csv", "viirs_n20_c2_nrt_baja_sample.csv"):
        df, _ = load_firms_csv(FIX / f)
        frames.append(filter_to_regions(df, bcn)[0])
    d = pd.concat(frames, ignore_index=True)
    cov = {"MODIS": ("2026-11-07", "2026-11-13"), "VIIRS": ("2026-11-07", "2026-11-13")}
    m1 = monthly_activity(d, ["MX-BCN"], cov)
    m2 = monthly_activity(d, ["MX-BCN"], cov)
    pd.testing.assert_frame_equal(m1, m2)  # 9. reproducible
    assert len(m1) == 2 and set(m1["quality"]) == {"partial_coverage"}
    assert m1["hotspot_count"].sum() == len(d)
    assert (m1["active_cells"] <= m1["hotspot_count"]).all()
