import { findSubRegion, pointInBbox } from "./municipalities";
import type { HotspotCollection, Metadata, MonthlyFile, MonthlyRecord, Sensor, WeatherFile } from "./contract";
import { adaptHotspots, adaptMetadata, adaptMonthly, adaptWeather, type ScienceAgreement, type ScienceHotspots, type ScienceMetadata, type ScienceMonthly, type ScienceWeather } from "./science";

export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "/data/firms";

export interface Dataset {
  metadata: Metadata;
  monthly: MonthlyRecord[];
  sensors: Sensor[];
  agreement: ScienceAgreement | null;
  /** Optional in the contract. null when the pipeline did not publish weather.json. */
  weather: WeatherFile | null;
}

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`${file} could not be loaded (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

export async function loadDataset(): Promise<Dataset> {
  const raw = await getJson<Metadata | ScienceMetadata>("metadata.json");
  if ("data_status" in raw && raw.data_status === "synthetic_demo") {
    const [monthly, weather] = await Promise.all([
      getJson<MonthlyFile>("monthly.json"),
      getJson<WeatherFile>("weather.json").catch(() => null),
    ]);
    if (monthly.data_status !== "synthetic_demo") throw new Error("Unexpected demo data status.");
    return { metadata: raw, monthly: monthly.records, sensors: ["MODIS", "VIIRS"], weather, agreement: null };
  }
  if (!("schema_version" in raw) || raw.schema_version !== "1.0.0") throw new Error("Unsupported data contract.");
  const [monthly, weather, boundary, agreement] = await Promise.all([
    getJson<ScienceMonthly>("monthly.json"),
    getJson<ScienceWeather>("weather.json").then(adaptWeather).catch(() => null),
    getJson<GeoJSON.FeatureCollection>("mx_bcn_adm1.geojson"),
    getJson<ScienceAgreement>("agreement.json").catch(() => null),
  ]);
  const reference = monthly.records[0]?.metrics.active_cells.seasonal.ref_period;
  if (!reference) throw new Error("The FIRMS monthly export has no seasonal reference period.");
  return {
    metadata: adaptMetadata(raw, boundary, reference), monthly: adaptMonthly(monthly, raw),
    sensors: Object.keys(raw.series) as Sensor[], weather, agreement,
  };
}

const hotspotRequests = new Map<string, Promise<HotspotCollection>>();

export function loadHotspots(metadata: Metadata, year: number) {
  const demo = metadata.data_status === "synthetic_demo";
  const file = demo ? "hotspots.geojson" : `hotspots_${year}.geojson`;
  const existing = hotspotRequests.get(file);
  if (existing) return existing;
  const request = (demo
    ? getJson<HotspotCollection>(file).then((data) => {
        if (data.data_status !== "synthetic_demo") throw new Error("Unexpected demo hotspot data status.");
        return data;
      })
    : getJson<ScienceHotspots>(file).then((data) => adaptHotspots(data, metadata, year))
  ).catch((error: unknown) => {
    hotspotRequests.delete(file);
    throw error;
  });
  hotspotRequests.set(file, request);
  return request;
}

export function monthFeatures(hotspots: HotspotCollection, regionId: string, sensor: Sensor, period: string) {
  const sub = findSubRegion(regionId);
  return hotspots.features.filter((f) => {
    const p = f.properties;
    if (p.sensor !== sensor || !p.acq_datetime_utc.startsWith(period)) return false;
    if (sub) return p.region_id === sub.parentId && pointInBbox(f.geometry.coordinates, sub.bbox);
    return p.region_id === regionId;
  });
}

export const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;
export const MONTHS_LONG = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
] as const;

export const toPeriod = (year: number, month: number) => `${year}-${String(month).padStart(2, "0")}`;

/** Records for one region and one sensor, keyed by "YYYY-MM". Sensors are never mixed. */
export function indexMonthly(monthly: MonthlyRecord[], regionId: string, sensor: Sensor) {
  const byPeriod = new Map<string, MonthlyRecord>();
  for (const r of monthly) {
    if (r.region_id === regionId && r.sensor === sensor) byPeriod.set(r.period, r);
  }
  return byPeriod;
}

export function yearsIn(monthly: MonthlyRecord[]): number[] {
  const years = new Set<number>();
  for (const r of monthly) years.add(Number(r.period.slice(0, 4)));
  return [...years].sort((a, b) => a - b);
}

/**
 * Upper bounds for the four non-zero colour steps, from the quartiles of the
 * non-zero counts of ONE region and ONE sensor. Scales are never shared across sensors.
 */
export function countBreaks(records: Iterable<MonthlyRecord>): number[] {
  const values: number[] = [];
  for (const r of records) if (r.hotspot_count !== null && r.hotspot_count > 0) values.push(r.hotspot_count);
  if (values.length === 0) return [1, 2, 3];
  values.sort((a, b) => a - b);
  const q = (p: number) => values[Math.min(values.length - 1, Math.floor(p * values.length))];
  const breaks = [q(0.25), q(0.5), q(0.75), q(0.9)];
  // keep strictly increasing so every step is reachable
  for (let i = 1; i < breaks.length; i += 1) if (breaks[i] <= breaks[i - 1]) breaks[i] = breaks[i - 1] + 1;
  return breaks;
}

/** 0 = zero detections, 1..5 = increasing count. Call only with a non-null count. */
export function countStep(count: number, breaks: number[]): number {
  if (count === 0) return 0;
  let step = 1;
  for (const b of breaks) if (count > b) step += 1;
  return step;
}

export const fmtInt = (n: number) => n.toLocaleString("en-US");

