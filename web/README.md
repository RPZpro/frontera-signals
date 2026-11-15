# Fire Seasons — web

Frontend for **Fire Seasons — Historical Thermal Anomalies** (Frontera Signal, NASA Space Apps Challenge 2026).
Next.js App Router, TypeScript, Tailwind CSS, MapLibre GL JS. No database, no auth, no paid APIs.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (what Vercel runs)
npm run lint
npm test           # environmental anomaly screen tests
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

## Deploy (Vercel)

Import the repository and set **Root Directory** to `web`. Include source files
outside the root directory in the build so the staging hook can read `data/`.

See `docs/ARCHITECTURE.md` for the frontend data flow.
