import type { HotspotCollection, Metadata, MonthlyFile, MonthlyRecord, Sensor } from "./contract";

/** Folder under /public that holds the pipeline outputs. Swap to the real export when Toño publishes it. */
export const DATA_BASE = process.env.NEXT_PUBLIC_DATA_BASE ?? "/data/demo";

export interface Dataset {
  metadata: Metadata;
  monthly: MonthlyRecord[];
  hotspots: HotspotCollection;
}

async function getJson<T>(file: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}/${file}`);
  if (!res.ok) throw new Error(`${file} could not be loaded (HTTP ${res.status}).`);
  return (await res.json()) as T;
}

export async function loadDataset(): Promise<Dataset> {
  const [metadata, monthlyFile, hotspots] = await Promise.all([
    getJson<Metadata>("metadata.json"),
    getJson<MonthlyFile>("monthly.json"),
    getJson<HotspotCollection>("hotspots.geojson"),
  ]);
  return { metadata, monthly: monthlyFile.records, hotspots };
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
