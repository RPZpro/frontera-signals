import type { ActivityClass, HotspotCollection, HotspotFeature, HotspotProperties, Metadata, MetricDescriptor, MonthlyRecord, Quality, Region, Sensor, WeatherFile, WeatherRecord } from "./contract";
import { BC_SUBREGIONS } from "./municipalities";

type Series = Exclude<Sensor, "VIIRS">;
type ScienceMetric = "hotspot_count" | "frp_sum_mw" | "active_cells" | "active_cell_days";
type Descriptor = Omit<MetricDescriptor, "label" | "metric_kind"> & { label_en: string; kind: MetricDescriptor["metric_kind"] };

export interface ScienceMetadata {
  schema_version: "1.0.0";
  pipeline: { version: string; commit: string; generated_utc: string };
  regions: (Region & { boundary_source: string })[];
  series: Record<Series, {
    product: string;
    platforms: string[];
    nominal_resolution_m: number;
    coverage: [string, string];
    collections_by_year: Record<string, string[]>;
  }>;
  metrics: Record<ScienceMetric, Descriptor>;
  methods: { grid: { crs_name: string; crs: string; cell_size_m: number } };
  activity_classes: Record<string, { en: string }>;
  inputs: { file: string; sha256: string; series: Series; year: number; rows_read: number; rows_valid: number }[];
  limitations: { en: string }[];
}

export interface ScienceMonthly {
  records: {
    region_id: string;
    series: Series;
    period: string;
    source: string;
    product_version: string;
    quality: Quality;
    metrics: Record<ScienceMetric, {
      value: number | null;
      seasonal: { percentile: number | null; activity_class: ActivityClass; ref_period: string; n_ref: number; ref_min: number | null; ref_max: number | null };
    }>;
  }[];
}

export interface ScienceAgreement {
  pairs: {
    region_id: string;
    metric: ScienceMetric;
    series_a: Series;
    series_b: Series;
    n_months: number;
    period: [string, string];
    spearman_percentile: number | null;
    mean_abs_percentile_diff: number | null;
  }[];
}

export interface ScienceHotspots {
  schema_version: string;
  year: number;
  region_id: string;
  features: {
    type: "Feature";
    geometry: HotspotFeature["geometry"];
    properties: {
      counted: boolean;
      series: Series;
      platform: string;
      version: string;
      t: string;
      dn: HotspotProperties["daynight"];
      frp_mw: number;
      conf: string;
      conf_class: HotspotProperties["confidence_class"];
    };
  }[];
}

export interface ScienceWeather {
  records: {
    region_id: string;
    period: string;
    source: string;
    variable: keyof typeof POWER_KEYS;
    long_name: string;
    unit: string;
    value: number | null;
    quality: Quality | "qc_excluded";
    anomaly: number | null;
    anomaly_pct: number | null;
    normal_period: string;
  }[];
}

const POWER_KEYS = {
  T2M: "t2m_c",
  RH2M: "rh2m_pct",
  PRECTOTCORR: "prectotcorr_mm_day",
  WS10M: "ws10m_m_s",
} as const;

export function adaptMetadata(raw: ScienceMetadata, boundary: GeoJSON.FeatureCollection, reference: string): Metadata {
  const metric = (key: ScienceMetric): MetricDescriptor => {
    const { label_en, unit, kind, description } = raw.metrics[key];
    return { label: label_en, unit, metric_kind: kind, description };
  };
  const [start, end] = reference.split("-");
  const grid = raw.methods.grid;
  const baseRegions: Region[] = raw.regions.map((r) => ({
    ...r,
    name: r.region_id === "MX-BCN" ? "Baja California (All State)" : r.name,
    boundary_note: r.boundary_source,
    boundary: r.region_id === "MX-BCN" ? boundary : undefined,
  }));
  const regions: Region[] = raw.regions.some((r) => r.region_id === "MX-BCN")
    ? [...baseRegions, ...BC_SUBREGIONS]
    : baseRegions;

  return {
    contract_version: raw.schema_version,
    data_status: "nasa_firms",
    pipeline_version: `${raw.pipeline.version} (${raw.pipeline.commit})`,
    run_timestamp_utc: raw.pipeline.generated_utc,
    input_files: raw.inputs.map((f) => ({
      source_file: f.file, sensor: f.series, year: f.year, sha256: f.sha256, rows_read: f.rows_read, rows_valid: f.rows_valid,
    })),
    sensors: Object.fromEntries(Object.entries(raw.series).map(([series, info]) => [series, {
      product: info.product,
      product_version: [...new Set(Object.values(info.collections_by_year).flat())].join(", "),
      platforms: info.platforms,
      nominal_resolution_m: info.nominal_resolution_m,
      period_min: info.coverage[0].slice(0, 7),
      period_max: info.coverage[1].slice(0, 7),
    }])) as Metadata["sensors"],
    regions,
    grid: { description: `${grid.cell_size_m / 1000} km equal-area grid, ${grid.crs_name} (${grid.crs})` },
    reference_period: { start, end, description: `The same calendar month in other years of ${start}-${end}, within the same series.` },
    metrics: {
      hotspot_count: metric("hotspot_count"),
      frp_sum_mw: metric("frp_sum_mw"),
      active_cells: metric("active_cells"),
      percentile_vs_reference: {
        label: "Seasonal percentile of active cells", unit: "percentile", metric_kind: "derived",
        description: "Pipeline mid-rank percentile for active 10 km cells against the same month in other reference years.",
      },
    },
    limitations: raw.limitations.map((item) => item.en),
  };
}

export function adaptMonthly(raw: ScienceMonthly, metadata: ScienceMetadata): MonthlyRecord[] {
  const base: MonthlyRecord[] = raw.records.map(({ series, metrics, region_id, period, source, product_version, quality }) => {
    const seasonal = metrics.active_cells.seasonal;
    return {
      region_id, period, source, product_version, quality, sensor: series,
      hotspot_count: metrics.hotspot_count.value,
      frp_sum_mw: metrics.frp_sum_mw.value,
      active_cells: metrics.active_cells.value,
      active_cell_days: metrics.active_cell_days.value,
      percentile_vs_reference: seasonal.percentile,
      seasonal: {
        label: metadata.activity_classes[seasonal.activity_class].en,
        activityClass: seasonal.activity_class,
        n_ref: seasonal.n_ref,
        ref_min: seasonal.ref_min,
        ref_max: seasonal.ref_max,
      },
    };
  });
  const expanded = [...base];
  for (const r of base) {
    if (r.region_id === "MX-BCN") {
      for (const sub of BC_SUBREGIONS) {
        expanded.push({ ...r, region_id: sub.region_id });
      }
    }
  }
  return expanded;
}

export function adaptHotspots(raw: ScienceHotspots, metadata: Metadata, year: number): HotspotCollection {
  if (raw.schema_version !== metadata.contract_version || raw.year !== year) throw new Error("Unexpected hotspot file version or year.");
  const files = new Map(metadata.input_files.filter((f) => f.year === year).map((f) => [f.sensor, f.source_file]));
  return {
    type: "FeatureCollection",
    data_status: "nasa_firms",
    features: raw.features.filter(({ properties }) => properties.counted).map(({ type, geometry, properties: p }) => ({
      type, geometry, properties: {
        region_id: raw.region_id, sensor: p.series, platform: p.platform, version: p.version,
        is_nrt: false, acq_datetime_utc: p.t, daynight: p.dn, frp_mw: p.frp_mw,
        confidence_raw: p.conf, confidence_class: p.conf_class, source_file: files.get(p.series) ?? "Unavailable",
      },
    })),
  };
}

export function adaptWeather(raw: ScienceWeather): WeatherFile {
  const records = new Map<string, WeatherRecord>();
  const variables = Object.fromEntries(raw.records.map((r) => [POWER_KEYS[r.variable], {
    label: r.long_name, unit: r.unit === "C" ? "°C" : r.unit, power_parameter: r.variable,
  }])) as WeatherFile["variables"];
  for (const r of raw.records) {
    const id = `${r.region_id}/${r.period}`;
    const record = records.get(id) ?? {
      region_id: r.region_id, period: r.period, source: r.source, quality: "ok",
      t2m_c: null, rh2m_pct: null, prectotcorr_mm_day: null, ws10m_m_s: null, details: {},
    };
    const key = POWER_KEYS[r.variable];
    record[key] = r.value;
    record.details![key] = { quality: r.quality, anomaly: r.anomaly, percentile: r.anomaly_pct, normal_period: r.normal_period };
    records.set(id, record);
  }
  const baseRecords = [...records.values()];
  const expanded = [...baseRecords];
  for (const r of baseRecords) {
    if (r.region_id === "MX-BCN") {
      for (const sub of BC_SUBREGIONS) {
        expanded.push({ ...r, region_id: sub.region_id });
      }
    }
  }
  return {
    data_status: "nasa_firms", records: expanded, variables,
    grid_resolution_note: "Area-weighted MERRA-2 regional means (0.5° × 0.625°, local solar time).",
  };
}
