"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { Sensor } from "./contract";
import { indexMonthly, toPeriod, yearsIn, type Dataset } from "./data";

export const TABS = ["explore", "sensors", "weather", "evidence", "method"] as const;
export type Tab = (typeof TABS)[number];

/** The four values every component reacts to, plus the open tab. */
export interface Selection {
  regionId: string;
  sensor: Sensor;
  year: number;
  /** 1–12 */
  month: number;
  tab: Tab;
}

interface SelectionContextValue extends Selection {
  period: string;
  setRegion: (regionId: string) => void;
  setSensor: (sensor: Sensor) => void;
  setPeriod: (year: number, month: number) => void;
  setTab: (tab: Tab) => void;
}

const SelectionContext = createContext<SelectionContextValue | null>(null);

function defaultSelection(data: Dataset): Selection {
  const regionId = data.metadata.regions[0].region_id;
  const sensor = data.sensors.find((s) => s !== "MODIS") ?? data.sensors[0];
  const years = yearsIn(data.monthly);
  const year = years[years.length - 1];
  // open on the busiest month of the latest year so the map is not empty
  let month = 1;
  let best = -1;
  for (const [period, rec] of indexMonthly(data.monthly, regionId, sensor)) {
    if (Number(period.slice(0, 4)) === year && (rec.hotspot_count ?? -1) > best) {
      best = rec.hotspot_count ?? -1;
      month = Number(period.slice(5));
    }
  }
  return { regionId, sensor, year, month, tab: "explore" };
}

function fromUrl(data: Dataset, fallback: Selection): Selection {
  const q = new URLSearchParams(window.location.search);
  const region = q.get("region");
  const requested = q.get("sensor");
  const sensor = requested === "VIIRS" && !data.sensors.includes("VIIRS") ? "VIIRS_SNPP" : requested;
  const [y, m] = (q.get("period") ?? "").split("-").map(Number);
  const years = yearsIn(data.monthly);
  return {
    regionId: data.metadata.regions.some((r) => r.region_id === region) ? (region as string) : fallback.regionId,
    sensor: data.sensors.includes(sensor as Sensor) ? (sensor as Sensor) : fallback.sensor,
    year: years.includes(y) ? y : fallback.year,
    month: years.includes(y) && Number.isInteger(m) && m >= 1 && m <= 12 ? m : fallback.month,
    tab: TABS.includes(q.get("tab") as Tab) ? (q.get("tab") as Tab) : fallback.tab,
  };
}

export function SelectionProvider({ data, children }: { data: Dataset; children: ReactNode }) {
  const [sel, setSel] = useState<Selection>(() => defaultSelection(data));
  const [hydrated, setHydrated] = useState(false);

  // Read a shared link once on mount, then keep the URL in step with the selection.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- one-time sync from the browser URL
    setSel((current) => fromUrl(data, current));
    setHydrated(true);
  }, [data]);

  useEffect(() => {
    if (!hydrated) return;
    const q = new URLSearchParams({ region: sel.regionId, sensor: sel.sensor, period: toPeriod(sel.year, sel.month), tab: sel.tab });
    window.history.replaceState(null, "", `?${q.toString()}`);
  }, [sel, hydrated]);

  const setRegion = useCallback((regionId: string) => setSel((s) => ({ ...s, regionId })), []);
  const setSensor = useCallback((sensor: Sensor) => setSel((s) => ({ ...s, sensor })), []);
  const setPeriod = useCallback((year: number, month: number) => setSel((s) => ({ ...s, year, month })), []);

  const setTab = useCallback((tab: Tab) => setSel((s) => ({ ...s, tab })), []);

  const value = useMemo(
    () => ({ ...sel, period: toPeriod(sel.year, sel.month), setRegion, setSensor, setPeriod, setTab }),
    [sel, setRegion, setSensor, setPeriod, setTab],
  );
  return <SelectionContext.Provider value={value}>{children}</SelectionContext.Provider>;
}

export function useSelection(): SelectionContextValue {
  const ctx = useContext(SelectionContext);
  if (!ctx) throw new Error("useSelection must be used inside <SelectionProvider>.");
  return ctx;
}
