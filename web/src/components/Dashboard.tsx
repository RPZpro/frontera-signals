"use client";

import dynamic from "next/dynamic";
import { useEffect, useMemo, useState, type KeyboardEvent } from "react";
import { BurningCalendar } from "@/components/BurningCalendar";
import { EnvironmentalContext } from "@/components/EnvironmentalContext";
import { EvidenceInspector } from "@/components/EvidenceInspector";
import { ExportControls } from "@/components/ExportControls";
import { MethodNotes } from "@/components/MethodNotes";
import { MonthReadout } from "@/components/MonthReadout";
import { RegionSelector } from "@/components/RegionSelector";
import { SensorAgreementExplorer } from "@/components/SensorAgreementExplorer";
import { SensorSelector } from "@/components/SensorSelector";
import { fmtInt, loadDataset, MONTHS_LONG, yearsIn, type Dataset } from "@/lib/data";
import { SelectionProvider, TABS, useSelection, type Tab } from "@/lib/selection";
import { SENSOR_COLOR } from "@/lib/theme";

// MapLibre needs the browser (WebGL), so both maps are loaded on the client only.
const FireMap = dynamic(() => import("@/components/FireMap").then((m) => m.FireMap), {
  ssr: false,
  loading: () => <div className="h-[22rem] rounded-md border border-line bg-panel sm:h-[28rem] lg:h-[34rem]" />,
});
const HeroMap = dynamic(() => import("@/components/HeroMap").then((m) => m.HeroMap), { ssr: false });

const TAB_LABEL: Record<Tab, string> = {
  explore: "Calendar and map",
  sensors: "Compare sensors",
  weather: "Weather",
  evidence: "Evidence and export",
  method: "How it works",
};

function DemoBanner({ note }: { note?: string }) {
  return (
    <div role="note" className="demo-stripe border-b border-demo/50 bg-ground">
      <p className="mx-auto max-w-[90rem] px-4 py-2.5 text-sm text-demo sm:px-8">
        <strong>Demonstration data.</strong> {note ?? "These values are synthetic and are not NASA measurements."}
      </p>
    </div>
  );
}

/** Cover: the busiest month in the dataset, drawn on the real map. */
function Hero({ data, synthetic }: { data: Dataset; synthetic: boolean }) {
  const { setRegion, setSensor, setPeriod, setTab } = useSelection();

  const peak = useMemo(() => {
    let best = data.monthly[0];
    for (const r of data.monthly) if ((r.hotspot_count ?? -1) > (best.hotspot_count ?? -1)) best = r;
    const features = data.hotspots.features.filter(
      (f) => f.properties.sensor === best.sensor && f.properties.acq_datetime_utc.startsWith(best.period),
    );
    return { record: best, features, year: Number(best.period.slice(0, 4)), month: Number(best.period.slice(5)) };
  }, [data]);

  const years = yearsIn(data.monthly);
  const names = data.metadata.regions.map((r) => r.name);
  const where = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names[0];
  const monthLabel = `${MONTHS_LONG[peak.month - 1]} ${peak.year}`;
  const toDashboard = () => document.getElementById("dashboard")?.scrollIntoView({ behavior: "auto", block: "start" });

  return (
    <header className="relative flex h-[92svh] min-h-[36rem] flex-col justify-end overflow-hidden border-b border-line bg-ground lg:justify-center">
      <div className="absolute inset-0">
        <HeroMap regions={data.metadata.regions} features={peak.features} color={SENSOR_COLOR[peak.record.sensor]} />
      </div>
      {/* scrim so the headline stays readable over the map */}
      <div aria-hidden className="absolute inset-0 bg-gradient-to-t from-ground via-ground/80 to-transparent lg:bg-gradient-to-r lg:via-ground/70" />

      <div className="relative mx-auto w-full max-w-[90rem] px-4 pb-8 sm:px-8 lg:pb-0">
        <div className="max-w-[40rem]">
          <p className="text-soft">Frontera Signal, NASA Space Apps Challenge 2026</p>
          <h1 className="font-display mt-3 text-[clamp(3.25rem,9vw,7.5rem)] font-bold leading-[0.92] tracking-tight">Fire Seasons</h1>
          <p className="mt-6 max-w-[34rem] text-lg leading-relaxed text-soft sm:text-xl">
            {years.length} years of satellite heat detections over {where}, month by month, with MODIS and VIIRS kept
            apart so you can see what each one actually recorded.
          </p>
          <div className="mt-8 flex flex-wrap items-center gap-x-6 gap-y-4">
            <button type="button" onClick={toDashboard} className="h-12 rounded-md bg-ink px-6 text-base font-bold text-ground hover:bg-white">
              Explore the data
            </button>
            <button
              type="button"
              onClick={() => {
                setRegion(peak.record.region_id);
                setSensor(peak.record.sensor);
                setPeriod(peak.year, peak.month);
                setTab("explore");
                toDashboard();
              }}
              className="h-12 text-base text-ink underline decoration-muted underline-offset-4 hover:decoration-ink"
            >
              Open {monthLabel} in detail
            </button>
          </div>
        </div>
      </div>

      <p className="tabular relative mx-auto mt-0 flex w-full max-w-[90rem] flex-wrap items-center gap-x-2.5 gap-y-1 px-4 pb-10 text-sm text-soft sm:px-8 lg:absolute lg:inset-x-0 lg:bottom-0 lg:pb-9">
        <span>
          <span aria-hidden className="mr-2 inline-block size-2.5 rounded-full" style={{ background: SENSOR_COLOR[peak.record.sensor] }} />
          On the map: {fmtInt(peak.features.length)} {peak.record.sensor} hot pixels in {monthLabel}, the busiest month in this dataset.
        </span>
        {synthetic && <strong className="text-demo">Synthetic demo points, not NASA measurements.</strong>}
      </p>
    </header>
  );
}

function Tabs() {
  const { tab, setTab, sensor, year, month } = useSelection();
  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const i = TABS.indexOf(tab);
    const next = e.key === "ArrowRight" ? TABS[(i + 1) % TABS.length] : e.key === "ArrowLeft" ? TABS[(i + TABS.length - 1) % TABS.length] : null;
    if (!next) return;
    e.preventDefault();
    setTab(next);
    document.getElementById(`tab-${next}`)?.focus();
  }
  return (
    <div className="sticky top-0 z-30 border-b border-line bg-ground/95 backdrop-blur">
      <div className="mx-auto flex max-w-[90rem] items-end justify-between gap-6 px-4 sm:px-8">
        <div role="tablist" aria-label="Sections" onKeyDown={onKeyDown} className="-mb-px flex overflow-x-auto">
          {TABS.map((t) => (
            <button
              key={t}
              id={`tab-${t}`}
              type="button"
              role="tab"
              aria-selected={t === tab}
              aria-controls="tab-panel"
              tabIndex={t === tab ? 0 : -1}
              onClick={() => setTab(t)}
              className={`h-12 shrink-0 border-b-2 px-3.5 text-[15px] -outline-offset-2 sm:px-4 ${
                t === tab ? "border-ink font-bold text-ink" : "border-transparent text-soft hover:border-line hover:text-ink"
              }`}
            >
              {TAB_LABEL[t]}
            </button>
          ))}
        </div>
        <p className="tabular hidden shrink-0 items-center gap-2 pb-3.5 text-sm text-soft lg:flex">
          <span aria-hidden className="size-2.5 rounded-full" style={{ background: SENSOR_COLOR[sensor] }} />
          {sensor}, {MONTHS_LONG[month - 1]} {year}
        </p>
      </div>
    </div>
  );
}

function Explorer({ data }: { data: Dataset }) {
  const { regionId, sensor, period, tab } = useSelection();
  const record = data.monthly.find((r) => r.region_id === regionId && r.sensor === sensor && r.period === period);
  const synthetic = data.metadata.data_status !== "nasa_firms";

  return (
    <>
      {synthetic && <DemoBanner note={data.metadata.data_status_note} />}
      <Hero data={data} synthetic={synthetic} />

      <div id="dashboard" className="scroll-mt-0">
        <div className="mx-auto flex max-w-[90rem] flex-wrap items-end justify-between gap-x-10 gap-y-5 px-4 pb-6 pt-8 sm:px-8">
          <div>
            <h2 className="font-display text-2xl font-bold sm:text-3xl">Pick a place, a sensor and a month</h2>
            <p className="mt-1.5 max-w-[60ch] text-soft">Every section below follows the same selection.</p>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <RegionSelector regions={data.metadata.regions} />
            <SensorSelector />
          </div>
        </div>

        <Tabs />

        <main id="tab-panel" role="tabpanel" aria-labelledby={`tab-${tab}`} className="mx-auto min-h-[70svh] max-w-[90rem] px-4 py-8 sm:px-8">
          {tab === "explore" && (
            <div className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
              <BurningCalendar monthly={data.monthly} />
              <FireMap regions={data.metadata.regions} hotspots={data.hotspots} record={record} synthetic={synthetic} />
              <div className="lg:col-span-2">
                <MonthReadout metadata={data.metadata} record={record} />
              </div>
            </div>
          )}
          {tab === "sensors" && <SensorAgreementExplorer monthly={data.monthly} />}
          {tab === "weather" && <EnvironmentalContext weather={data.weather} />}
          {tab === "evidence" && (
            <div className="grid gap-10 lg:grid-cols-[minmax(0,6fr)_minmax(0,5fr)]">
              <EvidenceInspector metadata={data.metadata} record={record} />
              <ExportControls metadata={data.metadata} monthly={data.monthly} hotspots={data.hotspots} />
            </div>
          )}
          {tab === "method" && <MethodNotes metadata={data.metadata} />}
        </main>

        <footer className="border-t border-line">
          <p className="mx-auto max-w-[90rem] px-4 py-6 text-sm text-muted sm:px-8">
            Frontera Signal, Tijuana. NASA Space Apps Challenge 2026. A hot pixel is not an independent fire and says
            nothing about cause.
          </p>
        </footer>
      </div>
    </>
  );
}

export function Dashboard() {
  const [data, setData] = useState<Dataset | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    loadDataset()
      .then((d) => !cancelled && setData(d))
      .catch((e: unknown) => !cancelled && setError(e instanceof Error ? e.message : "The data could not be loaded."));
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  if (error) {
    return (
      <div role="alert" className="mx-auto grid min-h-screen max-w-[60ch] place-content-center gap-4 px-6">
        <h1 className="font-display text-2xl font-semibold">The data did not load</h1>
        <p className="text-soft">{error} Nothing is shown rather than showing partial figures.</p>
        <button
          type="button"
          onClick={() => {
            setError(null);
            setAttempt((n) => n + 1);
          }}
          className="h-11 w-fit rounded-md border border-soft px-4 font-bold"
        >
          Load again
        </button>
      </div>
    );
  }
  if (!data) {
    return (
      <p role="status" className="grid min-h-screen place-content-center text-muted">
        Loading satellite records…
      </p>
    );
  }
  return (
    <SelectionProvider data={data}>
      <Explorer data={data} />
    </SelectionProvider>
  );
}
