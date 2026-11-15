import { SENSOR_LABEL, WEATHER_KEYS, type HotspotFeature, type Metadata, type MetricKey, type MonthlyRecord, type Region, type Sensor, type WeatherFile } from "./contract";
import { MONTHS, MONTHS_LONG, toPeriod, yearsIn } from "./data";
import { ANOMALY_LIMITS, ANOMALY_METHOD, type EnvironmentalAnalysis } from "./environmentalAnomaly";

const METRICS: MetricKey[] = ["hotspot_count", "frp_sum_mw", "active_cells", "percentile_vs_reference"];

export const isSynthetic = (metadata: Metadata) => metadata.data_status !== "nasa_firms";

function csvCell(v: string | number | boolean | null | undefined): string {
  if (v === null || v === undefined) return ""; // unavailable stays empty, never 0
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const toCsv = (rows: (string | number | boolean | null | undefined)[][]) =>
  rows.map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";

/** Every month of one region and one sensor. The data status travels in each row. */
export function monthlyCsv(metadata: Metadata, records: MonthlyRecord[]): string {
  const header = [
    "data_status", "region_id", "sensor", "period_utc", "quality",
    ...METRICS.map((k) => `${k} [${metadata.metrics[k].unit}; ${metadata.metrics[k].metric_kind}]`),
    "active_cell_days [cell-days; derived]", "seasonal_activity_class", "reference_year_count", "source", "product_version", "source_file", "sha256",
  ];
  const rows = [...records]
    .sort((a, b) => a.period.localeCompare(b.period))
    .map((r) => {
      const file = metadata.input_files.find((f) => f.sensor === r.sensor && f.year === Number(r.period.slice(0, 4)));
      return [metadata.data_status, r.region_id, r.sensor, r.period, r.quality, ...METRICS.map((k) => r[k]),
        r.active_cell_days, r.seasonal?.label, r.seasonal?.n_ref, r.source, r.product_version, file?.source_file, file?.sha256];
    });
  return toCsv([header, ...rows]);
}

/** The hot pixels currently on the map. */
export function hotspotsCsv(metadata: Metadata, features: HotspotFeature[]): string {
  const header = [
    "data_status", "region_id", "sensor", "platform", "acq_datetime_utc", "latitude", "longitude",
    "frp_mw", "confidence_raw", "confidence_class", "daynight", "version", "is_nrt", "source_file",
  ];
  const rows = features.map((f) => {
    const p = f.properties;
    return [
      metadata.data_status, p.region_id, p.sensor, p.platform, p.acq_datetime_utc,
      f.geometry.coordinates[1], f.geometry.coordinates[0],
      p.frp_mw, p.confidence_raw, p.confidence_class, p.daynight, p.version, p.is_nrt, p.source_file,
    ];
  });
  return toCsv([header, ...rows]);
}

export function exportName(metadata: Metadata, parts: string[], ext: string): string {
  const prefix = isSynthetic(metadata) ? "SYNTHETIC-DEMO_" : "";
  return `${prefix}fire-seasons_${parts.join("_")}.${ext}`;
}

export function download(filename: string, content: string, mime: string) {
  const url = URL.createObjectURL(new Blob([content], { type: `${mime};charset=utf-8` }));
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const esc = (v: unknown) =>
  String(v).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string);

interface ReportInput {
  metadata: Metadata;
  region: Region;
  sensor: Sensor;
  year: number;
  month: number;
  /** All monthly records of this region and sensor. */
  records: MonthlyRecord[];
  record: MonthlyRecord | undefined;
  weather: WeatherFile | null;
  analysis: EnvironmentalAnalysis;
  viewUrl: string;
}

/** Self-contained, printable HTML report for the current view. Light page so it prints cleanly. */
export function evidenceReportHtml({ metadata, region, sensor, year, month, records, record, weather, analysis, viewUrl }: ReportInput): string {
  const synthetic = isSynthetic(metadata);
  const cov = metadata.sensors[sensor];
  const byPeriod = new Map(records.map((r) => [r.period, r]));
  const years = yearsIn(records);
  const title = `${SENSOR_LABEL[sensor]} thermal detections, ${region.name}, ${MONTHS_LONG[month - 1]} ${year}`;
  const inputs = metadata.input_files.filter((f) => f.sensor === sensor);
  const conditions = weather?.records.find((r) => r.region_id === region.region_id && r.period === toPeriod(year, month));
  const weatherRows = weather && conditions ? WEATHER_KEYS.map((key) => {
    const variable = weather.variables[key];
    const detail = conditions.details?.[key];
    const value = conditions[key];
    const anomaly = detail?.anomaly;
    return `<tr><th scope="row">${esc(variable.label)}</th><td>${value == null ? "Unavailable" : esc(value)}</td><td>${esc(variable.unit)}</td><td>${esc(detail?.quality ?? conditions.quality)}</td><td>${anomaly == null ? "Unavailable" : esc(`${anomaly} (${detail?.normal_period} normal)`)}</td></tr>`;
  }).join("") : null;
  const anomalyDetails = analysis.available ? `
    ${analysis.incomplete ? `<p>Incomplete assessment. ${analysis.weatherCount} of ${WEATHER_KEYS.length} weather variables evaluated. A thermal classification is required for the selected series.</p>` : ""}
    <p>${esc(analysis.comparison)}</p>
    <table><thead><tr><th>Series</th><th>Raw detections</th><th>Seasonal active-cell percentile</th><th>Seasonal classification</th></tr></thead><tbody>
    ${analysis.thermal.map(({ series, record, activityClass }) => `<tr><th scope="row">${esc(SENSOR_LABEL[series])}</th><td>${esc(record?.hotspot_count ?? "Unavailable")}${record?.quality === "partial_coverage" ? " (partial coverage)" : ""}</td><td>${esc(activityClass ? record?.percentile_vs_reference : "Unavailable")}</td><td>${esc(activityClass ? record?.seasonal?.label : "Unavailable")}</td></tr>`).join("")}
    </tbody></table>
    <table><thead><tr><th>Weather variable</th><th>Calendar-month percentile</th><th>Normal period</th><th>Screening interpretation</th></tr></thead><tbody>
    ${analysis.weatherIndicators.map((item) => `<tr><th scope="row">${esc(item.label)}</th><td>${esc(item.percentile ?? "Unavailable")}</td><td>${esc(item.baseline ?? "Unavailable")}</td><td>${esc(item.interpretation)}</td></tr>`).join("")}
    </tbody></table>
    <p>${esc(ANOMALY_METHOD)} ${esc(ANOMALY_LIMITS)}</p>` : "";

  const figure = (k: MetricKey) => {
    const m = metadata.metrics[k];
    const v = record ? record[k] : null;
    return `<tr><th scope="row">${esc(m.label)}</th><td class="num">${v === null ? "Not available" : esc(v.toLocaleString("en-US"))}</td><td>${esc(m.unit)}</td><td>${m.metric_kind === "raw" ? "Raw" : "Derived"}</td><td>${esc(m.description)}</td></tr>`;
  };

  const cell = (y: number, i: number) => {
    const r = byPeriod.get(`${y}-${String(i + 1).padStart(2, "0")}`);
    const sel = y === year && i + 1 === month ? " sel" : "";
    if (!r || r.quality === "no_data" || r.hotspot_count === null) return `<td class="num na${sel}">no data</td>`;
    return `<td class="num${sel}">${r.hotspot_count}${r.quality === "partial_coverage" ? "*" : ""}</td>`;
  };

  const files = inputs.length
    ? `<table><thead><tr><th>File</th><th>Series</th><th>Rows read</th><th>Rows valid</th><th>SHA-256</th></tr></thead><tbody>${inputs
        .map(
          (f) =>
            `<tr><td>${esc(f.source_file)}</td><td>${esc(SENSOR_LABEL[f.sensor])}</td><td class="num">${f.rows_read}</td><td class="num">${f.rows_valid}</td><td class="hash">${esc(f.sha256)}</td></tr>`,
        )
        .join("")}</tbody></table>`
    : `<p>No NASA input files are listed in the metadata${synthetic ? ", because this dataset is synthetic" : ""}.</p>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — evidence report</title>
<style>
  body{font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;color:#16202c;background:#fff;max-width:60rem;margin:2rem auto;padding:0 1.25rem}
  h1{font-size:1.6rem;line-height:1.2;margin:0 0 .25rem} h2{font-size:1.1rem;margin:2rem 0 .5rem;border-bottom:1px solid #c9d1dc;padding-bottom:.25rem}
  table{border-collapse:collapse;width:100%;font-size:13px} th,td{border:1px solid #c9d1dc;padding:.3rem .5rem;text-align:left;vertical-align:top}
  thead th{background:#eef1f5} .num{text-align:right;font-variant-numeric:tabular-nums} .na{color:#5b6777;background:repeating-linear-gradient(135deg,#fff 0 4px,#e3e7ed 4px 5px)}
  .sel{outline:2px solid #16202c;outline-offset:-2px;font-weight:700} .hash{font-family:ui-monospace,Consolas,monospace;font-size:11px;word-break:break-all}
  .demo{border:2px solid #8a6a00;background:#fff6d6;padding:.6rem .8rem;margin:1rem 0;font-weight:700}
  .meta{color:#465363} button{font:inherit;padding:.4rem .9rem;margin-top:1rem} dl{display:grid;grid-template-columns:max-content 1fr;gap:.25rem 1rem;margin:0} dt{color:#465363}
  @media print{button{display:none} body{margin:0} h2{break-after:avoid} table{break-inside:auto} tr{break-inside:avoid}}
</style></head><body>
<h1>${esc(title)}</h1>
<p class="meta">Fire Seasons evidence report. Generated ${esc(new Date().toISOString())} (UTC).</p>
${synthetic ? `<p class="demo">DEMONSTRATION DATA. ${esc(metadata.data_status_note ?? "These values are synthetic and are not NASA measurements.")}</p>` : ""}
<button type="button" onclick="window.print()">Print this report</button>

<h2>Selected month</h2>
<p>${esc(record ? (record.quality === "no_data" ? "No data for this month. This is a gap in the record, not zero detections." : record.quality === "partial_coverage" ? "Partial coverage: the month is incomplete, so the figures are a lower bound." : "Full month.") : "This month is not in the dataset.")}</p>
<table><thead><tr><th>Measure</th><th>Value</th><th>Unit</th><th>Kind</th><th>Definition</th></tr></thead><tbody>${(["hotspot_count", "frp_sum_mw", "active_cells", "percentile_vs_reference"] as MetricKey[]).map(figure).join("")}</tbody></table>
${record?.active_cell_days != null ? `<p>Active cell-days (derived) · ${esc(record.active_cell_days)}</p>` : ""}
${record?.seasonal ? `<p>${esc(record.seasonal.label)}. Reference contains ${esc(record.seasonal.n_ref)} other same-calendar months.</p>` : ""}

<h2>Environmental context for the selected month</h2>
${weatherRows && conditions && weather ? `<p>${esc(conditions.source)}. ${esc(weather.grid_resolution_note)}</p><table><thead><tr><th>Measure</th><th>Mean</th><th>Unit</th><th>Quality</th><th>Departure from normal</th></tr></thead><tbody>${weatherRows}</tbody></table>` : "<p>Weather data are unavailable for the selected month.</p>"}

<h2>Environmental anomaly screen</h2>
<p>${esc(SENSOR_LABEL[sensor])} · ${esc(analysis.summary)}</p>
${anomalyDetails}

<h2>${esc(SENSOR_LABEL[sensor])} detections per month, ${esc(region.name)}</h2>
<table><thead><tr><th>Year</th>${MONTHS.map((m) => `<th>${m}</th>`).join("")}</tr></thead><tbody>
${years.map((y) => `<tr><th scope="row">${y}</th>${MONTHS.map((_, i) => cell(y, i)).join("")}</tr>`).join("\n")}
</tbody></table>
<p class="meta">Unit: ${esc(metadata.metrics.hotspot_count.unit)} (raw). "no data" marks a gap in the record and is not zero. * partial coverage. The outlined cell is the selected month. Months are UTC.</p>

<h2>Provenance</h2>
<dl>
  <dt>Data status</dt><dd>${esc(metadata.data_status)}</dd>
  <dt>Source</dt><dd>${esc(record?.source ?? "Not available")}</dd>
  <dt>Product</dt><dd>${esc(cov.product)}, version ${esc(record?.product_version ?? cov.product_version)}</dd>
  <dt>Platforms</dt><dd>${esc(cov.platforms.join(", "))}</dd>
  <dt>Nominal pixel</dt><dd>${cov.nominal_resolution_m} m</dd>
  <dt>Sensor coverage</dt><dd>${esc(cov.period_min)} to ${esc(cov.period_max)}</dd>
  <dt>Region</dt><dd>${esc(region.name)} (${esc(region.region_id)}), bounding box W ${region.bbox[0]}, S ${region.bbox[1]}, E ${region.bbox[2]}, N ${region.bbox[3]}. ${esc(region.boundary_note ?? "")}</dd>
  <dt>Grid</dt><dd>${esc(metadata.grid.description)}</dd>
  <dt>Reference period</dt><dd>${esc(metadata.reference_period.start)} to ${esc(metadata.reference_period.end)}. ${esc(metadata.reference_period.description)}</dd>
  <dt>Pipeline</dt><dd>${esc(metadata.pipeline_version)}, run ${esc(metadata.run_timestamp_utc)}, data contract ${esc(metadata.contract_version)}</dd>
  <dt>View</dt><dd>${esc(viewUrl)}</dd>
</dl>

<h2>Input files</h2>
${files}

<h2>Limitations</h2>
<ul>${metadata.limitations.map((l) => `<li>${esc(l)}</li>`).join("")}</ul>
<p class="meta">Frontera Signal, Tijuana. NASA Space Apps Challenge 2026.</p>
</body></html>
`;
}
