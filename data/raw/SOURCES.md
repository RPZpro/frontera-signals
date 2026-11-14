# Raw input provenance: NASA FIRMS yearly country summaries (Mexico)

Source page: https://firms.modaps.eosdis.nasa.gov/country/ ("Yearly summary by country").
These are standard-processing (not NRT) files: full calendar year in UTC, with
`type` and `instrument` columns. Public, no MAP_KEY needed. They are **not committed**
(about 300 MB). To reproduce, download each URL into `data/raw/firms/<modis|viirs>/`,
check the SHA-256, then run `python -m fire_pipeline.run_monthly`.

URL pattern: `https://firms.modaps.eosdis.nasa.gov/data/country/<product>/<YEAR>/<product>_<YEAR>_Mexico.csv`
with `<product>` = `modis`, `viirs-snpp` or `viirs-jpss1` (NOAA-20).

Obtained 2026-11-14 (the team downloaded the MODIS and NOAA-20 files; Suomi NPP was downloaded by the pipeline maintainer).

## Known caveats
- **MODIS collection changes mid-series.** 2020–2022 carry `version = 6.03` (Collection 6.0),
  while 2023–2025 carry `61.03` (Collection 6.1). FIRMS publishes them this way. The pipeline records
  `collection` per row. C6.1 mainly changed calibration and static-source handling, so treat
  MODIS 2022→2023 differences with care.
- `viirs-jpss1` = NOAA-20 (`satellite = N20`). Suomi NPP is `viirs-snpp` (`satellite = N`).
- Files cover all of Mexico. The pipeline clips them to the Baja California polygon.

| File | Rows | Version | SHA-256 |
|---|---|---|---|
| `firms/modis/modis_2020_Mexico.csv` | 68384 | 6.03 | `5ea774f15fa638ea342af4f503758237369e9dde96aa1edcde8268ce07f8d027` |
| `firms/modis/modis_2021_Mexico.csv` | 67268 | 6.03 | `258fee4f348d8c4a9223f4a83ce2adc39c7e18fc373cf740fe289e2a9a1d8ed2` |
| `firms/modis/modis_2022_Mexico.csv` | 61585 | 6.03 | `83e785a14b12957b5d25fdc3fadb1e2a58ce11b953fdcbf0b4bf48ec89f9d297` |
| `firms/modis/modis_2023_Mexico.csv` | 74676 | 61.03 | `84bef2841f2ffdcb1145acc0ed24b9c85fd0c5b470a5595ca5e92e7f0254112a` |
| `firms/modis/modis_2024_Mexico.csv` | 80390 | 61.03 | `706b4a586c991cd11ac2d54766ab82c7fff21a5634b80974247579ba38a14aa9` |
| `firms/modis/modis_2025_Mexico.csv` | 64966 | 61.03 | `7b51d687d999f347dc3679385d98795380cb42311936da6541e4c71a8007fd18` |
| `firms/viirs/viirs-jpss1_2020_Mexico.csv` | 286798 | 2 | `2b3ec8e8f745e8fb09a19f75d4e465b2c9ceaa3ef16758a0c2af00f65e08ae60` |
| `firms/viirs/viirs-jpss1_2021_Mexico.csv` | 286179 | 2 | `b9072b8a8f712d9ab5010f2696616c629ce82040540d2c49371f88c25c286067` |
| `firms/viirs/viirs-jpss1_2022_Mexico.csv` | 275236 | 2 | `c8a95e2a52bb57982f8350c70799a0e873392eeb969b9bc7f37b4e8164560714` |
| `firms/viirs/viirs-jpss1_2023_Mexico.csv` | 320740 | 2 | `2c976d2448113cc0fe1fe88f5d8181b3f29424c8b263238b1aee353bfa655c66` |
| `firms/viirs/viirs-jpss1_2024_Mexico.csv` | 347959 | 2 | `05d06d10b4245a5425e625ecacbc5212d4c233ed97120faf8ce57238664fce06` |
| `firms/viirs/viirs-jpss1_2025_Mexico.csv` | 272810 | 2 | `258c2f38c617acf4f0627fa3de6e1029922640d1ed22418b3546cd5d39985e10` |
| `firms/viirs/viirs-snpp_2020_Mexico.csv` | 290836 | 2 | `2536b0bc3c525d76559707cba4a089eb4b81cbb0ef7a8a45fb17dedc49c226f4` |
| `firms/viirs/viirs-snpp_2021_Mexico.csv` | 292023 | 2 | `4434553cb4ca687d1752baf519072d50b74fcfcc92c466eabed9a7c90046dc4e` |
| `firms/viirs/viirs-snpp_2022_Mexico.csv` | 275471 | 2 | `876de3ba08e0cdbe5085e2cb49e40ca92df7ea5b7e4b2b3e7479656569e7ee18` |
| `firms/viirs/viirs-snpp_2023_Mexico.csv` | 327657 | 2 | `790e6176f578f4b47741905d9c598a63cfd935c0fe879fff6cecca3adc3126a6` |
| `firms/viirs/viirs-snpp_2024_Mexico.csv` | 330134 | 2 | `d6b2089e4f32509e4ecd8243f9296ec0138e00b22691599534d11bc58ab52bfd` |
| `firms/viirs/viirs-snpp_2025_Mexico.csv` | 276921 | 2 | `794e5b4d51e1a1c716b562797faeb2dd530f32aa71a92a5e77a296a7f6bac3d1` |
