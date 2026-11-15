import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { harmonize, MIN_CALIBRATION_MONTHS } from "../.next/anomaly-tests/harmonize.js";
import { adaptMonthly } from "../.next/anomaly-tests/science.js";

const readExport = (name) => JSON.parse(readFileSync(new URL(`../../data/export/${name}.json`, import.meta.url), "utf8"));
const real = adaptMonthly(readExport("monthly"), readExport("metadata"));
const SERIES = ["MODIS", "VIIRS_SNPP", "VIIRS_NOAA20"];
const near = (actual, expected, tolerance = 1e-4, label = "") =>
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label} expected ${expected}, got ${actual}`);

/** Small deterministic fixture: three years of two or three sensors with a shared seasonal cycle. */
function fixture({ sensors = SERIES, months = 36, mutate } = {}) {
  let seed = 7;
  const noise = () => ((seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5) * 0.4;
  const scale = { MODIS: 1, VIIRS: 3, VIIRS_SNPP: 3, VIIRS_NOAA20: 3 };
  const records = [];
  for (let i = 0; i < months; i += 1) {
    const period = `${2021 + Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
    const season = 2 + 1.5 * Math.sin(((i % 12) / 12) * 2 * Math.PI);
    for (const sensor of sensors) {
      records.push({
        region_id: "R1", sensor, period, source: "test", product_version: "1", quality: "ok",
        hotspot_count: null, frp_sum_mw: null,
        active_cells: Math.round(Math.exp(season + noise()) * scale[sensor]),
        percentile_vs_reference: ((i * 7) % 11) * 10,
      });
    }
  }
  return mutate ? mutate(records) : records;
}
const ok = (h) => {
  assert.equal(h.available, true, h.reason);
  return h;
};

test("matches an independent Python implementation on the real FIRMS export", () => {
  const h = ok(harmonize(real, SERIES, "MX-BCN"));
  assert.equal(h.window.n, 72);
  assert.equal(h.months.length, 72);
  const calibration = Object.fromEntries(h.calibration.map((c) => [c.sensor, c]));
  near(calibration.MODIS.mean, 2.765787, 1e-5, "MODIS mean");
  near(calibration.VIIRS_SNPP.sd, 0.437506, 1e-5, "SNPP sd");
  near(calibration.VIIRS_NOAA20.mean, 3.847222, 1e-5, "NOAA-20 mean");
  near(calibration.MODIS.typicalCells, 14.892, 1e-3, "MODIS typical cells");
  near(calibration.MODIS.factorPerPoint, 2.0508, 1e-4, "MODIS factor");

  const june = h.months.find((m) => m.period === "2020-06");
  near(june.index, 1.479867, 1e-5, "index 2020-06");
  near(june.modis, 1.539066, 1e-5, "MODIS score 2020-06");
  near(june.viirs, 1.420667, 1e-5, "VIIRS score 2020-06");
  near(june.consensusPercentile, 100, 1e-9, "consensus percentile 2020-06");
  near(h.months.find((m) => m.period === "2020-01").consensusPercentile, 45, 1e-9, "consensus percentile 2020-01");

  const { agreement } = h;
  assert.equal(agreement.n, 72);
  near(agreement.r, 0.914794, 1e-5, "r");
  near(agreement.rDeseasonalized, 0.831433, 1e-5, "r without seasonal cycle");
  near(agreement.meanDifference, 0, 1e-9, "mean difference");
  near(agreement.sdDifference, 0.41057, 1e-5, "sd difference");
  near(agreement.lower, -0.804718, 1e-5, "lower limit");
  near(agreement.upper, 0.804718, 1e-5, "upper limit");
  near(h.indexSd, 0.97279, 1e-5, "index sd");
  assert.deepEqual(h.months.filter((m) => m.outsideLimits).map((m) => m.period), ["2020-01", "2022-04", "2022-10"]);
  assert.equal(agreement.outside, 3);
});

test("keeps the pipeline's own record months visible, one sensor at a time", () => {
  const h = ok(harmonize(real, SERIES, "MX-BCN"));
  const inAll = h.months.filter((m) => m.readings.every((r) => r.activityClass === "above_range")).map((m) => m.period);
  assert.deepEqual(inAll, ["2020-06", "2021-04", "2022-02", "2023-11", "2024-08", "2025-01"]);
  const june = h.months.find((m) => m.period === "2020-06");
  assert.deepEqual(june.readings.map((r) => r.sensor), SERIES);
  // raw cells are carried through untouched, one value per sensor
  for (const reading of june.readings) {
    const source = real.find((r) => r.sensor === reading.sensor && r.period === "2020-06");
    assert.equal(reading.cells, source.active_cells);
  }
});

test("scores have mean 0 and standard deviation 1 over the calibration window", () => {
  const h = ok(harmonize(fixture(), SERIES, "R1"));
  for (const sensor of SERIES) {
    const scores = h.months.map((m) => m.readings.find((r) => r.sensor === sensor).score);
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const sd = Math.sqrt(scores.reduce((a, b) => a + (b - mean) ** 2, 0) / (scores.length - 1));
    near(mean, 0, 1e-9, `${sensor} mean`);
    near(sd, 1, 1e-9, `${sensor} sd`);
  }
});

test("the index is the equal-weight mean of the two families and always lies inside the band", () => {
  const h = ok(harmonize(fixture(), SERIES, "R1"));
  for (const m of h.months) {
    near(m.index, (m.modis + m.viirs) / 2, 1e-12, m.period);
    assert.ok(m.index >= m.band[0] - 1e-12 && m.index <= m.band[1] + 1e-12, m.period);
    near(m.difference, m.viirs - m.modis, 1e-12, m.period);
  }
});

test("Suomi NPP and NOAA-20 count once: a duplicated VIIRS satellite does not change the index", () => {
  const full = fixture({ sensors: SERIES });
  // Same MODIS and Suomi NPP records in both datasets; only the second adds a NOAA-20 that copies Suomi NPP.
  const single = full.filter((r) => r.sensor !== "VIIRS_NOAA20");
  const twin = [...single, ...single.filter((r) => r.sensor === "VIIRS_SNPP").map((r) => ({ ...r, sensor: "VIIRS_NOAA20" }))];
  const one = ok(harmonize(single, ["MODIS", "VIIRS_SNPP"], "R1"));
  const two = ok(harmonize(twin, SERIES, "R1"));
  assert.equal(one.months.length, two.months.length);
  one.months.forEach((m, i) => near(two.months[i].index, m.index, 1e-12, m.period));
});

test("a missing month stays missing: no zero, no interpolation, no half-combined index", () => {
  const records = fixture({
    mutate: (rows) => rows.map((r) => (r.sensor === "MODIS" && r.period === "2022-03" ? { ...r, quality: "no_data", active_cells: null } : r)),
  });
  const h = ok(harmonize(records, SERIES, "R1"));
  const gap = h.months.find((m) => m.period === "2022-03");
  assert.equal(gap.modis, null);
  assert.equal(gap.index, null);
  assert.equal(gap.band, null);
  assert.equal(gap.difference, null);
  assert.deepEqual(gap.missing, ["MODIS: no data"]);
  assert.equal(gap.readings.find((r) => r.sensor === "MODIS").cells, null);
  assert.ok(gap.viirs !== null, "VIIRS keeps its own reading");
  assert.equal(h.window.n, 35, "the gap month is not used to calibrate any sensor");
  assert.equal(h.agreement.n, 35);
});

test("a partial-coverage month keeps its raw value but is excluded from calibration and from the index", () => {
  const records = fixture({
    mutate: (rows) => rows.map((r) => (r.sensor === "VIIRS_SNPP" && r.period === "2021-07" ? { ...r, quality: "partial_coverage" } : r)),
  });
  const h = ok(harmonize(records, SERIES, "R1"));
  const month = h.months.find((m) => m.period === "2021-07");
  const snpp = month.readings.find((r) => r.sensor === "VIIRS_SNPP");
  assert.equal(snpp.excluded, "partial_coverage");
  assert.equal(snpp.score, null);
  assert.ok(snpp.cells > 0, "the lower-bound value is still shown");
  assert.equal(h.window.n, 35);
  // NOAA-20 alone still speaks for the VIIRS family that month, and the contributors say so
  assert.deepEqual(month.contributors, ["MODIS", "VIIRS_NOAA20"]);
  assert.ok(month.index !== null);
});

test("refuses to calibrate on too little overlap, or without both sensor families", () => {
  const short = harmonize(fixture({ months: MIN_CALIBRATION_MONTHS - 1 }), SERIES, "R1");
  assert.equal(short.available, false);
  assert.match(short.reason, /At least 24 are needed/);
  const modisOnly = harmonize(fixture({ sensors: ["MODIS"] }), ["MODIS"], "R1");
  assert.equal(modisOnly.available, false);
  assert.match(modisOnly.reason, /one MODIS series and one VIIRS series/);
  assert.equal(harmonize(real, SERIES, "NOT-A-REGION").available, false);
});

test("a sensor that never varies cannot be calibrated", () => {
  const flat = fixture({ mutate: (rows) => rows.map((r) => (r.sensor === "MODIS" ? { ...r, active_cells: 5 } : r)) });
  const h = harmonize(flat, SERIES, "R1");
  assert.equal(h.available, false);
  assert.match(h.reason, /MODIS does not vary/);
});

test("works with the demo layout of one MODIS and one VIIRS series", () => {
  const h = ok(harmonize(fixture({ sensors: ["MODIS", "VIIRS"] }), ["MODIS", "VIIRS"], "R1"));
  assert.equal(h.calibration.length, 2);
  assert.ok(h.months.every((m) => m.index !== null));
});
