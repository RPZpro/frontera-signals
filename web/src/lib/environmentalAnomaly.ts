import { WEATHER_KEYS, type DataStatus, type MonthlyRecord, type Sensor, type WeatherFile } from "./contract";

const LOW_TAIL = 10;
const HIGH_TAIL = 90;
const WEATHER_LABELS = {
  t2m_c: "Temperature",
  rh2m_pct: "Relative humidity",
  prectotcorr_mm_day: "Precipitation",
  ws10m_m_s: "Wind speed",
};

export const ANOMALY_METHOD = `This descriptive screen flags co-occurrence when a series falls above or below its historical active-cell range and at least one quality-approved weather measure is at or below the ${LOW_TAIL}th percentile or at or above the ${HIGH_TAIL}th percentile of its calendar-month normal.`;
export const ANOMALY_LIMITS = "The short thermal reference limits the interpretation of unusual months. Regional monthly means can hide local conditions and short events. The screen estimates neither joint rarity nor fire probability and provides no evidence of ignition cause or intent.";

type ThermalClass = "above_range" | "below_range" | "within_range";

function isPercentile(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100;
}

export function analyzeEnvironment({
  dataStatus, weather, monthly, sensors, regionId, period, sensor,
}: {
  dataStatus: DataStatus;
  weather: WeatherFile | null;
  monthly: MonthlyRecord[];
  sensors: Sensor[];
  regionId: string;
  period: string;
  sensor: Sensor;
}) {
  if (dataStatus !== "nasa_firms" || (weather && weather.data_status !== "nasa_firms")) {
    return { available: false, summary: "Environmental anomaly analysis is unavailable for synthetic demonstration data." } as const;
  }

  const conditions = weather?.records.find((r) => r.region_id === regionId && r.period === period);
  const weatherIndicators = WEATHER_KEYS.map((key) => {
    const details = conditions?.details?.[key];
    const value = conditions?.[key];
    const percentile = details?.quality === "ok" && value != null && Number.isFinite(value) && isPercentile(details.percentile)
      ? details.percentile : null;
    const tail = percentile === null ? null : percentile <= LOW_TAIL ? "low" : percentile >= HIGH_TAIL ? "high" : null;
    const label = WEATHER_LABELS[key];
    return {
      key, label, percentile, tail, baseline: details?.normal_period,
      interpretation: percentile !== null
        ? tail === "low" ? "Unusually low" : tail === "high" ? "Unusually high" : "Within the percentile thresholds"
        : details?.quality === "qc_excluded" ? "Excluded by quality control"
          : details?.quality === "partial_coverage" ? "Incomplete coverage" : "Unavailable",
    };
  });

  const thermal = sensors.map((series) => {
    const record = monthly.find((r) => r.region_id === regionId && r.period === period && r.sensor === series);
    const candidate = record?.seasonal?.activityClass;
    const activityClass: ThermalClass | null =
      record?.quality === "ok" && record.active_cells != null && isPercentile(record.percentile_vs_reference) &&
      (candidate === "above_range" || candidate === "below_range" || candidate === "within_range") ? candidate : null;
    return { series, record, activityClass };
  });

  const evaluated = thermal.filter((item) => item.activityClass !== null);
  const agreement = evaluated.length < 2
    ? "Too few evaluated series to compare thermal classifications for this month."
    : new Set(evaluated.map((item) => item.activityClass)).size === 1
      ? "Evaluated series share the same seasonal classification for this month."
      : "Evaluated series differ in their seasonal classifications for this month.";
  const comparison = evaluated.length >= 2 && evaluated.length < thermal.length
    ? `${agreement} The comparison excludes unavailable series.` : agreement;

  const selected = thermal.find((item) => item.series === sensor)?.activityClass ?? null;
  const tails = weatherIndicators.filter((item) => item.tail);
  const weatherCount = weatherIndicators.filter((item) => item.percentile !== null).length;
  const signal = (selected === "above_range" || selected === "below_range") && tails.length > 0;
  const incomplete = selected === null || weatherCount < WEATHER_KEYS.length;
  const summary = signal
    ? `Thermal activity ${selected === "above_range" ? "above" : "below"} its seasonal range co-occurred with unusual weather in ${tails.length} of ${weatherCount} evaluated variables.`
    : incomplete ? "The available indicators do not establish a co-occurrence flag."
      : "No co-occurrence met the screening rule for the selected series and month.";

  return { available: true, summary, incomplete, weatherCount, weatherIndicators, thermal, comparison } as const;
}

export type EnvironmentalAnalysis = ReturnType<typeof analyzeEnvironment>;
