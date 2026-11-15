"use client";

import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { SENSOR_LABEL, type MonthlyRecord, type Quality, type Sensor } from "@/lib/contract";
import { fmtInt, indexMonthly, MONTHS, MONTHS_LONG, toPeriod } from "@/lib/data";
import { useSelection } from "@/lib/selection";
import type { ScienceAgreement } from "@/lib/science";
import { SENSOR_BLURB, SENSOR_COLOR } from "@/lib/theme";

interface Row {
  label: string;
  month: number;
  count: number | null;
  /** Full-height hatched bar for months without data, so a gap never looks like a low value. */
  gap: number | null;
  quality: Quality | "absent";
  percentile: number | null;
}

function TooltipBody({ active, payload, sensor, year }: { active?: boolean; payload?: { payload: Row }[]; sensor: Sensor; year: number }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink shadow-lg">
      <p className="font-bold">
        {MONTHS_LONG[r.month - 1]} {year}
      </p>
      {r.count === null ? (
        <p className="text-soft">No {SENSOR_LABEL[sensor]} data. Not zero.</p>
      ) : (
        <>
          <p className="tabular">
            {fmtInt(r.count)} {SENSOR_LABEL[sensor]} detections{r.quality === "partial_coverage" ? " (partial coverage)" : ""}
          </p>
          {r.percentile !== null && <p className="tabular text-soft">Seasonal percentile {r.percentile} in the series record</p>}
        </>
      )}
    </div>
  );
}

function SensorPanel({ sensor, monthly }: { sensor: Sensor; monthly: MonthlyRecord[] }) {
  const { regionId, sensor: mapSensor, year, month, setPeriod } = useSelection();
  const byPeriod = indexMonthly(monthly, regionId, sensor);
  // One fixed scale per sensor and region, so bar heights stay comparable across years.
  let yMax = 1;
  for (const r of byPeriod.values()) yMax = Math.max(yMax, r.hotspot_count ?? 0);

  const rows: Row[] = MONTHS.map((label, i) => {
    const rec = byPeriod.get(toPeriod(year, i + 1));
    const missing = !rec || rec.quality === "no_data" || rec.hotspot_count === null;
    return {
      label,
      month: i + 1,
      count: missing ? null : rec.hotspot_count,
      gap: missing ? yMax : null,
      quality: rec?.quality ?? "absent",
      percentile: rec?.percentile_vs_reference ?? null,
    };
  });
  const selected = rows[month - 1];
  const withData = rows.filter((r) => r.count !== null).length;
  const hatchId = `gap-${sensor}`;

  return (
    <div className="flex flex-col gap-2 rounded-md border border-line bg-panel p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h3 className="flex items-center gap-2 font-bold">
          <span aria-hidden className="size-3 rounded-full" style={{ background: SENSOR_COLOR[sensor] }} />
          {SENSOR_LABEL[sensor]} <span className="text-sm font-normal text-muted">{SENSOR_BLURB[sensor]}</span>
        </h3>
        <p className="text-sm text-muted">{sensor === mapSensor ? "Shown on the map and calendar" : " "}</p>
      </div>

      <div className="h-48" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={rows} margin={{ top: 6, right: 4, bottom: 0, left: -18 }} barCategoryGap="18%">
            <defs>
              <pattern id={hatchId} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                <line x1="0" y1="0" x2="0" y2="6" stroke="#8798ad" strokeOpacity="0.55" strokeWidth="1.5" />
              </pattern>
            </defs>
            <CartesianGrid vertical={false} stroke="#24344b" />
            <XAxis dataKey="label" tickLine={false} axisLine={{ stroke: "#24344b" }} tick={{ fill: "#8798ad", fontSize: 12 }} interval={0} />
            <YAxis domain={[0, yMax]} allowDecimals={false} tickLine={false} axisLine={false} tick={{ fill: "#8798ad", fontSize: 12 }} tickCount={4} />
            <Tooltip cursor={{ fill: "#f0f3f7", fillOpacity: 0.06 }} content={<TooltipBody sensor={sensor} year={year} />} />
            <Bar dataKey="count" stackId="m" radius={[4, 4, 0, 0]} isAnimationActive={false} onClick={(d) => setPeriod(year, (d as unknown as { payload: Row }).payload.month)} cursor="pointer">
              {rows.map((r) => (
                <Cell key={r.label} fill={SENSOR_COLOR[sensor]} fillOpacity={r.month === month ? 1 : 0.6} stroke={r.month === month ? "#f0f3f7" : "none"} strokeWidth={r.month === month ? 2 : 0} />
              ))}
            </Bar>
            <Bar dataKey="gap" stackId="m" fill={`url(#${hatchId})`} isAnimationActive={false} onClick={(d) => setPeriod(year, (d as unknown as { payload: Row }).payload.month)} cursor="pointer" />
          </BarChart>
        </ResponsiveContainer>
      </div>

      <p className="tabular text-sm text-soft">
        <span className="font-bold text-ink">
          {MONTHS_LONG[month - 1]} {year}:
        </span>{" "}
        {selected.count === null
          ? "no data (not zero)"
          : `${fmtInt(selected.count)} detections${selected.quality === "partial_coverage" ? ", partial coverage" : ""}${
              selected.percentile !== null ? `, seasonal percentile ${selected.percentile} in the series record` : ""
            }`}
      </p>
      <p className="text-sm text-muted">
        {withData} of 12 months have data. Scale: 0 to {fmtInt(yMax)} detections, fixed for this sensor and region.
      </p>

      <table className="sr-only">
        <caption>
          {SENSOR_LABEL[sensor]} detections per month in {year}
        </caption>
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Detections</th>
            <th scope="col">Percentile in own record</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.label}>
              <th scope="row">{MONTHS_LONG[r.month - 1]}</th>
              <td>{r.count === null ? "No data" : r.count}</td>
              <td>{r.percentile ?? "Not available"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** One count scale per series for the selected region and year. */
export function SensorAgreementExplorer({ monthly, sensors, agreement }: { monthly: MonthlyRecord[]; sensors: Sensor[]; agreement: ScienceAgreement | null }) {
  const { year, regionId } = useSelection();
  const pairs = agreement?.pairs.filter((pair) => pair.region_id === regionId && pair.metric === "active_cells") ?? [];
  return (
    <section aria-labelledby="agreement-title" className="flex flex-col gap-4">
      <div>
        <h2 id="agreement-title" className="font-display text-xl font-semibold">
          MODIS and VIIRS side by side, {year}
        </h2>
        <p className="mt-1 max-w-[72ch] text-sm text-soft">
          Each series has its own detection-count scale. Use seasonal percentiles to compare patterns across series.
        </p>
      </div>
      <div className="grid gap-4 md:grid-cols-2">
        {sensors.map((s) => (
          <SensorPanel key={s} sensor={s} monthly={monthly} />
        ))}
      </div>
      {pairs.length > 0 && (
        <section className="rounded-md border border-line bg-panel p-4">
          <h3 className="font-semibold">Agreement in seasonal active-cell percentiles</h3>
          <p className="mt-1 text-sm text-soft">Pipeline estimates across the full study period. Physical equivalence remains unvalidated.</p>
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[35rem] text-left text-sm">
              <thead className="text-muted"><tr><th>Series pair</th><th>Coverage</th><th>Spearman ρ</th><th>Mean gap (percentile points)</th></tr></thead>
              <tbody>
                {pairs.map((pair) => (
                  <tr key={`${pair.series_a}/${pair.series_b}`} className="border-t border-line">
                    <th scope="row" className="py-2 pr-4 font-normal">{SENSOR_LABEL[pair.series_a]} / {SENSOR_LABEL[pair.series_b]}</th>
                    <td className="pr-4">{pair.period.join(" to ")} ({pair.n_months} months)</td>
                    <td>{pair.spearman_percentile ?? "Unavailable"}</td>
                    <td>{pair.mean_abs_percentile_diff ?? "Unavailable"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </section>
  );
}
