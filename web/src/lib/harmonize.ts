import { SENSOR_LABEL, type ActivityClass, type MonthlyRecord, type Sensor } from "./contract";

/**
 * Harmonized view: MODIS and VIIRS read as one virtual instrument.
 *
 * EXPLORATORY. The raw detections of each sensor are never combined. What is combined is a
 * unitless score built from each sensor's own series of active 10 km cells:
 *
 *   1. Variance-stabilise:      u = ln(1 + active cells)
 *   2. Calibrate per sensor:    score = (u - mean) / sd, with mean and sd taken over the months in which
 *                               every sensor has complete data (the calibration window)
 *   3. Pool each family:        VIIRS score = mean of its satellites' scores, so Suomi NPP and NOAA-20,
 *                               which see the same fires, count once
 *   4. Combine the families:    index = (MODIS score + VIIRS score) / 2, equal weights
 *   5. Quantify disagreement:   Bland-Altman limits of agreement on (VIIRS score - MODIS score)
 *
 * There is no conversion factor between sensors. The index cannot be turned back into detections.
 * The method has not been reviewed by the science lead. Flip HARMONIZATION_VALIDATED only after that review.
 */
export const HARMONIZATION_VALIDATED = false;
export const HARMONIZATION_VERSION = "0.1-exploratory";

/** Same minimum record length the pipeline uses before it assesses agreement (agreement.py: min_months). */
export const MIN_CALIBRATION_MONTHS = 24;
/** Bland-Altman limits: mean difference plus or minus this many standard deviations. */
export const LIMITS_Z = 1.96;

export type Family = "MODIS" | "VIIRS";

/** Satellites that see the same fires belong to one family and count once. */
export const FAMILY_OF: Record<Sensor, Family> = {
  MODIS: "MODIS",
  VIIRS: "VIIRS",
  VIIRS_SNPP: "VIIRS",
  VIIRS_NOAA20: "VIIRS",
};

export type Exclusion = "no_data" | "partial_coverage" | "not_in_record";

export const EXCLUSION_TEXT: Record<Exclusion, string> = {
  no_data: "no data",
  partial_coverage: "partial coverage",
  not_in_record: "not in the record",
};

/** One sensor in one month. Raw cells and the calibrated score are kept side by side, never merged. */
export interface Reading {
  sensor: Sensor;
  /** Active 10 km cells exactly as exported. null when unavailable. A partial month keeps its (lower-bound) value. */
  cells: number | null;
  /** Calibrated score. null when the month cannot be used. */
  score: number | null;
  excluded: Exclusion | null;
  /** Pipeline seasonal percentile of the active cells. Only for usable months. */
  percentile: number | null;
  activityClass: ActivityClass | null;
}

export interface Calibration {
  sensor: Sensor;
  /** Mean of ln(1 + cells) over the calibration window. */
  mean: number;
  /** Sample standard deviation of ln(1 + cells) over the calibration window. */
  sd: number;
  /** exp(mean) - 1: the cell count of a month that scores 0 for this sensor. */
  typicalCells: number;
  /** exp(sd): roughly how many times more cells one more score point means. */
  factorPerPoint: number;
}

export interface HarmonizedMonth {
  period: string;
  readings: Reading[];
  /** Family scores. null when no satellite of the family is usable. */
  modis: number | null;
  viirs: number | null;
  /** Equal-weight mean of the two family scores. null unless both families are usable. */
  index: number | null;
  /** Lowest and highest family score: every result between MODIS-only and VIIRS-only weighting. */
  band: [number, number] | null;
  /** VIIRS score minus MODIS score. */
  difference: number | null;
  outsideLimits: boolean;
  /** Mean of the two families' mean seasonal percentiles (0 to 100). Not a conversion; a descriptive summary. */
  consensusPercentile: number | null;
  /** Sensors that fed each family this month. */
  contributors: Sensor[];
  /** Plain-language reasons the index is missing. Empty when it exists. */
  missing: string[];
}

export interface Agreement {
  /** Months with both family scores. */
  n: number;
  /** Pearson correlation of the two family scores. Inflated by the seasonal cycle both share. */
  r: number | null;
  /** The same after subtracting each calendar month's mean, so only departures from the seasonal cycle remain. */
  rDeseasonalized: number | null;
  meanDifference: number;
  sdDifference: number;
  lower: number;
  upper: number;
  outside: number;
}

export type Harmonization =
  | { available: false; reason: string }
  | {
      available: true;
      regionId: string;
      calibration: Calibration[];
      window: { n: number; first: string; last: string };
      months: HarmonizedMonth[];
      agreement: Agreement;
      /** Standard deviation of the index. Slightly under 1 because the two family scores are not identical. */
      indexSd: number;
    };

const mean = (v: number[]) => v.reduce((a, b) => a + b, 0) / v.length;

function sampleSd(v: number[], m = mean(v)): number {
  return Math.sqrt(v.reduce((a, b) => a + (b - m) ** 2, 0) / (v.length - 1));
}

function pearson(a: number[], b: number[]): number | null {
  if (a.length < 3 || a.length !== b.length) return null;
  const ma = mean(a);
  const mb = mean(b);
  let sab = 0;
  let saa = 0;
  let sbb = 0;
  for (let i = 0; i < a.length; i += 1) {
    sab += (a[i] - ma) * (b[i] - mb);
    saa += (a[i] - ma) ** 2;
    sbb += (b[i] - mb) ** 2;
  }
  const denom = Math.sqrt(saa * sbb);
  return denom > 0 ? sab / denom : null;
}

/** Subtract the mean of each calendar month. Calendar months seen only once carry no information and are dropped. */
function deseasonalize(periods: string[], values: number[]): { values: number[]; keep: number[] } {
  const groups = new Map<string, number[]>();
  periods.forEach((p, i) => groups.set(p.slice(5), [...(groups.get(p.slice(5)) ?? []), i]));
  const out: number[] = [];
  const keep: number[] = [];
  for (const indexes of groups.values()) {
    if (indexes.length < 2) continue;
    const m = mean(indexes.map((i) => values[i]));
    for (const i of indexes) {
      out[i] = values[i] - m;
      keep.push(i);
    }
  }
  return { values: out, keep: keep.sort((a, b) => a - b) };
}

type Usable = MonthlyRecord & { active_cells: number };
const isUsable = (r: MonthlyRecord | undefined): r is Usable =>
  !!r && r.quality === "ok" && r.active_cells !== null && Number.isFinite(r.active_cells) && r.active_cells >= 0;

function familyMean(readings: Reading[], family: Family, pick: (r: Reading) => number | null): number | null {
  const values = readings
    .filter((r) => FAMILY_OF[r.sensor] === family)
    .map(pick)
    .filter((v): v is number => v !== null);
  return values.length ? mean(values) : null;
}

/**
 * Build the harmonized series for one region from the dashboard's monthly records.
 * Months a family cannot report stay null. A missing month is never filled with zero or interpolated.
 */
export function harmonize(monthly: MonthlyRecord[], sensors: Sensor[], regionId: string): Harmonization {
  const families = new Set(sensors.map((s) => FAMILY_OF[s]));
  if (!families.has("MODIS") || !families.has("VIIRS")) {
    return { available: false, reason: "The harmonized view needs at least one MODIS series and one VIIRS series." };
  }

  const bySensor = new Map<Sensor, Map<string, MonthlyRecord>>(sensors.map((s) => [s, new Map()]));
  const allPeriods = new Set<string>();
  for (const r of monthly) {
    if (r.region_id !== regionId) continue;
    bySensor.get(r.sensor)?.set(r.period, r);
    if (bySensor.has(r.sensor)) allPeriods.add(r.period);
  }
  const periods = [...allPeriods].sort();

  // Calibration window: only months in which every sensor is complete, so no sensor is calibrated on a month another one lacks.
  const common = periods.filter((p) => sensors.every((s) => isUsable(bySensor.get(s)?.get(p))));
  if (common.length < MIN_CALIBRATION_MONTHS) {
    return {
      available: false,
      reason: `Only ${common.length} months have complete data from every sensor. At least ${MIN_CALIBRATION_MONTHS} are needed to calibrate them against each other.`,
    };
  }

  const calibration: Calibration[] = [];
  for (const sensor of sensors) {
    const logs = common.map((p) => Math.log1p((bySensor.get(sensor)!.get(p) as Usable).active_cells));
    const m = mean(logs);
    const sd = sampleSd(logs, m);
    if (!(sd > 0) || !Number.isFinite(sd)) {
      return { available: false, reason: `${SENSOR_LABEL[sensor]} does not vary across the calibration window, so it cannot be put on a common scale.` };
    }
    calibration.push({ sensor, mean: m, sd, typicalCells: Math.expm1(m), factorPerPoint: Math.exp(sd) });
  }
  const cal = new Map(calibration.map((c) => [c.sensor, c]));

  const months: HarmonizedMonth[] = periods.map((period) => {
    const readings: Reading[] = sensors.map((sensor) => {
      const rec = bySensor.get(sensor)!.get(period);
      const cells = rec?.active_cells ?? null;
      const excluded: Exclusion | null = !rec
        ? "not_in_record"
        : rec.quality === "no_data" || cells === null
          ? "no_data"
          : rec.quality === "partial_coverage"
            ? "partial_coverage"
            : null;
      const c = cal.get(sensor)!;
      const score = excluded === null && cells !== null ? (Math.log1p(cells) - c.mean) / c.sd : null;
      return {
        sensor,
        cells,
        score,
        excluded,
        percentile: excluded === null ? (rec?.percentile_vs_reference ?? null) : null,
        activityClass: excluded === null ? (rec?.seasonal?.activityClass ?? null) : null,
      };
    });

    const modis = familyMean(readings, "MODIS", (r) => r.score);
    const viirs = familyMean(readings, "VIIRS", (r) => r.score);
    const both = modis !== null && viirs !== null;
    const pMod = familyMean(readings, "MODIS", (r) => r.percentile);
    const pVii = familyMean(readings, "VIIRS", (r) => r.percentile);

    const missing: string[] = [];
    for (const family of ["MODIS", "VIIRS"] as const) {
      if ((family === "MODIS" ? modis : viirs) !== null) continue;
      for (const r of readings.filter((x) => FAMILY_OF[x.sensor] === family)) {
        missing.push(`${SENSOR_LABEL[r.sensor]}: ${EXCLUSION_TEXT[r.excluded ?? "no_data"]}`);
      }
    }

    return {
      period,
      readings,
      modis,
      viirs,
      index: both ? (modis + viirs) / 2 : null,
      band: both ? [Math.min(modis, viirs), Math.max(modis, viirs)] : null,
      difference: both ? viirs - modis : null,
      outsideLimits: false,
      consensusPercentile: pMod !== null && pVii !== null ? (pMod + pVii) / 2 : null,
      contributors: readings.filter((r) => r.score !== null).map((r) => r.sensor),
      missing: both ? [] : missing,
    };
  });

  const paired = months.filter((m) => m.difference !== null);
  const diffs = paired.map((m) => m.difference as number);
  const meanDifference = mean(diffs);
  const sdDifference = sampleSd(diffs, meanDifference);
  const lower = meanDifference - LIMITS_Z * sdDifference;
  const upper = meanDifference + LIMITS_Z * sdDifference;
  let outside = 0;
  for (const m of paired) {
    m.outsideLimits = (m.difference as number) < lower || (m.difference as number) > upper;
    if (m.outsideLimits) outside += 1;
  }

  const pairedPeriods = paired.map((m) => m.period);
  const a = paired.map((m) => m.modis as number);
  const b = paired.map((m) => m.viirs as number);
  const da = deseasonalize(pairedPeriods, a);
  const db = deseasonalize(pairedPeriods, b);
  const rDeseasonalized = pearson(da.keep.map((i) => da.values[i]), db.keep.map((i) => db.values[i]));
  const indexValues = paired.map((m) => m.index as number);

  return {
    available: true,
    regionId,
    calibration,
    window: { n: common.length, first: common[0], last: common[common.length - 1] },
    months,
    agreement: { n: paired.length, r: pearson(a, b), rDeseasonalized, meanDifference, sdDifference, lower, upper, outside },
    indexSd: sampleSd(indexValues),
  };
}

/** Plain-language position of a score, in standard-deviation steps of the calibration window. */
export function describeScore(score: number): string {
  const size = Math.abs(score);
  if (size < 0.25) return "about average for this record";
  const side = score > 0 ? "above" : "below";
  if (size < 0.75) return `a little ${side} average`;
  if (size < 1.5) return `clearly ${side} average`;
  return `far ${side} average`;
}

export const fmtScore = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(2)}`;
