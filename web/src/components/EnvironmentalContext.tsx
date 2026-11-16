"use client";

import { CartesianGrid, Line, LineChart, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SENSOR_LABEL, WEATHER_KEYS, type WeatherFile } from "@/lib/contract";
import { fmtInt, MONTHS, MONTHS_LONG, toPeriod } from "@/lib/data";
import { ANOMALY_LIMITS, ANOMALY_METHOD, type EnvironmentalAnalysis } from "@/lib/environmentalAnomaly";
import { useSelection } from "@/lib/selection";

const INK = "#b6c3d3";

interface Row {
  label: string;
  month: number;
  value: number | null;
}

function TooltipBody({ active, payload, unit, year }: { active?: boolean; payload?: { payload: Row }[]; unit: string; year: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink shadow-lg">
      <p className="font-bold">
        {MONTHS_LONG[r.month - 1]} {year}
      </p>
      <p className="tabular text-soft">{r.value === null ? "No data" : `${r.value} ${unit}`}</p>
    </div>
  );
}

function AnomalySummary({ analysis }: { analysis: EnvironmentalAnalysis }) {
  const { sensor, year, month } = useSelection();
  return (
    <section aria-labelledby="anomaly-title" className="flex flex-col gap-3 rounded-md border border-line bg-panel p-4 sm:p-5">
      <h3 id="anomaly-title" className="font-display text-lg font-semibold">
        Environmental anomaly screen · {MONTHS_LONG[month - 1]} {year}
      </h3>
      <p className="font-semibold">{SENSOR_LABEL[sensor]} · {analysis.summary}</p>
      {analysis.available && (
        <>
          {analysis.incomplete && <p className="text-sm font-medium text-soft">Incomplete assessment · {analysis.weatherCount} of {WEATHER_KEYS.length} weather variables evaluated. A thermal classification is required for the selected series.</p>}
          <div className="grid gap-4 md:grid-cols-2">
            <div>
              <h4 className="mb-1 font-semibold">Thermal observations and seasonal ranks</h4>
              <ul className="space-y-2 text-sm text-soft">
                {analysis.thermal.map(({ series, record, activityClass }) => (
                  <li key={series}>
                    <strong>{SENSOR_LABEL[series]}</strong>{" · "}
                    {record?.hotspot_count == null ? "Detections unavailable" : `${fmtInt(record.hotspot_count)} detections${record.quality === "partial_coverage" ? " (partial coverage)" : ""}`}
                    {activityClass && record?.seasonal ? ` · active-cell percentile ${record.percentile_vs_reference} · ${record.seasonal.label} (${record.seasonal.n_ref} comparison years)` : " · Seasonal classification unavailable"}
                  </li>
                ))}
              </ul>
              <p className="mt-2 text-sm text-muted">{analysis.comparison}</p>
            </div>
            <div>
              <h4 className="mb-1 font-semibold">Weather percentiles by variable</h4>
              <ul className="space-y-2 text-sm text-soft">
                {analysis.weatherIndicators.map((item) => (
                  <li key={item.key}>
                    <strong>{item.label}</strong> · {item.interpretation}
                    {item.percentile !== null && ` · percentile ${item.percentile} (${item.baseline} normal)`}
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="text-sm text-muted">{ANOMALY_METHOD} {ANOMALY_LIMITS}</p>
        </>
      )}
    </section>
  );
}

/** Monthly weather for the selected region and year. */
export function EnvironmentalContext({ weather, analysis }: { weather: WeatherFile | null; analysis: EnvironmentalAnalysis }) {
  const { regionId, year, month } = useSelection();

  if (!weather) {
    return (
      <section aria-labelledby="env-title" className="flex flex-col gap-2">
        <h2 id="env-title" className="font-display text-xl font-semibold">
          Weather in the region
        </h2>
        <p className="text-sm text-soft">Weather measurements are unavailable.</p>
        <AnomalySummary analysis={analysis} />
      </section>
    );
  }

  const byPeriod = new Map(weather.records.filter((r) => r.region_id === regionId).map((r) => [r.period, r]));
  const selectedRec = byPeriod.get(toPeriod(year, month));
  const synthetic = weather.data_status !== "nasa_firms";

  return (
    <section aria-labelledby="env-title" className="flex flex-col gap-4">
      <div>
        <h2 id="env-title" className="font-display text-xl font-semibold">
          Weather in the region, {year}
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-soft">
          Regional monthly means.{synthetic && " These weather values are synthetic demonstration data."}
        </p>
      </div>
      <AnomalySummary analysis={analysis} />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {WEATHER_KEYS.map((key) => {
          const v = weather.variables[key];
          const rows: Row[] = MONTHS.map((label, i) => ({ label, month: i + 1, value: byPeriod.get(toPeriod(year, i + 1))?.[key] ?? null }));
          const now = selectedRec?.[key] ?? null;
          const detail = selectedRec?.details?.[key];
          return (
            <div key={key} className="flex flex-col gap-1 rounded-md border border-line bg-panel p-4">
              <h3 className="text-sm text-muted">{v.label}</h3>
              <p className="tabular font-display text-2xl font-semibold">
                {now === null ? (
                  <span className="text-base font-normal text-muted">{detail?.quality === "qc_excluded" ? "Excluded by quality control" : "Not available"}</span>
                ) : (
                  <>
                    {now}
                    <span className="ml-1.5 font-sans text-sm font-normal text-soft">{v.unit}</span>
                  </>
                )}
              </p>
              <p className="text-xs text-muted">
                {MONTHS_LONG[month - 1]} {year}, monthly mean
              </p>
              {detail?.anomaly != null && (
                <p className="text-xs text-muted">{detail.anomaly > 0 ? "+" : ""}{detail.anomaly} {v.unit} from the {detail.normal_period} normal</p>
              )}
              <div className="mt-2 h-32" role="img" aria-label={`${v.label} by month in ${year}, in ${v.unit}: ${rows.map((r) => `${r.label} ${r.value ?? "no data"}`).join(", ")}`}>
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rows} margin={{ top: 6, right: 8, bottom: 0, left: -22 }}>
                    <CartesianGrid vertical={false} stroke="#24344b" />
                    <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#24344b" }} tick={{ fill: "#8798ad", fontSize: 11 }} interval={2} />
                    <YAxis tickLine={false} axisLine={false} tick={{ fill: "#8798ad", fontSize: 11 }} tickCount={4} domain={["auto", "auto"]} />
                    <Tooltip cursor={{ stroke: "#8798ad", strokeDasharray: "3 3" }} content={<TooltipBody unit={v.unit} year={year} />} />
                    <ReferenceLine x={MONTHS[month - 1]} stroke="#f0f3f7" strokeOpacity={0.5} />
                    <Line type="linear" dataKey="value" stroke={INK} strokeWidth={2} dot={{ r: 2.5, fill: INK, stroke: "#0f1a28", strokeWidth: 1.5 }} activeDot={{ r: 4 }} connectNulls={false} isAnimationActive={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
              <p className="text-xs text-muted">NASA POWER parameter: {v.power_parameter}</p>
            </div>
          );
        })}
      </div>
      <p className="max-w-[72ch] text-sm text-muted">
        {selectedRec?.source ? `Source: ${selectedRec.source}. ` : ""}
        {weather.grid_resolution_note} A break in a line is a month without data.
      </p>
    </section>
  );
}
