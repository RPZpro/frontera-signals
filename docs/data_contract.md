# Data contract — Fire Seasons pipeline

Owner: Science & Engineering (Toño). Consumer: UI/Integration (Ricardo).
Status: **v0.1 draft**. Input and loader output are implemented. The frontend
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

`sensor, platform, satellite_code, product, version, is_nrt, latitude, longitude,
acq_datetime_utc, scan, track, bright_primary_k, bright_secondary_k, frp_mw,
confidence_raw, confidence_pct, confidence_class, daynight, fire_type, source_file`

Validation rules:
- Rows with missing or out-of-range values, bad timestamps, a satellite code that
  belongs to the other sensor, or invalid confidence are **dropped and counted**
  (`ValidationReport.dropped`). They are never imputed. `strict=True` raises instead.
- Exact duplicate records within a file are removed and counted. Duplicates *across*
  sensors are not touched here, because that is a harmonization question.
- Each report stores the SHA-256 of the input file for reproducibility.

## 3. Frontend outputs (proposal, not yet implemented)

Common fields on every measurement:
`region_id, sensor, period, source, product_version, unit, quality, metric_kind`
with `metric_kind ∈ {"raw","derived"}` and `quality ∈ {"ok","partial_coverage","no_data"}`.
Unavailable values are `null`, never 0.

- **metadata.json**: pipeline version, run timestamp, input files with SHA-256,
  date ranges per sensor, grid definition, reference periods, and limitations text.
- **monthly.json**: one record per region × sensor × month. Holds `hotspot_count`
  (raw), `active_cells` (derived, common grid), `percentile_vs_reference`
  (derived, sensor-specific), and `frp_sum_mw` (raw sum).
- **hotspots.geojson**: Point features carrying the canonical detection columns
  (subset), one FeatureCollection per sensor or a `sensor` property.
- **weather.json**: region × month NASA POWER T2M (°C), RH2M (%),
  PRECTOTCORR (mm/day), WS10M (m/s), with POWER grid resolution noted.
- **methodology.md**: human-readable methods and limitations.

## 4. Scientific limitations (must be shown in the UI)

- Raw MODIS and VIIRS counts are not directly comparable, because resolution,
  sensitivity, overpass time and confidence definitions all differ.
- A hotspot is a hot pixel. It is not an independent fire.
- A thermal anomaly does not indicate cause or intent. No detection does not mean no fire.
