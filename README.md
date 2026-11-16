# Frontera Signal — Fire Seasons

**NASA Space Apps Challenge 2026 | Harmonization of MODIS and VIIRS Hot Spots**

**Frontera Signal** is an interactive wildfire intelligence dashboard integrating real NASA FIRMS active fire detections (**MODIS**, **VIIRS Suomi NPP**, and **VIIRS NOAA-20**) with **NASA POWER** meteorological reanalysis across Baja California and its border municipalities (**Tijuana & Playas de Rosarito**, **Tecate**, **Ensenada & San Quintín**, and **Mexicali & San Felipe**) from **2020 to 2025**.

## Quick Start (Run Locally)

All pre-processed NASA FIRMS and NASA POWER datasets (2020–2025) are already bundled in `web/public/data/firms/`, so no API keys or external downloads are required.

1. Open a terminal inside the `web/` folder.
2. Install dependencies: `npm install`
3. Start the app: `npm run dev`
4. Open `http://localhost:3000` in your browser.

## Repository Structure
- `web/` — Next.js, React, TypeScript, and MapLibre GL JS interactive dashboard.
- `web/public/data/firms/` — Standardized 2020–2025 NASA FIRMS GeoJSON/JSON exports, NASA POWER climate records, and Baja California boundary geometry.
- `fire_pipeline/` — Python (`geopandas`, `pandas`) scientific harmonization and spatial aggregation pipeline.
