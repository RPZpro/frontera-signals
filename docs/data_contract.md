# Data contract — Fire Seasons pipeline

Owner: Science & Engineering (Toño). Consumer: UI/Integration (Ricardo).
Status: **v1.0**. The frontend exports are implemented; changes need coordination with Ricardo. Input, loader, polygon filtering and the monthly table are implemented and have been
run on real 2020–2025 data (`python -m fire_pipeline.run_monthly`, outputs in `data/processed/`). The frontend
outputs below are a proposal for Ricardo to review before implementation.

## 1. Inputs (NASA FIRMS CSV)

One file = one sensor. The loader identifies the sensor from its columns and
rejects mixed or unknown files.

| Column | MODIS C6.1 | VIIRS 375 m C2 | Notes |
|---|---|---|---|
| latitude, longitude | ✓ | ✓ | WGS84 pixel centre |
| brightness / bright_t31 | ✓ | – | K, MODIS channel 21/22 and 31 |
| bright_ti4 / bright_ti5 | – | ✓ | K, VIIRS I4 and I5 |
| scan, track | ✓ | ✓ | km, pixel size |
| acq_date, acq_time | ✓ | ✓ | **UTC**, `YYYY-MM-DD`, `HHMM` (leading zeros may be lost) |
| satellite | T, A | N (SNPP), N20, N21 | |
| confidence | 0–100 % | l / n / h | **Not comparable across sensors** |
| version | 6.1, 6.1NRT | 2.0, 2.0NRT | `NRT` = near-real-time |
| frp | ✓ | ✓ | MW |
| daynight | D/N | D/N | |
| type *(optional, archive only)* | ✓ | ✓ | 0 vegetation, 1 volcano, 2 static land, 3 offshore |

## 2. Canonical detection table (loader output)

Produced by `fire_pipeline.load_firms_csv`. Full definitions are in
`fire_pipeline/schemas.py::DETECTION_COLUMNS`. Each column is tagged raw or derived.

`sensor, platform, series, collection, product, satellite_code, version, is_nrt, latitude, longitude,
acq_datetime_utc, scan, track, bright_primary_k, bright_secondary_k, frp_mw,
confidence_raw, confidence_pct, confidence_class, daynight, fire_type, source_file`

Validation rules:
- Rows with missing or out-of-range values, bad timestamps, a satellite code that
  belongs to the other sensor, or invalid confidence are **dropped and counted**
  (`ValidationReport.dropped`). They are never imputed. `strict=True` raises instead.
- Exact duplicate records within a file are removed and counted. Duplicates *across*
  sensors are not touched here, because that is a harmonization question.
- Each report stores the SHA-256 of the input file for reproducibility.

## 3. Geographic filtering (implemented)

`fire_pipeline.regions`: a detection belongs to a region when its **pixel centre**
intersects the polygon. Invalid polygons are rejected and never auto-repaired.
Default region: `MX-BCN` (see `data/boundaries/SOURCES.md`).

## 4. Monthly table (implemented, `fire_pipeline.aggregate.monthly_activity`)

One row per region x **series** x UTC month. Series: `MODIS` (Terra+Aqua combined, as in
MCD14ML), `VIIRS_SNPP` and `VIIRS_NOAA20`. Series are never summed: SNPP and NOAA-20 see
the same fires about 50 min apart, so adding them would double count.

By default only FIRMS `type = 0` (presumed vegetation fire) is counted. Static
industrial sources (`type = 2`, for example the Rosarito power plant) and offshore
detections (`type = 3`) are excluded from the monthly table but kept in the detections file.
The counts that were excluded are listed in `run_report.json`.

| Column | Kind | Unit | Meaning |
|---|---|---|---|
| region_id, series, sensor, month | key | | `month` = `YYYY-MM` (UTC) |
| days_in_month, days_covered, coverage_fraction | coverage | days | from **declared** download range |
| quality | status | | `ok` / `partial_coverage` / `no_data` |
| hotspot_count | raw | detections | original count, never scaled |
| frp_sum_mw | raw | MW | sum of FRP |
| active_cells | derived | cells | distinct 10 km EASE-Grid 2.0 (EPSG:6933) cells with >= 1 detection |
| active_cell_days | derived | cell-days | distinct (cell, UTC day) pairs |

- `no_data` means every metric is null. A covered month without detections means 0.
- Partial months are flagged and **not** extrapolated.
- `active_cells` reduces the pixel-size effect (VIIRS 375 m vs MODIS 1 km). It does
  not make the sensors equivalent.

## 5. Seasonal percentiles and agreement (implemented, `run_seasonal`)

`data/processed/seasonal_<tag>.csv`: long format, one row per region x series x month x metric.

| Column | Kind | Meaning |
|---|---|---|
| region_id, series, sensor, month, cal_month, metric | key | `metric` ∈ active_cells, active_cell_days, hotspot_count, frp_sum_mw |
| value | raw/derived | the monthly value (same kind as the metric) |
| ref_period, n_ref | derived | reference years and number of other years compared (leave-one-out) |
| ref_median, ref_min, ref_max | derived | other years, same calendar month, same series |
| percentile | derived | mid-rank empirical percentile, 0–100, sensor-specific |
| activity_class | derived | `above_range` / `within_range` / `below_range` / `not_evaluated` / `insufficient_reference` |

`data/processed/agreement_<tag>.json`: one entry per region x metric x pair of series,
with correlations, percentile differences, kappa, ratio, and an `assessment` that includes
notes for the UI. Method and results are in `docs/methodology.md`.

## 6. Weather context (implemented, `run_weather`)

`data/processed/weather_<tag>.csv`: one row per region x month x variable, 1991–2025.

| Column | Kind | Meaning |
|---|---|---|
| region_id, month, cal_month, variable | key | variable ∈ T2M, RH2M, PRECTOTCORR, WS10M |
| unit | | °C, %, mm/day, m/s (as returned by POWER) |
| value | derived | area-weighted mean of MERRA-2 native cells |
| normal_period, normal_mean | derived | 1991–2020 calendar-month mean |
| anomaly, anomaly_pct | derived | value − normal; percentile within the normal years |
| n_cells, valid_weight_fraction | coverage | |
| quality | status | `ok` / `partial_coverage` / `no_data` / `qc_excluded` |
| source | | NASA POWER API version + MERRA-2 |

`data/processed/weather_report.json`: cell weights, QC exclusions, and the exploratory
association between fire and weather (descriptive only).

## 7. Frontend outputs v1 (implemented, `python -m fire_pipeline.export`)

Folder: **`data/export/`**. JSON Schemas (draft 2020-12): **`docs/schemas/`**.
Rules: unavailable means `null` (never 0 or NaN). Every measurement carries
region, series/sensor, period, source, product version, unit, quality and `kind` (`raw` | `derived`).

| File | Size | Contents |
|---|---|---|
| `metadata.json` | 20 KB | provenance (inputs + SHA-256, git commit), region, series, methods, metric dictionary (EN/ES labels), activity class labels (EN/ES), **limitations (EN/ES)**, hotspot property legend, list of files |
| `monthly.json` | 450 KB | `records[]`: region x series x month, with 4 metrics, each `{value, unit, kind, seasonal: {percentile, activity_class, ref_median, ref_min, ref_max, n_ref, ref_period}}` |
| `agreement.json` | 20 KB | `pairs[]`: sensor comparison per metric and pair of series, with `assessment.notes` ready to show |
| `weather.json` | 170 KB | `records[]`: region x month x variable (2020–2025), value, normal 1991–2020, anomaly, anomaly_pct, quality |
| `hotspots_<YEAR>.geojson` | 1.4–3.2 MB each | original detections, one file per year (load on demand). Short property keys are explained in `properties_legend` |
| `methodology.md` | 10 KB | methods, results and limitations |

UI suggestions:
- Use `active_cells` and its `seasonal.percentile` to compare sensors. Show `hotspot_count` as
  the original observation, but never put MODIS and VIIRS counts on the same axis as if equivalent.
- `activity_class = above_range` means "highest of the 6-year record for this month", so use the
  label in `metadata.activity_classes`. Do not call it "anomalous" or "extreme".
- Show the `metadata.limitations` texts near the charts.
- Draw `quality != "ok"` and `value == null` as gaps, not zeros.
- In maps, `counted == false` marks static and offshore sources. Grey them out or hide them.

## 8. Scientific limitations (must be shown in the UI)

- Raw MODIS and VIIRS counts are not directly comparable, because resolution,
  sensitivity, overpass time and confidence definitions all differ.
- A hotspot is a hot pixel. It is not an independent fire.
- A thermal anomaly does not indicate cause or intent. No detection does not mean no fire.
