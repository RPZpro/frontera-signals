// Generates SYNTHETIC demonstration fixtures for the frontend.
//
// These are NOT NASA measurements. Every output is marked
// `data_status: "synthetic_demo"` and the UI shows a permanent banner while
// that flag is present. The file layout follows section 3 of
// docs/data_contract.md (v0.1 draft, owner: Toño) so the real pipeline output
// can replace these files without frontend changes.
//
// Deterministic: same seed -> byte-identical output.
// Run: npm run fixtures

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const OUT = join(dirname(fileURLToPath(import.meta.url)), "..", "public", "data", "demo");
const SEED = 20261114;
const YEARS = [2018, 2019, 2020, 2021, 2022, 2023, 2024, 2025];
const SYNTHETIC_SOURCE = "SYNTHETIC demo fixture (not NASA data)";

// --- seeded RNG (mulberry32) ------------------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const rand = rng(SEED);
const gauss = () => {
  const u = Math.max(rand(), 1e-9);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
};
function poisson(lambda) {
  if (lambda <= 0) return 0;
  const L = Math.exp(-lambda);
  let k = 0;
  let p = 1;
  do {
    k += 1;
    p *= rand();
  } while (p > L);
  return k - 1;
}
const round = (v, d) => Number(v.toFixed(d));

// --- demo regions: rough boxes, NOT official boundaries ----------------------
const REGIONS = [
  {
    region_id: "tijuana-tecate",
    name: "Tijuana – Tecate",
    bbox: [-117.13, 32.2, -116.4, 32.56],
    seeds: [[-116.85, 32.42], [-116.62, 32.5], [-116.95, 32.33]],
    // relative activity by month (Jan..Dec): dry-season peak
    season: [0.3, 0.3, 0.4, 0.5, 0.8, 1.3, 1.6, 1.8, 1.7, 1.5, 0.9, 0.4],
    base: 5,
  },
  {
    region_id: "ensenada",
    name: "Ensenada",
    bbox: [-116.9, 31.5, -115.9, 32.2],
    seeds: [[-116.45, 31.95], [-116.2, 31.8], [-116.55, 32.05]],
    season: [0.3, 0.3, 0.4, 0.6, 0.9, 1.4, 1.9, 2.1, 1.8, 1.4, 0.8, 0.4],
    base: 6,
  },
  {
    region_id: "mexicali-valley",
    name: "Mexicali Valley",
    bbox: [-115.8, 32.1, -114.8, 32.7],
    seeds: [[-115.35, 32.45], [-115.15, 32.3], [-115.5, 32.6]],
    // two peaks, loosely modelled on agricultural burning seasons
    season: [0.6, 0.5, 0.6, 1.0, 1.8, 1.9, 0.9, 0.6, 0.8, 1.5, 1.6, 0.8],
    base: 7,
  },
];

const SENSORS = {
  MODIS: {
    product: "MODIS Collection 6.1 Active Fire (MCD14 / FIRMS)",
    product_version: "6.1",
    platforms: ["Terra", "Aqua"],
    nominal_resolution_m: 1000,
    rate: 1, // relative detection volume
  },
  VIIRS: {
    product: "VIIRS 375 m Active Fire (VNP14IMG / FIRMS)",
    product_version: "2.0",
    platforms: ["Suomi NPP"],
    nominal_resolution_m: 375,
    rate: 3.6, // finer pixels -> more detections for the same activity
  },
};

// Unusual periods planted so the calendar has something to find.
const BOOST = {
  "tijuana-tecate|2019-10": 3.2,
  "tijuana-tecate|2024-09": 2.4,
  "ensenada|2020-08": 3.0,
  "ensenada|2022-07": 2.2,
  "mexicali-valley|2021-05": 2.6,
  "mexicali-valley|2023-11": 2.3,
};
// Gaps planted to exercise the "no data" and "partial coverage" states.
const QUALITY = {
  "VIIRS|2018-01": "no_data",
  "VIIRS|2018-02": "no_data",
  "VIIRS|2018-03": "no_data",
  "MODIS|2022-04": "no_data",
  "VIIRS|2021-12": "partial_coverage",
  "MODIS|2020-03": "partial_coverage",
};

// The US–Mexico border, approximated as a straight line, keeps demo points south of it.
const borderLat = (lon) => 32.534 + (lon + 117.12) * (0.186 / 2.4);

function point(region) {
  for (let i = 0; i < 50; i += 1) {
    const [sx, sy] = region.seeds[Math.floor(rand() * region.seeds.length)];
    const lon = sx + gauss() * 0.07;
    const lat = sy + gauss() * 0.05;
    const [w, s, e, n] = region.bbox;
    if (lon > w && lon < e && lat > s && lat < n && lat < borderLat(lon) - 0.01) return [lon, lat];
  }
  return region.seeds[0];
}

const daysIn = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();
const pad = (n) => String(n).padStart(2, "0");

const features = [];
const monthly = [];
const yearFactor = Object.fromEntries(YEARS.map((y) => [y, 0.75 + rand() * 0.6]));

for (const region of REGIONS) {
  for (const [sensor, cfg] of Object.entries(SENSORS)) {
    for (const year of YEARS) {
      for (let m = 1; m <= 12; m += 1) {
        const period = `${year}-${pad(m)}`;
        const quality = QUALITY[`${sensor}|${period}`] ?? "ok";
        const common = {
          region_id: region.region_id,
          sensor,
          period,
          source: SYNTHETIC_SOURCE,
          product_version: cfg.product_version,
          quality,
        };
        if (quality === "no_data") {
          // Unavailable is null, never 0 (data contract section 3).
          monthly.push({ ...common, hotspot_count: null, active_cells: null, percentile_vs_reference: null, frp_sum_mw: null });
          continue;
        }
        const boost = BOOST[`${region.region_id}|${period}`] ?? 1;
        const coverage = quality === "partial_coverage" ? 0.5 : 1;
        const lambda = region.base * region.season[m - 1] * yearFactor[year] * cfg.rate * boost * coverage;
        const count = poisson(lambda);
        const cells = new Set();
        let frpSum = 0;
        const lastDay = quality === "partial_coverage" ? 15 : daysIn(year, m);
        for (let i = 0; i < count; i += 1) {
          const [lon, lat] = point(region);
          const day = 1 + Math.floor(rand() * lastDay);
          const isDay = rand() < 0.6;
          const hour = isDay ? 18 + Math.floor(rand() * 5) : 8 + Math.floor(rand() * 4); // UTC
          const minute = Math.floor(rand() * 60);
          const frpScale = sensor === "MODIS" ? 22 : 6;
          const frp = round(Math.max(0.3, -Math.log(Math.max(rand(), 1e-6)) * frpScale), 2);
          const c = rand();
          const confClass = c < 0.12 ? "low" : c < 0.8 ? "nominal" : "high";
          const confRaw =
            sensor === "MODIS"
              ? String(confClass === "low" ? 10 + Math.floor(rand() * 20) : confClass === "nominal" ? 30 + Math.floor(rand() * 50) : 80 + Math.floor(rand() * 21))
              : confClass[0];
          frpSum += frp;
          cells.add(`${Math.floor(lon / 0.05)}:${Math.floor(lat / 0.05)}`);
          features.push({
            type: "Feature",
            geometry: { type: "Point", coordinates: [round(lon, 5), round(lat, 5)] },
            properties: {
              region_id: region.region_id,
              sensor,
              platform: cfg.platforms[Math.floor(rand() * cfg.platforms.length)],
              version: cfg.product_version,
              is_nrt: false,
              acq_datetime_utc: `${period}-${pad(day)}T${pad(hour)}:${pad(minute)}:00Z`,
              frp_mw: frp,
              confidence_raw: confRaw,
              confidence_class: confClass,
              daynight: isDay ? "D" : "N",
              source_file: "synthetic_demo",
            },
          });
        }
        monthly.push({
          ...common,
          hotspot_count: count,
          active_cells: cells.size,
          percentile_vs_reference: null, // filled below
          frp_sum_mw: round(frpSum, 2),
        });
      }
    }
  }
}

// Percentile of each month against the same calendar month in the other
// fixture years, per region and per sensor (never across sensors).
for (const rec of monthly) {
  if (rec.quality !== "ok") continue;
  const peers = monthly.filter(
    (r) => r.region_id === rec.region_id && r.sensor === rec.sensor && r.quality === "ok" && r.period.slice(5) === rec.period.slice(5),
  );
  const below = peers.filter((r) => r.hotspot_count <= rec.hotspot_count).length;
  rec.percentile_vs_reference = Math.round((100 * below) / peers.length);
}

const sensorsMeta = Object.fromEntries(
  Object.entries(SENSORS).map(([sensor, cfg]) => {
    const periods = monthly.filter((r) => r.sensor === sensor && r.quality !== "no_data").map((r) => r.period).sort();
    return [
      sensor,
      {
        product: cfg.product,
        product_version: cfg.product_version,
        platforms: cfg.platforms,
        nominal_resolution_m: cfg.nominal_resolution_m,
        period_min: periods[0],
        period_max: periods[periods.length - 1],
      },
    ];
  }),
);

const metadata = {
  contract_version: "0.1-draft",
  data_status: "synthetic_demo",
  data_status_note:
    "Synthetic fixtures generated by web/scripts/generate-demo-fixtures.mjs to build and test the interface. No value in these files is a NASA measurement.",
  pipeline_version: "none (frontend fixture generator)",
  run_timestamp_utc: "2026-11-14T00:00:00Z",
  generator_seed: SEED,
  input_files: [],
  sensors: sensorsMeta,
  regions: REGIONS.map(({ region_id, name, bbox }) => ({
    region_id,
    name,
    bbox,
    boundary_note: "Rough bounding box for the demo, not an official boundary polygon.",
  })),
  grid: { cell_size_deg: 0.05, description: "Demo-only 0.05° grid used to count active cells." },
  reference_period: {
    start: `${YEARS[0]}-01`,
    end: `${YEARS[YEARS.length - 1]}-12`,
    description: "Same calendar month across all fixture years, per region and per sensor.",
  },
  metrics: {
    hotspot_count: { label: "Detections", unit: "detections", metric_kind: "raw", description: "Hot pixels flagged by the sensor in the month. A hot pixel is not an independent fire." },
    active_cells: { label: "Active grid cells", unit: "cells", metric_kind: "derived", description: "Grid cells with at least one detection." },
    percentile_vs_reference: { label: "Percentile vs reference", unit: "percentile", metric_kind: "derived", description: "Rank of the month against the same calendar month in the reference period, computed separately for each sensor." },
    frp_sum_mw: { label: "Summed fire radiative power", unit: "MW", metric_kind: "raw", description: "Sum of FRP over the month's detections." },
  },
  limitations: [
    "Raw MODIS and VIIRS counts are not directly comparable: resolution, sensitivity, overpass time and confidence definitions all differ.",
    "A hotspot is a hot pixel. It is not an independent fire.",
    "A thermal anomaly does not indicate cause or intent. No detection does not mean no fire.",
  ],
};

// --- synthetic weather context (stands in for NASA POWER monthly means) -------
// Generated after everything else so the hotspot fixtures stay byte-identical.
const CLIMATE = {
  // per region, Jan..Dec: [T2M °C, RH2M %, PRECTOTCORR mm/day, WS10M m/s]
  "tijuana-tecate": { t: [13.5, 14, 14.8, 16, 17.6, 19.4, 21.8, 22.6, 21.9, 19.2, 16, 13.6], rh: [62, 64, 66, 66, 69, 72, 73, 73, 71, 66, 60, 60], p: [1.6, 1.8, 1.5, 0.6, 0.15, 0.03, 0.02, 0.03, 0.12, 0.4, 0.9, 1.4], w: [3.1, 3.3, 3.5, 3.6, 3.5, 3.3, 3.1, 3.0, 2.9, 2.9, 3.0, 3.1] },
  ensenada: { t: [13, 13.4, 14.2, 15.3, 16.8, 18.6, 20.9, 21.8, 21, 18.5, 15.4, 13.1], rh: [64, 66, 68, 68, 71, 74, 75, 75, 72, 67, 62, 62], p: [1.5, 1.7, 1.4, 0.5, 0.1, 0.02, 0.02, 0.03, 0.1, 0.35, 0.8, 1.3], w: [3.4, 3.6, 3.9, 4.0, 3.9, 3.6, 3.3, 3.2, 3.1, 3.1, 3.2, 3.4] },
  "mexicali-valley": { t: [13.2, 15.6, 18.9, 22.4, 27, 31.8, 34.2, 33.8, 30.6, 24.2, 17.4, 12.9], rh: [44, 39, 33, 27, 23, 21, 30, 35, 34, 34, 39, 45], p: [0.35, 0.3, 0.25, 0.08, 0.02, 0.01, 0.12, 0.3, 0.25, 0.2, 0.2, 0.35], w: [2.4, 2.7, 3.1, 3.4, 3.5, 3.4, 3.1, 2.9, 2.7, 2.5, 2.4, 2.3] },
};
const WEATHER_GAPS = new Set(["2019-06"]); // exercises the "no data" state
const weather = [];
for (const region of REGIONS) {
  const c = CLIMATE[region.region_id];
  for (const year of YEARS) {
    for (let m = 1; m <= 12; m += 1) {
      const period = `${year}-${pad(m)}`;
      const base = { region_id: region.region_id, period, source: SYNTHETIC_SOURCE };
      if (WEATHER_GAPS.has(period)) {
        weather.push({ ...base, quality: "no_data", t2m_c: null, rh2m_pct: null, prectotcorr_mm_day: null, ws10m_m_s: null });
        continue;
      }
      weather.push({
        ...base,
        quality: "ok",
        t2m_c: round(c.t[m - 1] + gauss() * 0.9, 1),
        rh2m_pct: round(Math.min(98, Math.max(8, c.rh[m - 1] + gauss() * 4)), 0),
        prectotcorr_mm_day: round(Math.max(0, c.p[m - 1] * (0.3 + rand() * 1.6)), 2),
        ws10m_m_s: round(Math.max(0.5, c.w[m - 1] + gauss() * 0.3), 1),
      });
    }
  }
}
const weatherFile = {
  data_status: "synthetic_demo",
  grid_resolution_note: "Synthetic. NASA POWER meteorology is distributed on a 0.5° × 0.625° grid; the real file must state how grid cells map to each region.",
  variables: {
    t2m_c: { label: "Air temperature at 2 m", unit: "°C", power_parameter: "T2M" },
    rh2m_pct: { label: "Relative humidity at 2 m", unit: "%", power_parameter: "RH2M" },
    prectotcorr_mm_day: { label: "Precipitation", unit: "mm/day", power_parameter: "PRECTOTCORR" },
    ws10m_m_s: { label: "Wind speed at 10 m", unit: "m/s", power_parameter: "WS10M" },
  },
  records: weather,
};

mkdirSync(OUT, { recursive: true });
writeFileSync(join(OUT, "weather.json"), JSON.stringify(weatherFile) + "\n");
writeFileSync(join(OUT, "metadata.json"), JSON.stringify(metadata, null, 2) + "\n");
writeFileSync(join(OUT, "monthly.json"), JSON.stringify({ data_status: "synthetic_demo", records: monthly }) + "\n");
writeFileSync(
  join(OUT, "hotspots.geojson"),
  JSON.stringify({ type: "FeatureCollection", data_status: "synthetic_demo", features }) + "\n",
);
console.log(`monthly records: ${monthly.length}, hotspot features: ${features.length} -> ${OUT}`);
