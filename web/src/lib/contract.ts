/**
 * TypeScript mirror of the frontend outputs in docs/data_contract.md, section 3
 * (v0.1 draft, owner: Toño).
 *
 * Do not change these shapes on the frontend alone. Fields marked
 * "FRONTEND PROPOSAL" are not in the draft contract yet and are listed as open
 * questions in web/docs/ARCHITECTURE.md.
 */

export type Sensor = "MODIS" | "VIIRS";
export const SENSORS: readonly Sensor[] = ["MODIS", "VIIRS"];

export type Quality = "ok" | "partial_coverage" | "no_data";
export type MetricKind = "raw" | "derived";

/** FRONTEND PROPOSAL: lets the UI prove whether it is showing real or demo data. */
export type DataStatus = "synthetic_demo" | "nasa_firms";

export type MetricKey = "hotspot_count" | "active_cells" | "percentile_vs_reference" | "frp_sum_mw";

export interface MetricDescriptor {
  label: string;
  unit: string;
  metric_kind: MetricKind;
  description: string;
}

export interface SensorCoverage {
  product: string;
  product_version: string;
  platforms: string[];
  nominal_resolution_m: number;
  /** First and last month with any data, "YYYY-MM". */
  period_min: string;
  period_max: string;
}

export interface Region {
  region_id: string;
  name: string;
  /** [west, south, east, north] in WGS84 degrees. */
  bbox: [number, number, number, number];
  boundary_note?: string;
}

/**
 * One ingested FIRMS file. Mirrors `ValidationReport.to_dict()` in
 * fire_pipeline/loader.py so the pipeline can write its reports unchanged.
 */
export interface InputFile {
  source_file: string;
  sha256: string;
  sensor: Sensor;
  rows_read: number;
  rows_valid: number;
  /** Rows removed by validation, counted per reason. Never imputed. */
  dropped: Record<string, number>;
  duplicates_removed: number;
  versions: string[];
  platforms: string[];
  date_min: string | null;
  date_max: string | null;
}

export interface Metadata {
  contract_version: string;
  data_status: DataStatus;
  data_status_note?: string;
  pipeline_version: string;
  run_timestamp_utc: string;
  input_files: InputFile[];
  sensors: Record<Sensor, SensorCoverage>;
  regions: Region[];
  grid: { description: string; cell_size_deg?: number; cell_size_km?: number };
  reference_period: { start: string; end: string; description: string };
  /** FRONTEND PROPOSAL: unit and metric_kind per metric (the draft lists them per measurement). */
  metrics: Record<MetricKey, MetricDescriptor>;
  limitations: string[];
}

/** One record per region × sensor × month. Unavailable values are null, never 0. */
export interface MonthlyRecord {
  region_id: string;
  sensor: Sensor;
  /** UTC month, "YYYY-MM". */
  period: string;
  source: string;
  product_version: string;
  quality: Quality;
  hotspot_count: number | null;
  active_cells: number | null;
  percentile_vs_reference: number | null;
  frp_sum_mw: number | null;
}

export interface MonthlyFile {
  data_status: DataStatus;
  records: MonthlyRecord[];
}

/** Subset of the canonical detection columns (fire_pipeline/schemas.py). */
export interface HotspotProperties {
  region_id: string;
  sensor: Sensor;
  platform: string;
  version: string;
  is_nrt: boolean;
  acq_datetime_utc: string;
  frp_mw: number;
  /** As distributed: MODIS 0–100, VIIRS l/n/h. Not comparable across sensors. */
  confidence_raw: string;
  confidence_class: "low" | "nominal" | "high";
  daynight: "D" | "N";
  source_file: string;
}

export interface HotspotFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: [number, number] };
  properties: HotspotProperties;
}

export interface HotspotCollection {
  type: "FeatureCollection";
  data_status?: DataStatus;
  features: HotspotFeature[];
}

/** NASA POWER monthly means. Field names are a FRONTEND PROPOSAL (see ARCHITECTURE.md). */
export type WeatherKey = "t2m_c" | "rh2m_pct" | "prectotcorr_mm_day" | "ws10m_m_s";

export interface WeatherRecord {
  region_id: string;
  /** UTC month, "YYYY-MM". */
  period: string;
  source: string;
  quality: Quality;
  t2m_c: number | null;
  rh2m_pct: number | null;
  prectotcorr_mm_day: number | null;
  ws10m_m_s: number | null;
}

/** weather.json is optional in the contract: the app must work without it. */
export interface WeatherFile {
  data_status: DataStatus;
  grid_resolution_note: string;
  variables: Record<WeatherKey, { label: string; unit: string; power_parameter: string }>;
  records: WeatherRecord[];
}
