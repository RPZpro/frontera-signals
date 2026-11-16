import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { analyzeEnvironment } from "../.next/anomaly-tests/environmentalAnomaly.js";
import { adaptMonthly, adaptWeather } from "../.next/anomaly-tests/science.js";

const readExport = (name) => JSON.parse(readFileSync(new URL(`../../data/export/${name}.json`, import.meta.url), "utf8"));
const monthly = adaptMonthly(readExport("monthly"), readExport("metadata"));
const weather = adaptWeather(readExport("weather"));

function analyze(overrides = {}) {
  return analyzeEnvironment({
    dataStatus: "nasa_firms", regionId: "MX-BCN", period: "2020-06",
    sensor: "MODIS", sensors: ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20"],
    monthly, weather, ...overrides,
  });
}

test("retains pipeline classifications, source percentiles, and the precipitation QC gap", () => {
  const result = analyze();
  assert.equal(result.available, true);
  assert.equal(result.incomplete, true);
  assert.equal(result.weatherCount, 3);
  const rain = result.weatherIndicators.find((item) => item.key === "prectotcorr_mm_day");
  assert.equal(rain.percentile, null);
  assert.equal(rain.interpretation, "Excluded by quality control");
  const modis = result.thermal.find((item) => item.series === "MODIS");
  assert.equal(modis.activityClass, modis.record.seasonal.activityClass);
});

test("reports an observed co-occurrence and different series classifications without pooling counts", () => {
  const result = analyze({ period: "2022-02" });
  assert.equal(result.incomplete, false);
  assert.match(result.summary, /above its seasonal range co-occurred/);
  assert.match(result.comparison, /share the same/);
  const { thermal, weatherIndicators } = result;
  assert.ok(thermal.every(({ record }) => record.hotspot_count === monthly.find((r) => r.period === record.period && r.sensor === record.sensor).hotspot_count));
  assert.equal(weatherIndicators.find((item) => item.key === "rh2m_pct").tail, "low");

  const records = structuredClone(monthly);
  const modis = records.find((r) => r.period === "2022-02" && r.sensor === "MODIS");
  modis.seasonal.activityClass = "above_range";
  for (const r of records.filter((r) => r.period === modis.period && r.sensor !== "MODIS")) r.seasonal.activityClass = "within_range";
  const mixed = analyze({ period: modis.period, monthly: records });
  assert.match(mixed.summary, /above its seasonal range co-occurred/);
  assert.match(mixed.comparison, /differ/);
});

test("uses inclusive tails and requires valid measurements and complete coverage", () => {
  const data = structuredClone(weather);
  const conditions = data.records.find((r) => r.period === "2020-06");
  conditions.details.t2m_c.percentile = 90;
  conditions.details.rh2m_pct.percentile = 10;
  conditions.details.ws10m_m_s.percentile = 100;
  conditions.ws10m_m_s = null;
  conditions.details.prectotcorr_mm_day.percentile = 99;
  const result = analyze({ weather: data });
  assert.deepEqual(result.weatherIndicators.map(({ tail }) => tail), ["high", "low", null, null]);
  assert.equal(result.weatherCount, 2);
  conditions.details.t2m_c.quality = "partial_coverage";
  assert.equal(analyze({ weather: data }).weatherCount, 1);
});

test("requires a selected thermal classification and withholds interpretations for synthetic inputs", () => {
  const result = analyze({ monthly: [], weather: null });
  assert.equal(result.incomplete, true);
  assert.equal(result.weatherCount, 0);
  assert.match(result.summary, /do not establish/);
  assert.match(result.comparison, /Too few/);
  assert.equal(analyze({ dataStatus: "synthetic_demo" }).available, false);
  assert.equal(analyze({ weather: { ...weather, data_status: "synthetic_demo" } }).available, false);
});

test("reports a completed screen without a signal for in-range thermal activity", () => {
  const result = analyze({ period: "2020-01" });
  assert.equal(result.incomplete, false);
  assert.match(result.summary, /No co-occurrence/);
});
