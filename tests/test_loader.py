"""Tests for the FIRMS CSV loader.

Fixtures in tests/fixtures/ are unmodified rows from public NASA FIRMS NRT
files (see tests/fixtures/SOURCES.md). Synthetic CSVs are written to tmp_path
only to exercise failure modes.
"""

from pathlib import Path

import pandas as pd
import pytest

from fire_pipeline import SchemaError, ValidationError, load_firms_csv, load_many
from fire_pipeline import schemas as S

FIX = Path(__file__).parent / "fixtures"
MODIS_CSV = FIX / "modis_c61_nrt_baja_sample.csv"
VIIRS_CSV = FIX / "viirs_n20_c2_nrt_baja_sample.csv"

MODIS_HEADER = ("latitude,longitude,brightness,scan,track,acq_date,acq_time,"
                "satellite,confidence,version,bright_t31,frp,daynight")
VIIRS_HEADER = ("latitude,longitude,bright_ti4,scan,track,acq_date,acq_time,"
                "satellite,confidence,version,bright_ti5,frp,daynight")
GOOD_MODIS = "32.5,-116.9,320.1,1.0,1.0,2024-08-01,0905,T,85,6.1NRT,295.0,12.3,D"


def write(tmp_path, name, *lines):
    p = tmp_path / name
    p.write_text("\n".join(lines) + "\n")
    return p


# ---------------------------------------------------------------- authentic data
def test_modis_fixture_loads_and_matches_canonical_schema():
    df, rep = load_firms_csv(MODIS_CSV)
    assert rep.sensor == "MODIS"
    assert rep.rows_read == 22 and rep.rows_valid == 22 and rep.dropped == {}
    assert list(df.columns) == list(S.DETECTION_COLUMN_ORDER)
    assert set(df["platform"]) <= {"Terra", "Aqua"}
    assert df["confidence_pct"].between(0, 100).all()
    assert df["confidence_class"].isin(["low", "nominal", "high"]).all()
    assert df["is_nrt"].all() and set(df["version"]) == {"6.1NRT"}
    assert len(rep.sha256) == 64


def test_viirs_fixture_loads():
    df, rep = load_firms_csv(VIIRS_CSV, sensor="viirs")
    assert rep.sensor == "VIIRS" and rep.rows_valid == rep.rows_read == 122
    assert set(df["platform"]) == {"NOAA-20"}
    assert df["confidence_pct"].isna().all()  # VIIRS has no % confidence
    assert set(df["confidence_class"]) <= {"low", "nominal", "high"}
    # 375 m pixels are much smaller than MODIS 1 km pixels
    assert df["scan"].max() < 1.0


# ---------------------------------------------------------------- 1. schema validation
def test_missing_required_column_raises(tmp_path):
    hdr = MODIS_HEADER.replace(",frp", "")
    row = GOOD_MODIS.replace(",12.3", "")
    with pytest.raises(SchemaError, match="frp"):
        load_firms_csv(write(tmp_path, "m.csv", hdr, row))


def test_unrecognised_file_raises(tmp_path):
    with pytest.raises(SchemaError, match="Cannot identify sensor"):
        load_firms_csv(write(tmp_path, "x.csv", "a,b,c", "1,2,3"))


def test_header_is_case_and_space_insensitive(tmp_path):
    hdr = ", ".join(h.upper() for h in MODIS_HEADER.split(","))
    df, _ = load_firms_csv(write(tmp_path, "m.csv", hdr, GOOD_MODIS))
    assert len(df) == 1


# ---------------------------------------------------------------- 2. timestamps
def test_timestamp_is_utc_and_padded(tmp_path):
    # acq_time "28" (leading zeros stripped by a spreadsheet) means 00:28 UTC
    row = GOOD_MODIS.replace(",0905,", ",28,")
    df, _ = load_firms_csv(write(tmp_path, "m.csv", MODIS_HEADER, GOOD_MODIS, row))
    ts = df["acq_datetime_utc"]
    assert str(ts.dt.tz) == "UTC"
    assert ts.iloc[0] == pd.Timestamp("2024-08-01 00:28", tz="UTC")
    assert ts.iloc[1] == pd.Timestamp("2024-08-01 09:05", tz="UTC")


@pytest.mark.parametrize("date,time", [("2024-13-01", "0905"), ("2024-08-01", "2460"),
                                       ("2024-08-01", "0975"), ("", "0905"),
                                       ("2024-08-01", "ab")])
def test_invalid_timestamps_are_dropped_not_guessed(tmp_path, date, time):
    bad = GOOD_MODIS.replace("2024-08-01,0905", f"{date},{time}")
    df, rep = load_firms_csv(write(tmp_path, "m.csv", MODIS_HEADER, GOOD_MODIS, bad))
    assert len(df) == 1
    assert rep.dropped == {"invalid_acq_datetime": 1}


# ---------------------------------------------------------------- 5. missing data
def test_missing_frp_drops_row_and_strict_raises(tmp_path):
    bad = GOOD_MODIS.replace(",12.3,", ",,")
    p = write(tmp_path, "m.csv", MODIS_HEADER, GOOD_MODIS, bad)
    df, rep = load_firms_csv(p)
    assert len(df) == 1 and rep.dropped == {"frp_missing_or_out_of_range": 1}
    with pytest.raises(ValidationError):
        load_firms_csv(p, strict=True)


def test_out_of_range_coordinates_dropped(tmp_path):
    bad = GOOD_MODIS.replace("32.5,-116.9", "95.0,-116.9")
    df, rep = load_firms_csv(write(tmp_path, "m.csv", MODIS_HEADER, bad))
    assert df.empty and rep.dropped == {"latitude_missing_or_out_of_range": 1}


def test_each_bad_row_counted_once(tmp_path):
    bad = "999,999,1,1,1,nope,99,Z,x,,1,-5,Q"
    _, rep = load_firms_csv(write(tmp_path, "m.csv", MODIS_HEADER, bad))
    assert sum(rep.dropped.values()) == 1


# ---------------------------------------------------------------- confidence
@pytest.mark.parametrize("pct,cls", [(0, "low"), (29, "low"), (30, "nominal"),
                                     (79, "nominal"), (80, "high"), (100, "high")])
def test_modis_confidence_binning(tmp_path, pct, cls):
    row = GOOD_MODIS.replace(",85,", f",{pct},")
    df, _ = load_firms_csv(write(tmp_path, "m.csv", MODIS_HEADER, row))
    assert df.loc[0, "confidence_class"] == cls and df.loc[0, "confidence_pct"] == pct


def test_viirs_confidence_letters_and_words(tmp_path):
    rows = [f"32.5,-116.9,330,0.4,0.4,2024-08-01,2050,N,{c},2.0,290,3.1,N"
            for c in ("l", "n", "h", "nominal", "bogus")]
    df, rep = load_firms_csv(write(tmp_path, "v.csv", VIIRS_HEADER, *rows))
    assert list(df["confidence_class"]) == ["low", "nominal", "high", "nominal"]
    assert rep.dropped == {"invalid_confidence": 1}
    assert set(df["platform"]) == {"Suomi NPP"} and not df["is_nrt"].any()


# ---------------------------------------------------------------- 7. sensor separation
def test_expected_sensor_mismatch_raises():
    with pytest.raises(SchemaError, match="expected MODIS"):
        load_firms_csv(VIIRS_CSV, sensor="MODIS")


def test_viirs_satellite_code_in_modis_file_rejected(tmp_path):
    bad = GOOD_MODIS.replace(",T,", ",N20,")
    _, rep = load_firms_csv(write(tmp_path, "m.csv", MODIS_HEADER, bad))
    assert rep.dropped == {"unknown_satellite_for_sensor": 1}


def test_load_many_refuses_mixed_sensors():
    with pytest.raises(SchemaError, match="mixed sensors"):
        load_many([MODIS_CSV, VIIRS_CSV])


# ---------------------------------------------------------------- archive fields & dups
def test_archive_type_column_and_duplicates(tmp_path):
    hdr = MODIS_HEADER + ",type"
    r0 = GOOD_MODIS.replace("6.1NRT", "6.1") + ",0"
    r_bad = GOOD_MODIS.replace("6.1NRT", "6.1").replace("0905", "1000") + ",7"
    df, rep = load_firms_csv(write(tmp_path, "m.csv", hdr, r0, r0, r_bad))
    assert len(df) == 1 and rep.duplicates_removed == 1
    assert rep.dropped == {"invalid_fire_type": 1}
    assert df.loc[0, "fire_type"] == 0 and not df.loc[0, "is_nrt"]


# ---------------------------------------------------------------- 9. reproducibility
def test_reproducible():
    a, ra = load_firms_csv(VIIRS_CSV)
    b, rb = load_firms_csv(VIIRS_CSV)
    pd.testing.assert_frame_equal(a, b)
    assert ra.to_dict() == rb.to_dict()
