# Fire Seasons — web

Frontend for **Fire Seasons — Historical Thermal Anomalies** (Frontera Signal, NASA Space Apps Challenge 2026).
Next.js App Router, TypeScript, Tailwind CSS, MapLibre GL JS. No database, no auth, no paid APIs.

```bash
cd web
npm install
npm run dev        # http://localhost:3000
npm run build      # production build (what Vercel runs)
npm run lint
npm run fixtures   # regenerate the synthetic demo data (deterministic)
```

## Data status

The app currently reads **synthetic demonstration fixtures** from `public/data/demo/`.
They are not NASA measurements. While `metadata.json` says anything other than
`"data_status": "nasa_firms"`, the UI shows a permanent "Demonstration data" banner.

To switch to Toño's real pipeline output, put `metadata.json`, `monthly.json` and
`hotspots.geojson` in `public/data/<folder>/` and set `NEXT_PUBLIC_DATA_BASE=/data/<folder>`.

## Deploy (Vercel)

Import the repository and set **Root Directory** to `web`. No other settings are needed.

See `docs/ARCHITECTURE.md` for the structure, the data contract mapping and the open questions for Toño.
