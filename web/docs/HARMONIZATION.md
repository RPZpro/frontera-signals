# Harmonized view — method note for review

**Status: exploratory. Not validated.** This is a frontend-side derived layer. It does not change
any pipeline formula, schema or export. It needs review by the science lead before the site can
call it a validated harmonization. Until then the site labels it "Exploratory, not yet validated"
(`HARMONIZATION_VALIDATED = false` in `src/lib/harmonize.ts`).

Version `0.1-exploratory`. Code: `src/lib/harmonize.ts`. Tests: `tests/harmonize.test.mjs`.

## What it is

MODIS and VIIRS are treated as two measuring instruments that observe the same monthly fire
activity with different sensitivity. Each instrument is put on a common, unitless scale and the
two readings are averaged into one **harmonized activity index**. The view also shows where the
two instruments disagree.

## What it is not

- It is not a conversion between sensors. The pipeline found that the VIIRS/MODIS ratio varies a
  lot from month to month and recommends no fixed factor. None is used.
- It does not merge detections. Raw MODIS and VIIRS detections stay separate in every other tab,
  and in the export the raw active cells stay in their own columns.
- It has no unit. It cannot be converted to detections, burned area or a number of fires.
- It says nothing about cause, intent or criminal activity.

## Inputs

For one region and the metric `active_cells` (10 km equal-area cells with at least one detection;
chosen because the pipeline built it to reduce the pixel-size effect). Per series (`MODIS`,
`VIIRS_SNPP`, `VIIRS_NOAA20`) and month:

- `active_cells` value, used only when `quality = ok` and the value is not null.
- The pipeline's seasonal `percentile` and `activity_class`, shown and averaged but not recomputed.

`partial_coverage` and `no_data` months are excluded from calibration and from the index. A missing
month stays missing: no zero, no interpolation, no one-sided index.

## Method

1. **Variance-stabilise.** `u = ln(1 + active_cells)`.
2. **Calibration window.** The months in which every sensor is usable. At least
   `MIN_CALIBRATION_MONTHS = 24` are required (same minimum the pipeline uses before assessing
   agreement).
3. **Calibrate each series.** `score = (u − mean) / sd`, with the mean and the sample standard
   deviation taken over the calibration window. A score of 0 is that sensor's typical month and one
   point is one standard deviation of its own log-scale record.
4. **Pool each family.** `VIIRS = mean(score_SNPP, score_NOAA20)` over the satellites that are usable
   that month. The pipeline notes that the two VIIRS satellites see the same fires and must not be
   summed, so they count once. MODIS is already Terra + Aqua in the pipeline series.
5. **Combine.** `index = (MODIS + VIIRS) / 2`, equal weights, only when both families are usable.
6. **Sensitivity to the weighting.** The band is `[min(MODIS, VIIRS), max(MODIS, VIIRS)]`. Any
   other weighting between MODIS-only and VIIRS-only lands inside it, so it is the full range of
   the weighting choice.
7. **Disagreement.** Bland–Altman on `d = VIIRS − MODIS`: limits `mean(d) ± 1.96 · sd(d)`. A month
   outside the limits is flagged. The mean difference is zero by construction, because both scores
   are centred on the same window; the informative quantity is the width of the limits.
8. **Seasonal summary.** The family means of the pipeline's seasonal percentiles are averaged
   (`consensusPercentile`). It is descriptive. The pipeline's own caution applies: percentiles
   have coarse steps because n_ref = 5.

Agreement statistics reported: Pearson `r` of the two family scores, and `r` after subtracting each
calendar month's mean ("without the seasonal cycle"). The second is the more honest figure, since
both sensors share the fire season; it plays the same role as the pipeline's percentile Spearman.

## Results on the 2020–2025 Baja California export

Calibration window: 72 months (all complete).

| Series | Typical month (score 0) | One point up |
|---|---|---|
| MODIS | 15 active cells | ×2.05 cells |
| VIIRS Suomi NPP | 45 active cells | ×1.55 cells |
| VIIRS NOAA-20 | 46 active cells | ×1.55 cells |

| Statistic | Value |
|---|---|
| r, MODIS vs VIIRS score | 0.915 |
| r without the seasonal cycle | 0.831 |
| sd of the gap `VIIRS − MODIS` | 0.411 |
| limits of agreement | ±0.805 |
| months outside the limits | 3 of 72 (2020-01, 2022-04, 2022-10) |
| correlation of the gap with the index level | −0.03 |
| sd of the index | 0.973 |

The gap does not depend on the activity level, which supports the logarithm. The months that are
the highest of the record for their calendar month in all three series are 2020-06, 2021-04,
2022-02, 2023-11, 2024-08 and 2025-01, identical to `data/export/methodology.md`.

## Cross-check

`tests/harmonize.test.mjs` compares the TypeScript results with the values above, which were
produced by a separate Python implementation, `tests/reference_harmonize.py` (standard library only),
from `data/export/monthly.json`. Run `python web/tests/reference_harmonize.py` to print them, and
`npm test` from `web/` to compare. The same tests check that missing and
partial months stay missing, that a duplicated VIIRS satellite does not change the index, and that
calibration is refused with fewer than 24 common months or without both families.

## Known limitations

- Calibration uses the same months it describes. There is no held-out test. A longer record
  would allow one.
- Equal weights are a choice. The data cannot say how much better one instrument is without an
  independent reference.
- Six years only. Seasonal means used for the "without the seasonal cycle" correlation come from
  six values per calendar month.
- MODIS changes from C6.0 to C6.1 in 2023. The pipeline sees no clear break, and this method does
  not model one.
- Months are UTC, as in the pipeline.
- A hot pixel is not an independent fire. No detection does not prove there was no fire.

## Questions for the science lead

1. Is `ln(1 + active_cells)` followed by a per-sensor z-score an acceptable common scale, or should
   it be rank-based (for example the pipeline's own percentiles) only?
2. Are equal family weights acceptable as a default, with the band as the sensitivity range?
3. Is averaging the Suomi NPP and NOAA-20 scores the right way to count VIIRS once?
4. Should the calibration window exclude or split the 2023 MODIS collection change?
5. Should this move into the Python pipeline as a derived export (`harmonized.json`) so the site
   only displays it? The TypeScript is a reference implementation and the tests give the numbers
   to match.
6. Are the Bland–Altman limits (±1.96 sd) the right rule for flagging disagreement?

When these are answered, set `HARMONIZATION_VALIDATED = true` only if the method is approved
as is, or change the method and the version first.
