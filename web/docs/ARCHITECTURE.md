# Frontend architecture

Owner: Ricardo (UI/UX & Integration). Data contract owner: Toño (`/docs/data_contract.md`, v0.1 draft).

## Where things live

The repository root is Toño's Django project and science pipeline. The frontend is
self-contained in `web/` and touches nothing outside it.

```
web/
  public/data/demo/        synthetic fixtures (metadata.json, monthly.json, hotspots.geojson)
  scripts/
    generate-demo-fixtures.mjs   deterministic fixture generator (seeded)
    copy-maplibre-worker.mjs     copies MapLibre's worker into public/ before dev/build
  src/
    app/                   layout, page, global styles and design tokens
    lib/
      contract.ts          TypeScript mirror of the data contract outputs
      data.ts              loading, indexing, colour-step helpers
      selection.tsx        shared state: region, sensor, year, month (synced to the URL)
      theme.ts             sensor colours and ramps
    components/
      Dashboard.tsx        loads data, loading/error states, demo banner, page layout
      RegionSelector.tsx
      SensorSelector.tsx
      BurningCalendar.tsx  years × months grid for the selected sensor
      FireMap.tsx          MapLibre map of hot pixels for the selected month
      MonthReadout.tsx     figures, units, raw/derived, source and coverage
```

## State

One `SelectionProvider` holds `{ regionId, sensor, year, month }`. Every component reads
it with `useSelection()`, so they cannot drift apart. The selection is written to the URL
(`?region=…&sensor=…&period=YYYY-MM`) so a view can be shared.

## Scientific rules enforced in the UI

- **One sensor at a time.** There is no "both" or "combined" option. Each sensor has its
  own hue and its own colour scale, computed from that sensor's months only.
- **Missing is not zero.** `null` / `quality: "no_data"` is drawn as a hatch and worded
  "No data, not zero". A true zero is a separate, plain cell.
- **Partial coverage** is marked and described as a lower bound.
- **Demo data is labelled** in the banner, the source line and the map popup.
- Every figure shows its unit and whether it is raw or derived.
- The limitations text from `metadata.json` is shown on the page.
- No formulas from the pipeline are re-implemented here. The only maths on the frontend
  is choosing colour steps (quartiles of the displayed counts).

## Built so far (vertical slice 1)

RegionSelector, SensorSelector, BurningCalendar, FireMap and a month readout, all
synchronised, on synthetic fixtures.

## Next slices

1. SensorAgreementExplorer (side-by-side MODIS / VIIRS, never summed) — needs Toño's agreement metric.
2. EnvironmentalContext (weather.json, NASA POWER) with Recharts.
3. EvidenceInspector (input files, SHA-256, dropped-row counts, methodology).
4. ExportControls (CSV of the current view, printable HTML evidence report).
5. Swap fixtures for real pipeline output; Vercel deploy.

## Open questions for Toño (contract v0.1)

These are proposals. Nothing here should be treated as agreed until Toño confirms.

1. **`data_status` in `metadata.json`** (`"synthetic_demo"` | `"nasa_firms"`). The UI hides the
   demo banner only when it is exactly `"nasa_firms"`. Can the pipeline write this field?
2. **`unit` and `metric_kind` per metric.** The draft lists them on every measurement, but a
   monthly record carries four metrics. The fixtures describe them once in `metadata.metrics`.
   Is that acceptable, or should monthly be one row per metric?
3. **`regions` in `metadata.json`** (`region_id`, `name`, `bbox`). The demo uses three rough
   boxes (Tijuana–Tecate, Ensenada, Mexicali Valley). Which regions and which boundary polygons
   will the pipeline produce?
4. **Sensor coverage** as `period_min` / `period_max` per sensor ("YYYY-MM").
5. **Size of `hotspots.geojson`.** 8,289 demo points are already 2.9 MB. A multi-year real
   archive in one file will be too heavy for the browser. Proposal: one file per year
   (`hotspots/2021.geojson`) or per region and year.
6. **`percentile_vs_reference`**: the UI shows it as given (0–100). Which reference period?
7. **Suomi NPP vs NOAA-20** for VIIRS: the UI displays whatever `platforms` the metadata lists.
