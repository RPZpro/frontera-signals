# Fire Seasons — web

Frontend for **Fire Seasons — Historical Thermal Anomalies** (Frontera Signal, NASA Space Apps Challenge 2026).
Next.js App Router, TypeScript, Tailwind CSS, MapLibre GL JS. No database, no auth, no paid APIs.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (what Vercel runs)
npm run lint
npm test           # anomaly screen and harmonization tests (the latter check Python-computed reference values)
npm run fixtures   # regenerate the synthetic demo data (deterministic)
```

## Data status

By default the app uses the committed v1 NASA FIRMS and POWER export for Baja California
(2020–2025). The npm dev and build hooks copy the files from the repository's
`data/export/` directory and stage the regional boundary. Point files load by year.

Set `NEXT_PUBLIC_DATA_BASE=/data/demo` before starting dev or building to open the
labelled synthetic demonstration.

The Weather tab and printable report include a descriptive environmental screen.
It identifies months in which a series is outside its pipeline-derived seasonal
active-cell range and at least one quality-approved weather variable is in the
bottom or top decile of its calendar-month normal. The screen uses the exported
percentiles and reports incomplete coverage explicitly.

The Harmonized tab combines MODIS and VIIRS into one **exploratory** activity index. Each sensor is put
on a common unitless scale (log of active 10 km cells, then a per-sensor z-score), the two VIIRS satellites
count once, and the MODIS and VIIRS scores are averaged. It also flags months where the sensors disagree. Raw
detections are never merged, and the index cannot be converted into detections. It is labelled
"not yet validated" until the science lead approves the method; see `docs/HARMONIZATION.md`.

## Deploy (Vercel)

Import the repository using the **Next.js** preset and set **Root Directory** to
`web`. Enable **Include source files outside of the Root Directory in the Build
Step** so the staging hook can read `data/`. Use `npm ci` to install and
`npm run build` to build. Keep the default output directory.

Leave `NEXT_PUBLIC_DATA_BASE` unset to serve the committed NASA export. To enable
the Dark Matter tiles, set `NEXT_PUBLIC_CARTO_BASEMAP_KEY` before building. Use a
[CARTO browser tile key](https://carto.com/basemaps/apikey/) restricted to your
deployment domains. The browser sends this public tile key to CARTO. Without it,
the local regional outline and hotspot layers remain available.

See `docs/ARCHITECTURE.md` for the frontend data flow.
