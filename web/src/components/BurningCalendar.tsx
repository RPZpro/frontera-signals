"use client";

import { useMemo, useRef, useState, type KeyboardEvent } from "react";
import type { MonthlyRecord } from "@/lib/contract";
import { countBreaks, countStep, fmtInt, indexMonthly, MONTHS, MONTHS_LONG, toPeriod, yearsIn } from "@/lib/data";
import { useSelection } from "@/lib/selection";
import { SENSOR_RAMP } from "@/lib/theme";

function describe(rec: MonthlyRecord | undefined): string {
  if (!rec) return "not in the dataset";
  if (rec.quality === "no_data" || rec.hotspot_count === null) return "no data (not zero)";
  const n = `${fmtInt(rec.hotspot_count)} detection${rec.hotspot_count === 1 ? "" : "s"}`;
  return rec.quality === "partial_coverage" ? `${n}, partial coverage` : n;
}

/** Years down, months across. Colour is the month's detection count for the selected sensor only. */
export function BurningCalendar({ monthly }: { monthly: MonthlyRecord[] }) {
  const { regionId, sensor, year, month, setPeriod } = useSelection();
  const [hover, setHover] = useState<{ year: number; month: number } | null>(null);
  const gridRef = useRef<HTMLDivElement>(null);

  const years = useMemo(() => yearsIn(monthly), [monthly]);
  const byPeriod = useMemo(() => indexMonthly(monthly, regionId, sensor), [monthly, regionId, sensor]);
  const breaks = useMemo(() => countBreaks(byPeriod.values()), [byPeriod]);
  const ramp = SENSOR_RAMP[sensor];

  const shown = hover ?? { year, month };
  const shownRec = byPeriod.get(toPeriod(shown.year, shown.month));

  function onKeyDown(e: KeyboardEvent<HTMLButtonElement>, y: number, m: number) {
    const move: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    const d = move[e.key];
    if (!d) return;
    e.preventDefault();
    const ny = Math.min(years[years.length - 1], Math.max(years[0], y + d[0]));
    const nm = Math.min(12, Math.max(1, m + d[1]));
    gridRef.current?.querySelector<HTMLButtonElement>(`[data-cell="${toPeriod(ny, nm)}"]`)?.focus();
  }

  const legendLabels = [
    `1–${breaks[0]}`,
    `${breaks[0] + 1}–${breaks[1]}`,
    `${breaks[1] + 1}–${breaks[2]}`,
    `${breaks[2] + 1}–${breaks[3]}`,
    `${breaks[3] + 1}+`,
  ];

  return (
    <section aria-labelledby="calendar-title" className="flex flex-col gap-4">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="calendar-title" className="font-display text-xl font-semibold">
          {sensor} detections by month
        </h2>
        <p className="tabular text-sm text-soft" aria-live="polite">
          <span className="font-bold text-ink">
            {MONTHS_LONG[shown.month - 1]} {shown.year}
          </span>
          : {describe(shownRec)}
        </p>
      </div>

      <div
        ref={gridRef}
        role="grid"
        aria-label={`${sensor} detections per month. Arrow keys move between months, Enter selects.`}
        className="grid gap-[3px]"
        style={{ gridTemplateColumns: "2.75rem repeat(12, minmax(0, 1fr))" }}
        onMouseLeave={() => setHover(null)}
      >
        <div role="row" className="contents">
          <span role="columnheader" />
          {MONTHS.map((m) => (
            <span key={m} role="columnheader" className="pb-1 text-center text-xs text-muted">
              <span className="sm:hidden">{m[0]}</span>
              <span className="hidden sm:inline">{m}</span>
            </span>
          ))}
        </div>

        {years.map((y) => (
          <div key={y} role="row" className="contents">
            <span role="rowheader" className="tabular flex items-center text-sm text-muted">
              {y}
            </span>
            {MONTHS.map((_, i) => {
              const m = i + 1;
              const period = toPeriod(y, m);
              const rec = byPeriod.get(period);
              const selected = y === year && m === month;
              const missing = !rec || rec.quality === "no_data" || rec.hotspot_count === null;
              const step = missing ? -1 : countStep(rec.hotspot_count as number, breaks);
              return (
                <button
                  key={period}
                  type="button"
                  role="gridcell"
                  data-cell={period}
                  aria-selected={selected}
                  aria-label={`${MONTHS_LONG[i]} ${y}: ${describe(rec)}`}
                  tabIndex={selected ? 0 : -1}
                  onClick={() => setPeriod(y, m)}
                  onMouseEnter={() => setHover({ year: y, month: m })}
                  onFocus={() => setHover({ year: y, month: m })}
                  onBlur={() => setHover(null)}
                  onKeyDown={(e) => onKeyDown(e, y, m)}
                  className={`relative h-9 rounded-[3px] sm:h-10 ${missing ? "hatch" : ""} ${
                    step === 0 ? "border border-line bg-panel" : ""
                  } ${selected ? "z-10 outline-2 outline-offset-1 outline-ink" : "hover:outline hover:outline-1 hover:outline-soft"}`}
                  style={step > 0 ? { background: ramp[step - 1] } : undefined}
                >
                  {rec?.quality === "partial_coverage" && (
                    <span aria-hidden className="absolute right-1 top-1 size-1.5 rounded-full bg-ink ring-1 ring-ground" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-soft">
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-3.5 rounded-[3px] border border-line bg-panel" />0
        </span>
        <span className="flex items-center gap-1.5" aria-label={`Colour steps: ${legendLabels.join(", ")} detections`}>
          {ramp.map((c, i) => (
            <span key={c} className="flex flex-col items-center gap-1">
              <span aria-hidden className="h-3.5 w-9 rounded-[3px] sm:w-11" style={{ background: c }} />
              <span className="tabular text-[11px] text-muted">{legendLabels[i]}</span>
            </span>
          ))}
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="hatch size-3.5 rounded-[3px] border border-line" />
          No data, not zero
        </span>
        <span className="flex items-center gap-1.5">
          <span aria-hidden className="size-1.5 rounded-full bg-ink" />
          Partial coverage
        </span>
      </div>
      <p className="max-w-[68ch] text-sm text-muted">
        Colour steps are set from this region&rsquo;s {sensor} months only. MODIS and VIIRS use different scales and
        different colours because their counts are not comparable.
      </p>
    </section>
  );
}
