"""Tests for seasonal percentiles (Stage 3) and sensor agreement (Stages 4-5)."""

import numpy as np
import pandas as pd
import pytest

from fire_pipeline.agreement import sensor_agreement
from fire_pipeline.percentiles import seasonal_percentiles


def monthly(values_by_series, cal="08", quality=None, region="R1"):
    """Build a monthly table: {series: [v_2020, v_2021, ...]} for one calendar month."""
    rows = []
    for s, vals in values_by_series.items():
        for i, v in enumerate(vals):
            y = 2020 + i
            q = (quality or {}).get((s, y), "ok")
            rows.append({"region_id": region, "series": s, "sensor": s.split("_")[0],
                         "month": f"{y}-{cal}", "quality": q,
                         "active_cells": None if q == "no_data" else v})
    return pd.DataFrame(rows)


def by_year(df, series="MODIS"):
    d = df[df.series == series]
    return d.set_index(d.month.str[:4].astype(int))


# ---------------------------------------------------------------- 6. percentiles
def test_leave_one_out_mid_rank():
    s = by_year(seasonal_percentiles(monthly({"MODIS": [10, 20, 30, 40, 50, 60]})))
    # 60 vs others [10..50]: 5 below -> 100 %, and it is a record month
    assert s.loc[2025, "percentile"] == 100.0 and s.loc[2025, "activity_class"] == "above_range"
    assert s.loc[2025, "n_ref"] == 5 and s.loc[2025, "ref_max"] == 50
    assert s.loc[2020, "percentile"] == 0.0 and s.loc[2020, "activity_class"] == "below_range"
    # 30 vs [10,20,40,50,60]: 2 below -> 40 %
    assert s.loc[2022, "percentile"] == 40.0 and s.loc[2022, "activity_class"] == "within_range"
    assert s.loc[2022, "ref_median"] == 40


def test_ties_use_mid_rank():
    s = by_year(seasonal_percentiles(monthly({"MODIS": [0, 0, 0, 0, 0, 5]})))
    assert s.loc[2020, "percentile"] == pytest.approx(100 * (0 + 0.5 * 4) / 5)  # 40
    assert s.loc[2020, "activity_class"] == "within_range"


def test_series_are_ranked_separately():
    df = seasonal_percentiles(monthly({"MODIS": [1, 2, 3, 4, 5, 6],
                                       "VIIRS_SNPP": [600, 500, 400, 300, 200, 100]}))
    assert by_year(df, "MODIS").loc[2025, "percentile"] == 100.0
    assert by_year(df, "VIIRS_SNPP").loc[2025, "percentile"] == 0.0


def test_calendar_months_are_ranked_separately():
    df = pd.concat([monthly({"MODIS": [1, 1, 1, 1, 1, 1]}, cal="02"),
                    monthly({"MODIS": [100, 100, 100, 100, 100, 100]}, cal="08")])
    s = seasonal_percentiles(df)
    assert (s["percentile"] == 50.0).all()  # each month only vs itself in other years


def test_partial_and_missing_months_not_evaluated_nor_used():
    q = {("MODIS", 2021): "partial_coverage", ("MODIS", 2022): "no_data"}
    s = by_year(seasonal_percentiles(monthly({"MODIS": [10, 999, None, 40, 50, 60]}, quality=q)))
    assert s.loc[2021, "activity_class"] == "not_evaluated" and np.isnan(s.loc[2021, "percentile"])
    assert s.loc[2022, "activity_class"] == "not_evaluated"
    assert s.loc[2025, "n_ref"] == 3 and s.loc[2025, "ref_max"] == 50  # 999 not in reference


def test_insufficient_reference():
    s = by_year(seasonal_percentiles(monthly({"MODIS": [1, 2, 3]})))
    assert (s["activity_class"] == "insufficient_reference").all()
    assert s["percentile"].isna().all()


def test_ref_years_restrict_reference_but_evaluate_all():
    s = by_year(seasonal_percentiles(monthly({"MODIS": [10, 20, 30, 40, 50, 60]}),
                                     ref_years=(2020, 2023)))
    assert s.loc[2025, "n_ref"] == 4 and s.loc[2025, "ref_period"] == "2020-2023"
    assert s.loc[2021, "n_ref"] == 3  # leave-one-out inside the reference


def test_unknown_metric_raises():
    with pytest.raises(KeyError):
        seasonal_percentiles(monthly({"MODIS": [1, 2, 3, 4]}), metric="nope")


def test_reproducible():
    m = monthly({"MODIS": [3, 1, 4, 1, 5, 9], "VIIRS_SNPP": [2, 6, 5, 3, 5, 8]})
    pd.testing.assert_frame_equal(seasonal_percentiles(m), seasonal_percentiles(m))


# ---------------------------------------------------------------- agreement
def many_months(a_vals, b_vals):
    """24+ months: different calendar months, 6 years each."""
    frames = []
    for k, cal in enumerate(["06", "07", "08", "09"]):
        frames.append(monthly({"MODIS": [v + k for v in a_vals],
                               "VIIRS_SNPP": [v + k for v in b_vals]}, cal=cal))
    return seasonal_percentiles(pd.concat(frames, ignore_index=True))


def test_perfect_agreement():
    s = many_months([1, 2, 3, 4, 5, 6], [10, 20, 30, 40, 50, 60])
    (r,) = sensor_agreement(s)
    assert r["n_months"] == 24 and r["spearman_percentile"] == 1.0
    assert r["mean_abs_percentile_diff"] == 0.0
    assert r["above_range"]["both"] == 4 and r["above_range"]["kappa"] == 1.0
    assert r["assessment"]["percentile_agreement"] == "strong"
    assert r["assessment"]["event_agreement"] is True


def test_opposite_anomalies_are_weak():
    s = many_months([1, 2, 3, 4, 5, 6], [60, 50, 40, 30, 20, 10])
    (r,) = sensor_agreement(s)
    assert r["spearman_percentile"] == -1.0
    assert r["assessment"]["percentile_agreement"] == "weak"
    assert r["above_range"]["both"] == 0 and r["assessment"]["event_agreement"] is False


def test_too_few_months_flagged():
    s = seasonal_percentiles(monthly({"MODIS": [1, 2, 3, 4, 5, 6],
                                      "VIIRS_SNPP": [1, 2, 3, 4, 5, 6]}))
    (r,) = sensor_agreement(s)
    assert r["n_months"] == 6 and r["assessment"]["percentile_agreement"] == "insufficient_data"


def test_raw_counts_never_declared_comparable():
    (r,) = sensor_agreement(many_months([1, 2, 3, 4, 5, 6], [1, 2, 3, 4, 5, 6]))
    assert any("not comparable" in n for n in r["assessment"]["notes"])
