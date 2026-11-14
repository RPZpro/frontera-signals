# Test fixture provenance

Rows are copied **unmodified** (header + matching lines) from public NASA FIRMS
near-real-time files. Only a bounding-box subset was taken; no values edited.

| Fixture | Source URL | Downloaded (UTC) | Subset | Rows | SHA-256 |
|---|---|---|---|---|---|
| `modis_c61_nrt_baja_sample.csv` | https://firms.modaps.eosdis.nasa.gov/data/active_fire/modis-c6.1/csv/MODIS_C6_1_Global_7d.csv | 2026-11-14 | lat 28–34, lon −118 to −112 | 22 | `35662703b66450a20f2761343c8688f81e155012585c111caaa99b1dcceac6ee` |
| `viirs_n20_c2_nrt_baja_sample.csv` | https://firms.modaps.eosdis.nasa.gov/data/active_fire/noaa-20-viirs-c2/csv/J1_VIIRS_C2_Global_7d.csv | 2026-11-14 | lat 28–34, lon −118 to −112 | 122 | `03688bc6b1e365216b1383e37739804b6e8209382b82c6306558106a0ff13546` |

Coverage: acquisitions 2026-11-07 to 2026-11-13 (UTC), versions `6.1NRT` / `2.0NRT`.

## Why NOAA-20 and not Suomi NPP?

On 2026-11-14 the Suomi NPP VIIRS C2 NRT files (`SUOMI_VIIRS_C2_Global_{24h,48h,7d}.csv`)
contained only a header, with no detections. NOAA-20 VIIRS uses the identical 375 m
product schema, so it is used here **only to test the loader**. The scientific
analysis must use Suomi NPP (`satellite = N`) standard-processing archive data,
which requires a FIRMS MAP_KEY (https://firms.modaps.eosdis.nasa.gov/api/map_key/)
or the FIRMS Archive Download tool.

The bbox is a rough box, not the official boundary polygon. Polygon filtering is a
separate pipeline stage.
