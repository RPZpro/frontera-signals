"use client";

import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { BurningCalendar } from "@/components/BurningCalendar";
import { EnvironmentalContext } from "@/components/EnvironmentalContext";
import { EvidenceInspector } from "@/components/EvidenceInspector";
import { ExportControls } from "@/components/ExportControls";
import { MonthReadout } from "@/components/MonthReadout";
import { RegionSelector } from "@/components/RegionSelector";
import { SensorAgreementExplorer } from "@/components/SensorAgreementExplorer";
import { SensorSelector } from "@/components/SensorSelector";
import { loadDataset, type Dataset } from "@/lib/data";
import { SelectionProvider, useSelection } from "@/lib/selection";

// MapLibre needs the browser (WebGL), so it is loaded on the client only.
const FireMap = dynamic(() => import("@/components/FireMap").then((m) => m.FireMap), {
  ssr: false,
  loading: () => <div className="h-[22rem] rounded-md border border-line bg-panel sm:h-[28rem] lg:h-[34rem]" />,
});

function DemoBanner({ note }: { note?: string }) {
  return (
    <div role="note" className="demo-stripe border-b border-demo/50 bg-ground">
      <p className="mx-auto max-w-[90rem] px-4 py-2.5 text-sm text-demo sm:px-8">
        <strong>Demonstration data.</strong>{" "}
        {note ?? "These values are synthetic and are not NASA measurements."}
      </p>
    </div>
  );
}

function Explorer({ data }: { data: Dataset }) {
  const { regionId, sensor, period } = useSelection();
  const record = data.monthly.find((r) => r.region_id === regionId && r.sensor === sensor && r.period === period);
  const synthetic = data.metadata.data_status !== "nasa_firms";

  return (
    <>
      {synthetic && <DemoBanner note={data.metadata.data_status_note} />}
      <div className="mx-auto flex max-w-[90rem] flex-col gap-8 px-4 py-6 sm:px-8 sm:py-8">
        <header className="flex flex-wrap items-end justify-between gap-x-10 gap-y-5">
          <div>
            <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">Fire Seasons</h1>
            <p className="mt-1.5 max-w-[60ch] text-soft">
              When did satellites see unusual heat on the ground? Pick a region and a sensor, then a month.
            </p>
          </div>
          <div className="flex flex-wrap items-end gap-x-6 gap-y-4">
            <RegionSelector regions={data.metadata.regions} />
            <SensorSelector />
          </div>
        </header>

        <main className="grid gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)] lg:gap-10">
          <BurningCalendar monthly={data.monthly} />
          <FireMap regions={data.metadata.regions} hotspots={data.hotspots} record={record} synthetic={synthetic} />
          <div className="lg:col-span-2">
            <MonthReadout metadata={data.metadata} record={record} />
          </div>
          <div className="lg:col-span-2">
            <SensorAgreementExplorer monthly={data.monthly} />
          </div>
          <div className="lg:col-span-2">
            <EnvironmentalContext weather={data.weather} />
          </div>
          <EvidenceInspector metadata={data.metadata} record={record} />
          <ExportControls metadata={data.metadata} monthly={data.monthly} hotspots={data.hotspots} />
        </main>

        <footer className="border-t border-line pt-5 text-sm text-muted">
          <h2 className="font-bold text-soft">What this data can and cannot say</h2>
          <ul className="mt-2 flex max-w-[80ch] list-disc flex-col gap-1 pl-5">
            {data.metadata.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
          <p className="mt-4">Frontera Signal, Tijuana. NASA Space Apps Challenge 2026.</p>
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
