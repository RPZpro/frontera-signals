# Methodology — Fire Seasons: Historical Thermal Anomalies

Team Frontera Signal (Tijuana, MX). NASA Space Apps Challenge 2026,
"Harmonization of MODIS and VIIRS Hot Spots".
Region: Baja California, Mexico (`MX-BCN`). Period: 2020-01 to 2025-12 (UTC).

## 1. Data

| Input | Product | Version / collection | Source |
|---|---|---|---|
| MODIS Terra + Aqua active fire, 1 km | MOD14 / MYD14 via FIRMS | 2020–2022: C6.0 (`6.03`); 2023–2025: C6.1 (`61.03`) | FIRMS yearly country files |
| VIIRS Suomi NPP active fire, 375 m | VNP14IMG via FIRMS | C2 (`2`) | FIRMS yearly country files |
| VIIRS NOAA-20 active fire, 375 m | VJ114IMG via FIRMS | C2 (`2`) | FIRMS yearly country files |
| Baja California boundary | geoBoundaries ADM1 (source INEGI 2020) | gbOpen 90a1d52 | geoBoundaries |

URLs and SHA-256 hashes: `data/raw/SOURCES.md` and `data/boundaries/SOURCES.md`.
All inputs are standard-processing (not NRT) files.

## 2. Processing

Reproduce everything with:

```
python -m fire_pipeline.run_monthly     # stages 1–2
python -m fire_pipeline.run_seasonal    # stages 3–5
```

1. **Ingest and validate** (`loader.py`). Schema check, physical bounds,
   UTC timestamps from `acq_date` + `acq_time`, and satellite code checked
   against the sensor. Product collection is derived from `version`. Invalid rows
   are dropped and counted, never imputed. Result for 2020–2025: 4,000,033 rows read,
   **0 dropped**.
2. **Geographic filter** (`regions.py`). A pixel centre must intersect the
   official polygon. 48,529 detections fall in Baja California.
3. **Fire type.** Monthly metrics count only FIRMS `type = 0` (presumed vegetation fire).
   Static land sources (`type = 2`, 2,725 detections, for example the Rosarito power plant)
   and offshore detections (`type = 3`, 216) are excluded from the monthly metrics and kept
   in the detection file.
4. **Series.** `MODIS` (Terra + Aqua combined), `VIIRS_SNPP`, `VIIRS_NOAA20`.
   Series are never summed, because two VIIRS satellites see the same fire.
5. **Monthly aggregation and common grid** (`aggregate.py`, `grid.py`). Calendar
   month in UTC, per region and series:
   - `hotspot_count` (raw) and `frp_sum_mw` (raw sum)
   - `active_cells`: distinct cells of a 10 km EASE-Grid 2.0 (EPSG:6933, equal-area)
     grid with at least one detection. This reduces the pixel-size effect.
   - `active_cell_days`: distinct (cell, day) pairs.
   - Coverage is declared from the file years. A covered month with no
     detections is 0. An uncovered month is null (`no_data`).
6. **Seasonal percentiles** (`percentiles.py`). Each month is ranked against the
   same calendar month in the other years of the same series (**leave-one-out**,
   reference 2020–2025, so n_ref = 5). Mid-rank empirical percentile.
   `activity_class`: `above_range` (higher than every other year for that month),
   `below_range`, or `within_range`.
7. **Agreement** (`agreement.py`). For each pair of series: Spearman correlation of
   raw values and of percentiles, mean absolute percentile difference, Cohen's kappa
   on `above_range` flags, and the ratio between series. Stage 5 rules are written in
   the code (`ASSESSMENT_RULES`).

## 3. Results (2020–2025, 72 months)

Seasonal cycle: the main activity is in **June–October** for all three series
(mean active cells per month: MODIS ~25–32, VIIRS ~59–69), with a minimum in March.

Agreement for `active_cells` (10 km grid):

| Pair | ρ raw | ρ percentile | mean abs. percentile diff. | κ above_range | median ratio |
|---|---|---|---|---|---|
| MODIS vs VIIRS NOAA-20 | 0.93 | 0.80 | 13.3 | 0.85 | 2.9 |
| MODIS vs VIIRS SNPP | 0.89 | 0.73 | 17.8 | 0.40 | 2.8 |
| VIIRS NOAA-20 vs SNPP | 0.96 | 0.87 | 10.8 | 0.53 | 1.0 |

Interpretation:
- The **relative** activity of each month (its percentile within its own series)
  agrees strongly between sensors. The question "was this month unusually active for
  its season?" gives consistent answers with MODIS or VIIRS.
- **Raw values do not agree.** VIIRS has about 2.8× as many active 10 km cells as MODIS
  and about 4.3× as many hotspots, and the ratio varies a lot from month to month
  (IQR ≈ 1.5). No fixed conversion factor between the sensors is supported.
- Agreement on record months is good between MODIS and NOAA-20 (κ 0.85) but only
  moderate with SNPP (κ 0.40). A record month should therefore be reported for each
  sensor, together with whether the sensors agree, rather than as a single verdict.
- Months that were records in all three series: 2020-06, 2021-04, 2022-02,
  2023-11, 2024-08, 2025-01.

## 4. Limitations

- **Short record.** 6 years means each month is compared against only 5 others. By
  construction, about 1 month in 6 is `above_range`. That marks the highest year in this
  record, not a rare event. Percentiles have coarse steps (0, 10, 20, … 100).
- **MODIS collection change in 2023** (C6.0 to C6.1). Year-to-year MODIS−VIIRS
  percentile differences (±8 points) are about as large as those between the two
  identical VIIRS instruments (±9), so no clear break is visible. The median
  VIIRS/MODIS cell ratio drops slightly (SNPP 3.07 to 2.67, NOAA-20 2.95 to 2.78).
- **Correlations are inflated by autocorrelation and the shared seasonal cycle**,
  which is why no p-values are given. ρ_percentile removes the seasonal cycle but not
  the persistence between consecutive months.
- **UTC months.** Baja California is UTC−8/−7, so late-evening detections on the last
  day of a month count in the next month.
- **Pixel centre.** Pixels on the border are assigned by their centre only.
- **What a hotspot is.** A hotspot is a hot pixel at the moment of overpass. It is not a
  fire and not an independent event. Clouds, overpass timing and small or short fires
  mean that no detection does not prove there was no fire. A thermal anomaly says nothing
  about cause, intent or criminal activity.
- The `type` classification comes from FIRMS. It is not re-derived or validated here.
