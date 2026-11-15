# Frontend architecture

Fire Seasons reads the science pipeline's v1 export. The data contract and JSON
Schemas live in `docs/data_contract.md` and `docs/schemas/` at the repository root.

The npm dev and build hooks stage the committed export and Baja California
boundary into `web/public/data/firms/`. Monthly values, provenance, weather and
agreement load separately from the yearly GeoJSON files. The cover requests the
peak year for its displayed series, and the map and evidence tab request the
selected year. Requests for the same file are shared.

`src/lib/science.ts` adapts the export to the existing dashboard. It keeps MODIS
Terra+Aqua, VIIRS Suomi NPP and VIIRS NOAA-20 distinct. Map and hot-pixel CSV
use the same points marked `counted` by the pipeline. The dashboard uses the
exported seasonal active-cell percentiles and activity labels. Missing values
and weather excluded by quality control stay unavailable. Weather uses area-weighted
NASA POWER reanalysis, and the comparison tab shows the pipeline's descriptive
agreement over the full study period.

The region, satellite series, year, month and tab share a selection provider.
The selection is encoded as `?region=...&sensor=...&period=YYYY-MM&tab=...`.
Older `sensor=VIIRS` links resolve to Suomi NPP in the FIRMS dataset.

Both maps use the local region outline and hotspot points over CARTO tiles.
The local layers keep their geographic context when tile requests fail.
The evidence tab exports selected-month metrics and matching point CSVs, and a
printable HTML report with the selection, environmental data, provenance and limitations.

The synthetic fixtures are available by setting `NEXT_PUBLIC_DATA_BASE=/data/demo`.
The banner, point popups and exports identify that mode as synthetic.
