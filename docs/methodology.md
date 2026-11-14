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
| Weather: T2M, RH2M, PRECTOTCORR, WS10M | NASA POWER monthly, MERRA-2 native 0.5° × 0.625° | API v2.10.0, 1991–2025 | power.larc.nasa.gov |

URLs and SHA-256 hashes: `data/raw/SOURCES.md` and `data/boundaries/SOURCES.md`.
All inputs are standard-processing (not NRT) files.

## 2. Processing

Reproduce everything with:

```
python -m fire_pipeline.run_monthly     # stages 1–2
python -m fire_pipeline.run_seasonal    # stages 3–5
python -m fire_pipeline.run_weather     # environmental context (add --offline to use cached JSON)
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

8. **Environmental context** (`weather.py`). NASA POWER monthly values on the
   MERRA-2 native grid. The regional value is the **area-weighted mean** of the 46 native
   cells that intersect Baja California (weights = intersection area in EPSG:6933). Nothing
   is interpolated or downscaled. Anomalies are computed per calendar month against the
   **1991–2020 normal** (WMO standard): `anomaly = value − normal mean`, plus a mid-rank
   percentile within the 30 normal years. Each calendar month needs at least 80 % of the
   normal years to be valid.
   - **QC:** if any native cell has a monthly mean above 30 mm/day of PRECTOTCORR, the whole
     variable-month is set to null (`qc_excluded`). This removes a source artifact,
     **PRECTOTCORR 2020-06**, which has 2,110 mm on 2020-06-10 at −115.0/28.5 according to
     the POWER daily API. That is physically impossible, and it gives monthly means up to
     151 mm/day, while every other cell-month in 1991–2025 is ≤ 11.8 mm/day (Jan 1993).
     No replacement value is created.

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

### Environmental context (exploratory, not causal)

Same-month Spearman between a month's fire percentile (`active_cells`) and its weather
anomaly percentile (vs 1991–2020), 2020–2025:

| Variable | MODIS | VIIRS NOAA-20 | VIIRS SNPP |
|---|---|---|---|
| RH2M (humidity) | −0.49 | −0.56 | −0.60 |
| PRECTOTCORR (precipitation) | −0.41 | −0.45 | −0.45 |
| WS10M (wind) | +0.27 | +0.21 | +0.12 |
| T2M (temperature) | +0.09 | +0.24 | +0.27 |

Months that are more active than usual for their season tend to be drier than normal.
All three sensors show the same pattern. In 5 of the 6 months that were records in all
three series, RH2M was at or below the 27th percentile of its normal (for example 2022-02
and 2021-04 at 6.7 %). This is an association. It does not establish causation, and no
significance is claimed.

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
- **Weather is a regional mean** over about 73,000 km² that includes coast, mountains and
  desert, using roughly 55 km reanalysis cells. It describes regional conditions, not the
  weather at each fire. MERRA-2 is a reanalysis, not station observations.
- POWER months are in local solar time and FIRMS months are in UTC. The difference
  (~8 h) is negligible at monthly scale.
