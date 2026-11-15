"use client";

import { useMemo } from "react";
import {
  Area, CartesianGrid, ComposedChart, Line, ReferenceLine, ResponsiveContainer, Scatter, ScatterChart, Tooltip, usePlotArea, XAxis, useXAxisInverseScale, YAxis,
} from "recharts";
import { SENSOR_LABEL, type Sensor } from "@/lib/contract";
import { fmtInt, MONTHS_LONG, type Dataset } from "@/lib/data";
import { download, exportName, harmonizedCsv } from "@/lib/export";
import {
  describeScore, fmtScore, harmonize, HARMONIZATION_VALIDATED, HARMONIZATION_VERSION, LIMITS_Z, MIN_CALIBRATION_MONTHS,
  type Harmonization, type HarmonizedMonth,
} from "@/lib/harmonize";
import { useSelection } from "@/lib/selection";
import { INDEX_COLOR, SENSOR_COLOR } from "@/lib/theme";

type Ready = Extract<Harmonization, { available: true }>;

const MODIS_COLOR = SENSOR_COLOR.MODIS;
const VIIRS_COLOR = SENSOR_COLOR.VIIRS;
const GRID = "#24344b";
const AXIS_TEXT = { fill: "#8798ad", fontSize: 12 };

/** "0.12 below" or "1.21 above": the VIIRS score relative to the MODIS score, in score points. */
const gapText = (d: number) => `${Math.abs(d).toFixed(2)} ${d >= 0 ? "above" : "below"}`;

const monthName = (period: string) => `${MONTHS_LONG[Number(period.slice(5)) - 1]} ${period.slice(0, 4)}`;
const shortMonth = (period: string) => `${MONTHS_LONG[Number(period.slice(5)) - 1].slice(0, 3)} ${period.slice(0, 4)}`;

function Dot({ color }: { color: string }) {
  return <span aria-hidden className="mr-2 inline-block size-2.5 rounded-full align-baseline" style={{ background: color }} />;
}

/** A reading on a short number line: the two sensor scores above it, the combined index on it. */
function Gauge({ month }: { month: HarmonizedMonth }) {
  const LIMIT = 3;
  const x = (v: number) => 24 + ((Math.max(-LIMIT, Math.min(LIMIT, v)) + LIMIT) / (2 * LIMIT)) * 352;
  const ticks = [-3, -2, -1, 0, 1, 2, 3];
  const label =
    month.index === null
      ? "No combined reading for this month."
      : `Combined index ${fmtScore(month.index)}. MODIS score ${fmtScore(month.modis!)}. VIIRS score ${fmtScore(month.viirs!)}.`;
  return (
    <svg viewBox="0 0 400 84" role="img" aria-label={label} className="h-auto w-full max-w-[28rem]">
      <line x1={x(-LIMIT)} x2={x(LIMIT)} y1={50} y2={50} stroke="#3a4d68" strokeWidth={2} strokeLinecap="round" />
      {ticks.map((t) => (
        <g key={t}>
          <line x1={x(t)} x2={x(t)} y1={t === 0 ? 42 : 46} y2={t === 0 ? 58 : 54} stroke={t === 0 ? "#b6c3d3" : "#3a4d68"} strokeWidth={t === 0 ? 2 : 1.5} />
          <text x={x(t)} y={76} textAnchor="middle" fontSize={12} fill={t === 0 ? "#b6c3d3" : "#8798ad"}>
            {t > 0 ? `+${t}` : t < 0 ? `−${-t}` : "0"}
          </text>
        </g>
      ))}
      {month.index !== null && (
        <>
          <line x1={x(month.modis!)} x2={x(month.viirs!)} y1={22} y2={22} stroke="#8798ad" strokeWidth={2} strokeOpacity={0.55} />
          <line x1={x(month.modis!)} x2={x(month.modis!)} y1={22} y2={50} stroke={MODIS_COLOR} strokeWidth={1.5} strokeOpacity={0.7} />
          <line x1={x(month.viirs!)} x2={x(month.viirs!)} y1={22} y2={50} stroke={VIIRS_COLOR} strokeWidth={1.5} strokeOpacity={0.7} />
          <circle cx={x(month.modis!)} cy={22} r={6} fill={MODIS_COLOR} stroke="#07101b" strokeWidth={2} />
          <circle cx={x(month.viirs!)} cy={22} r={6} fill={VIIRS_COLOR} stroke="#07101b" strokeWidth={2} />
          <rect
            x={x(month.index) - 7} y={43} width={14} height={14} rx={2}
            transform={`rotate(45 ${x(month.index)} 50)`}
            fill={INDEX_COLOR} stroke="#07101b" strokeWidth={2}
          />
        </>
      )}
    </svg>
  );
}

function Readout({ h, month, synthetic }: { h: Ready; month: HarmonizedMonth | undefined; synthetic: boolean }) {
  const { period } = useSelection();
  const title = monthName(period);
  const { agreement } = h;
  const evaluated = month?.readings.filter((r) => r.activityClass && r.activityClass !== "not_evaluated" && r.activityClass !== "insufficient_reference") ?? [];
  const records = evaluated.filter((r) => r.activityClass === "above_range").length;

  return (
    <section aria-labelledby="harmonized-readout" className="flex flex-col gap-5 rounded-md border border-line bg-panel p-5">
      <div>
        <h3 id="harmonized-readout" className="font-bold">
          Reading for {title}
        </h3>
        <p className="text-sm text-muted">Pick another month with the year and month menus, or by selecting it on a chart.</p>
      </div>

      {!month || month.index === null ? (
        <div role="status" className="rounded-md border border-line bg-ground p-4">
          <p className="font-bold">No combined reading for this month</p>
          <p className="mt-1 max-w-[56ch] text-sm text-soft">
            {month?.missing.length
              ? `${month.missing.join(". ")}. A combined reading needs both MODIS and VIIRS, so this month is left empty, not set to zero.`
              : "This month is not in the dataset."}
          </p>
        </div>
      ) : (
        <>
          <div>
            <p className="font-display tabular text-6xl font-bold leading-none sm:text-7xl" aria-label={`Harmonized index ${fmtScore(month.index)}`}>
              {fmtScore(month.index)}
            </p>
            <p className="mt-2 max-w-[44ch] text-soft">
              Harmonized index: {describeScore(month.index)}. One point is one standard deviation from the average month between{" "}
              {monthName(h.window.first)} and {monthName(h.window.last)}.
            </p>
          </div>
          <div>
            <Gauge month={month} />
            <ul className="mt-1 flex flex-wrap gap-x-5 gap-y-1 text-sm text-soft" aria-hidden>
              <li><Dot color={MODIS_COLOR} />MODIS score</li>
              <li><Dot color={VIIRS_COLOR} />VIIRS score</li>
              <li>
                <span aria-hidden className="mr-2 inline-block size-2.5 rotate-45" style={{ background: INDEX_COLOR }} />
                Combined index
              </li>
            </ul>
          </div>
          <p className="max-w-[56ch] text-sm text-soft" aria-live="polite">
            {month.outsideLimits ? (
              <>
                <strong className="text-ink">The two sensors disagree more than usual.</strong> VIIRS scores {gapText(month.difference!)} MODIS, outside the {"±"}
                {agreement.upper.toFixed(2)} that most months stay within.
              </>
            ) : (
              <>
                The two sensors agree within their usual range: VIIRS scores {gapText(month.difference!)} MODIS, inside {"±"}
                {agreement.upper.toFixed(2)}.
              </>
            )}
          </p>
        </>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <caption className="sr-only">Each sensor&apos;s own reading for {title}. Sensors are not added together.</caption>
          <thead className="align-bottom text-muted">
            <tr>
              <th className="pb-2 pr-3 font-normal">Series</th>
              <th className="pb-2 pr-3 text-right font-normal">Active cells</th>
              <th className="pb-2 pr-3 text-right font-normal">Score</th>
              <th className="pb-2 text-right font-normal">Seasonal percentile</th>
            </tr>
          </thead>
          <tbody>
            {month?.readings.map((r) => (
              <tr key={r.sensor} className="border-t border-line">
                <th scope="row" className="py-2 pr-3 font-normal">
                  <Dot color={SENSOR_COLOR[r.sensor]} />
                  {SENSOR_LABEL[r.sensor]}
                </th>
                <td className="tabular py-2 pr-3 text-right">
                  {r.cells === null ? "No data" : fmtInt(r.cells)}
                  {r.excluded === "partial_coverage" && <span className="text-muted"> (partial)</span>}
                </td>
                <td className="tabular py-2 pr-3 text-right">{r.score === null ? "Not used" : fmtScore(r.score)}</td>
                <td className="tabular py-2 text-right">{r.percentile === null ? "Not available" : r.percentile}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {month && month.index !== null && (
        <p className="max-w-[60ch] text-sm text-soft">
          {month.consensusPercentile !== null && (
            <>
              Seasonal view: averaged across MODIS and VIIRS, this month ranks at the {Math.round(month.consensusPercentile)}th percentile among the same
              calendar month in other years.{" "}
            </>
          )}
          {evaluated.length > 0 && (
            <>
              {records === 0
                ? `None of the ${evaluated.length} series ranks it as the highest of the record for its calendar month.`
                : `${records} of ${evaluated.length} series rank it as the highest of the record for its calendar month.`}{" "}
              Each series is judged on its own.{" "}
            </>
          )}
          {month.contributors.length < month.readings.length && <>Only {month.contributors.map((s) => SENSOR_LABEL[s]).join(" and ")} reported fully this month. </>}
          {synthetic && <strong className="text-demo">Computed from synthetic demonstration data.</strong>}
        </p>
      )}
    </section>
  );
}

interface Row {
  period: string;
  modis: number | null;
  viirs: number | null;
  index: number | null;
  band: [number, number] | null;
  outsideLimits: boolean;
  missing: string[];
}

function IndexTooltip({ active, payload }: { active?: boolean; payload?: { payload: Row }[] }) {
  if (!active || !payload?.length) return null;
  const r = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink shadow-lg">
      <p className="font-bold">{monthName(r.period)}</p>
      {r.index === null ? (
        <p className="max-w-[18rem] text-soft">No combined reading. {r.missing.join(". ")}. Not zero.</p>
      ) : (
        <>
          <p className="tabular font-bold">Combined {fmtScore(r.index)}</p>
          <p className="tabular text-soft"><Dot color={MODIS_COLOR} />MODIS {fmtScore(r.modis!)}</p>
          <p className="tabular text-soft"><Dot color={VIIRS_COLOR} />VIIRS {fmtScore(r.viirs!)}</p>
          {r.outsideLimits && <p className="mt-1 text-soft">The sensors disagree more than usual.</p>}
        </>
      )}
    </div>
  );
}

/**
 * Turns a click or tap on the plot area into the nearest month. Recharts' own onClick reads its tooltip state,
 * which a touch never moves, so on a phone each tap would select the previous tap's month. This reads the
 * pointer position itself and works the same for mouse, finger and instant clicks.
 */
function MonthPicker({ onPick }: { onPick: (period: string) => void }) {
  const area = usePlotArea();
  const inverse = useXAxisInverseScale();
  if (!area || !inverse) return null;
  return (
    <rect
      x={area.x} y={area.y} width={area.width} height={area.height}
      fill="transparent" style={{ cursor: "pointer" }}
      onClick={(e) => {
        const box = e.currentTarget.getBoundingClientRect();
        const scale = box.width > 0 ? area.width / box.width : 1;
        const period = inverse(area.x + (e.clientX - box.left) * scale);
        if (typeof period === "string" && /^\d{4}-\d{2}$/.test(period)) onPick(period);
      }}
    />
  );
}

function IndexChart({ h }: { h: Ready }) {
  const { period, setPeriod } = useSelection();
  const rows: Row[] = h.months.map((m) => ({
    period: m.period, modis: m.modis, viirs: m.viirs, index: m.index, band: m.band, outsideLimits: m.outsideLimits, missing: m.missing,
  }));
  const values = rows.flatMap((r) => (r.band ? r.band : []));
  const low = Math.min(-2, Math.floor(Math.min(...values)));
  const high = Math.max(2, Math.ceil(Math.max(...values)));
  const yearTicks = rows.filter((r) => r.period.endsWith("-01")).map((r) => r.period);
  const gaps = rows.filter((r) => r.index === null);
  const first = h.months[0].period.slice(0, 4);
  const last = h.months[h.months.length - 1].period.slice(0, 4);

  return (
    <section aria-labelledby="index-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-3">
        <div>
          <h3 id="index-title" className="font-display text-xl font-semibold">
            Harmonized activity index, {first}&ndash;{last}
          </h3>
          <p className="mt-1 max-w-[68ch] text-sm text-soft">
            Zero is the average month of the record and one point is one standard deviation. This is an index, not a count of fires.
          </p>
        </div>
        <ul className="flex flex-wrap items-center gap-x-5 gap-y-1.5 text-sm text-soft" aria-label="Chart legend">
          <li className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-[3px] w-6 rounded-full" style={{ background: INDEX_COLOR, height: 4 }} />
            Combined
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-[2px] w-6 rounded-full" style={{ background: MODIS_COLOR }} />
            MODIS
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-[2px] w-6 rounded-full" style={{ background: VIIRS_COLOR }} />
            VIIRS
          </li>
          <li className="flex items-center gap-2">
            <span aria-hidden className="inline-block h-3 w-6 rounded-sm bg-muted/25" />
            Any other weighting
          </li>
        </ul>
      </div>

      <div className="h-72 rounded-md border border-line bg-panel p-2 pr-3 sm:h-80" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows} margin={{ top: 10, right: 6, bottom: 0, left: -14 }}>
            <CartesianGrid vertical={false} stroke={GRID} />
            <XAxis dataKey="period" ticks={yearTicks} interval={0} tickFormatter={(p: string) => p.slice(0, 4)} tickLine={false} axisLine={{ stroke: GRID }} tick={AXIS_TEXT} />
            <YAxis domain={[low, high]} allowDecimals={false} tickLine={false} axisLine={false} tick={AXIS_TEXT} tickFormatter={(v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0")} />
            <ReferenceLine y={0} stroke="#b6c3d3" strokeOpacity={0.5} />
            <Tooltip cursor={{ stroke: "#f0f3f7", strokeOpacity: 0.35 }} content={<IndexTooltip />} />
            <Area dataKey="band" stroke="none" fill="#8798ad" fillOpacity={0.3} isAnimationActive={false} activeDot={false} connectNulls={false} />
            <Line dataKey="modis" stroke={MODIS_COLOR} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="viirs" stroke={VIIRS_COLOR} strokeWidth={1.5} dot={false} activeDot={false} isAnimationActive={false} connectNulls={false} />
            <Line dataKey="index" stroke={INDEX_COLOR} strokeWidth={3} dot={false} activeDot={{ r: 5, stroke: "#07101b", strokeWidth: 2, fill: INDEX_COLOR }} isAnimationActive={false} connectNulls={false} />
            {rows.some((r) => r.period === period) && <ReferenceLine x={period} stroke={INDEX_COLOR} strokeDasharray="4 3" strokeOpacity={0.8} />}
            <MonthPicker onPick={(p) => setPeriod(Number(p.slice(0, 4)), Number(p.slice(5)))} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {gaps.length > 0 && (
        <p className="max-w-[80ch] text-sm text-soft">
          {gaps.length} {gaps.length === 1 ? "month has" : "months have"} no combined reading and appear as breaks in the line, not as zero:{" "}
          {gaps.map((g) => shortMonth(g.period)).join(", ")}.
        </p>
      )}

      <div className="sr-only">
        <table>
          <caption>Harmonized index and each family&apos;s score by month</caption>
          <thead>
            <tr>
              <th scope="col">Month</th>
              <th scope="col">Combined</th>
              <th scope="col">MODIS</th>
              <th scope="col">VIIRS</th>
              <th scope="col">Sensors disagree more than usual</th>
            </tr>
          </thead>
          <tbody>
            {h.months.map((m) => (
              <tr key={m.period}>
                <th scope="row">{monthName(m.period)}</th>
                <td>{m.index === null ? "No reading" : fmtScore(m.index)}</td>
                <td>{m.modis === null ? "No data" : fmtScore(m.modis)}</td>
                <td>{m.viirs === null ? "No data" : fmtScore(m.viirs)}</td>
                <td>{m.difference === null ? "Not applicable" : m.outsideLimits ? "Yes" : "No"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

interface Point {
  period: string;
  x: number;
  y: number;
  outsideLimits: boolean;
}

function AgreementTooltip({ active, payload }: { active?: boolean; payload?: { payload: Point }[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-ink shadow-lg">
      <p className="font-bold">{monthName(p.period)}</p>
      <p className="tabular text-soft">Combined {fmtScore(p.x)}</p>
      <p className="tabular text-soft">VIIRS minus MODIS {fmtScore(p.y)}</p>
      {p.outsideLimits && <p className="mt-1 text-soft">Outside the usual range.</p>}
    </div>
  );
}

function AgreementChart({ h }: { h: Ready }) {
  const { period, setPeriod } = useSelection();
  const { agreement } = h;
  const points: Point[] = h.months
    .filter((m) => m.index !== null && m.difference !== null)
    .map((m) => ({ period: m.period, x: m.index as number, y: m.difference as number, outsideLimits: m.outsideLimits }));
  const reach = Math.max(1.5, Math.ceil(Math.max(...points.map((p) => Math.abs(p.y))) * 2) / 2);
  const flagged = points.filter((p) => p.outsideLimits);
  const pick = (p: string) => setPeriod(Number(p.slice(0, 4)), Number(p.slice(5)));

  return (
    <section aria-labelledby="agreement-chart-title" className="flex flex-col gap-3 rounded-md border border-line bg-panel p-5">
      <div>
        <h3 id="agreement-chart-title" className="font-bold">
          Where the two sensors disagree
        </h3>
        <p className="mt-1 max-w-[60ch] text-sm text-soft">
          Each dot is a month. Height is how far VIIRS reads from MODIS, in score points. Dots between the dashed lines are within the usual gap.
        </p>
      </div>

      <div className="h-64 sm:h-72" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ScatterChart margin={{ top: 8, right: 14, bottom: 22, left: -6 }}>
            <CartesianGrid stroke={GRID} />
            <XAxis
              type="number" dataKey="x" domain={[-3, 3]} ticks={[-3, -2, -1, 0, 1, 2, 3]} tickLine={false} axisLine={{ stroke: GRID }} tick={AXIS_TEXT}
              tickFormatter={(v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0")}
              label={{ value: "Combined index", position: "insideBottom", offset: -12, fill: "#8798ad", fontSize: 12 }}
            />
            <YAxis
              type="number" dataKey="y" domain={[-reach, reach]} tickLine={false} axisLine={false} tick={AXIS_TEXT} allowDecimals={false}
              tickFormatter={(v: number) => (v > 0 ? `+${v}` : v < 0 ? `−${-v}` : "0")}
              label={{ value: "VIIRS minus MODIS", angle: -90, position: "insideLeft", offset: 22, fill: "#8798ad", fontSize: 12 }}
            />
            <ReferenceLine y={0} stroke="#b6c3d3" strokeOpacity={0.5} />
            <ReferenceLine y={agreement.upper} stroke="#b6c3d3" strokeDasharray="5 4" />
            <ReferenceLine y={agreement.lower} stroke="#b6c3d3" strokeDasharray="5 4" />
            <Tooltip cursor={false} content={<AgreementTooltip />} />
            <Scatter
              data={points}
              isAnimationActive={false}
              shape={(props: unknown) => {
                const { cx, cy, payload } = props as { cx: number; cy: number; payload: Point };
                const selected = payload.period === period;
                return (
                  <circle
                    cx={cx} cy={cy}
                    r={selected ? 7 : payload.outsideLimits ? 6 : 3.5}
                    fill={selected ? INDEX_COLOR : payload.outsideLimits ? "none" : "#8798ad"}
                    fillOpacity={selected ? 1 : 0.85}
                    stroke={selected || payload.outsideLimits ? INDEX_COLOR : "#07101b"}
                    strokeWidth={selected || payload.outsideLimits ? 2 : 1}
                    style={{ cursor: "pointer" }}
                    onClick={() => pick(payload.period)}
                  />
                );
              }}
            />
          </ScatterChart>
        </ResponsiveContainer>
      </div>

      <ul className="flex max-w-[64ch] flex-col gap-1.5 text-sm text-soft">
        <li>
          The two scores move together: r = {agreement.r?.toFixed(2) ?? "unavailable"} across {agreement.n} months, and{" "}
          {agreement.rDeseasonalized?.toFixed(2) ?? "unavailable"} once each calendar month&apos;s average is removed. The second figure is the honest one, because both sensors share the fire season.
        </li>
        <li>
          The dashed lines sit at {"±"}{agreement.upper.toFixed(2)} points. About 95% of months would fall between them if the sensors differed only by random noise.
          {" "}{agreement.outside} of {agreement.n} fall outside.
        </li>
      </ul>

      {flagged.length > 0 && (
        <div>
          <p className="text-sm text-muted">Months outside the usual range. Select one to inspect it:</p>
          <div className="mt-2 flex flex-wrap gap-2">
            {flagged.map((p) => (
              <button
                key={p.period} type="button" onClick={() => pick(p.period)} aria-pressed={p.period === period}
                className={`tabular h-10 rounded-md border px-3 text-sm hover:border-soft ${p.period === period ? "border-ink bg-raised font-bold text-ink" : "border-line text-soft"}`}
              >
                {shortMonth(p.period)} ({fmtScore(p.y)})
              </button>
            ))}
          </div>
        </div>
      )}
    </section>
  );
}

const STEPS: { title: string; text: string }[] = [
  {
    title: "Put each sensor on the same scale",
    text: "Take the logarithm of its active 10 km cells, then measure each month in standard deviations from that sensor's own average. No conversion factor between sensors is used.",
  },
  {
    title: "Count each family once",
    text: "Suomi NPP and NOAA-20 see the same fires, so they are averaged into a single VIIRS score. MODIS already merges Terra and Aqua.",
  },
  {
    title: "Average the two families",
    text: "MODIS and VIIRS carry equal weight. The grey band covers every result you would get with any other weighting.",
  },
  {
    title: "Flag disagreement",
    text: "A month is flagged when the gap between the two scores is wider than random noise alone would leave in about 95% of months.",
  },
];

function Method({ h }: { h: Ready }) {
  return (
    <section aria-labelledby="harmonized-method" className="flex flex-col gap-5">
      <h3 id="harmonized-method" className="font-display text-xl font-semibold">
        How the reading is made
      </h3>
      <ol className="grid grid-cols-1 gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-4">
        {STEPS.map((step, i) => (
          <li key={step.title} className="flex gap-4 border-t border-line pt-4">
            <span aria-hidden className="tabular font-display text-3xl font-semibold text-muted">{i + 1}</span>
            <div>
              <h4 className="font-bold">{step.title}</h4>
              <p className="mt-1 max-w-[44ch] text-sm text-soft">{step.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="max-w-3xl overflow-x-auto rounded-md border border-line bg-panel p-5">
        <table className="w-full min-w-[30rem] text-left text-sm">
          <caption className="pb-3 text-left text-sm text-soft">
            <strong className="text-ink">Calibration of each sensor.</strong> Measured over the {h.window.n} months, {monthName(h.window.first)} to {monthName(h.window.last)}, in which every sensor has complete data.
          </caption>
          <thead className="text-muted">
            <tr>
              <th className="pb-2 pr-4 font-normal">Series</th>
              <th className="pb-2 pr-4 text-right font-normal">A month that scores 0 has</th>
              <th className="pb-2 text-right font-normal">One point up means about</th>
            </tr>
          </thead>
          <tbody>
            {h.calibration.map((c) => (
              <tr key={c.sensor} className="border-t border-line">
                <th scope="row" className="py-2 pr-4 font-normal"><Dot color={SENSOR_COLOR[c.sensor as Sensor]} />{SENSOR_LABEL[c.sensor]}</th>
                <td className="tabular py-2 pr-4 text-right">{fmtInt(Math.round(c.typicalCells))} active cells</td>
                <td className="tabular py-2 text-right">{"×"}{c.factorPerPoint.toFixed(1)} the cells</td>
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-3 max-w-[72ch] text-sm text-muted">
          The same score means a different raw count for each sensor. That is the point: it is how the two are compared without pretending one count converts into the other.
        </p>
      </div>
    </section>
  );
}

/** Harmonized view: MODIS and VIIRS combined into one exploratory activity index. Raw series stay separate elsewhere. */
export function HarmonizedInstrument({ data }: { data: Dataset }) {
  const { regionId, period } = useSelection();
  const result = useMemo(() => harmonize(data.monthly, data.sensors, regionId), [data.monthly, data.sensors, regionId]);
  const region = data.metadata.regions.find((r) => r.region_id === regionId) ?? data.metadata.regions[0];
  const synthetic = data.metadata.data_status !== "nasa_firms";

  const header = (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <h2 id="harmonized-title" className="font-display text-xl font-semibold sm:text-2xl">
          MODIS and VIIRS read as one instrument
        </h2>
        <span className="rounded-full border border-soft px-3 py-1 text-sm font-bold text-ink">
          {HARMONIZATION_VALIDATED ? "Validated" : "Exploratory, not yet validated"}
        </span>
      </div>
      <p className="mt-2 max-w-[72ch] text-soft">
        The two sensors count fires differently, so their raw numbers cannot be added. This view puts each one on a common scale and
        averages them into a single activity index for {region.name}. It also shows when the sensors agree and when they do not. The
        satellite selector above does not change this view, and every other tab keeps the sensors apart.
      </p>
    </div>
  );

  if (!result.available) {
    return (
      <section aria-labelledby="harmonized-title" className="flex flex-col gap-6">
        {header}
        <div role="status" className="max-w-[72ch] rounded-md border border-line bg-panel p-5">
          <p className="font-bold">The sensors are not combined for this region</p>
          <p className="mt-1 text-soft">{result.reason} Showing nothing is better than combining too little data.</p>
        </div>
      </section>
    );
  }

  const month = result.months.find((m) => m.period === period);

  return (
    <section aria-labelledby="harmonized-title" className="flex flex-col gap-10">
      {header}

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-8">
        <Readout h={result} month={month} synthetic={synthetic} />
        <AgreementChart h={result} />
      </div>

      <IndexChart h={result} />
      <Method h={result} />

      <section aria-labelledby="harmonized-limits" className="flex flex-col gap-3">
        <h3 id="harmonized-limits" className="font-display text-xl font-semibold">
          What this index can and cannot say
        </h3>
        <ul className="flex max-w-[80ch] list-disc flex-col gap-1.5 pl-5 text-sm text-soft">
          <li>The index has no unit. It cannot be turned back into detections, burned area or a number of fires.</li>
          <li>
            The method has not been reviewed by the science lead, so it is a way to explore agreement, not a validated harmonization. Version{" "}
            {HARMONIZATION_VERSION}.
          </li>
          <li>
            Each sensor is scaled against the same {result.window.n} months it describes, so there is no independent test. A longer record would allow a
            fairer one.
          </li>
          <li>Equal weights are a choice, not an estimate. The grey band shows how far any other weighting could move the result.</li>
          <li>
            A month needs complete data from at least one MODIS and one VIIRS series ({MIN_CALIBRATION_MONTHS} months are needed to calibrate). Missing
            or partial months are left out, never filled in.
          </li>
          <li>It inherits every limit of hot-pixel data. A hot pixel is not an independent fire, and no detection does not prove there was no fire.</li>
          <li>Nothing here says what caused a fire or who started it.</li>
        </ul>
        <div className="mt-2">
          <button
            type="button"
            className="h-11 rounded-md border border-line bg-raised px-4 text-left text-sm font-bold text-ink hover:border-soft"
            onClick={() =>
              download(
                exportName(data.metadata, [regionId, "harmonized-index"], "csv"),
                harmonizedCsv(data.metadata, regionId, result, data.sensors),
                "text/csv",
              )
            }
          >
            Download harmonized series (CSV)
          </button>
          <p className="mt-2 max-w-[68ch] text-sm text-muted">
            One row per month. Each sensor&apos;s active cells stay in their own column as exported. The file is marked exploratory and not validated
            {synthetic && ", and as synthetic demo data"}. Limits of agreement are {"±"}{LIMITS_Z} standard deviations of the gap.
          </p>
        </div>
      </section>
    </section>
  );
}
