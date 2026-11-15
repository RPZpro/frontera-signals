"use client";

import { useEffect, useState } from "react";
import type { HotspotCollection, Metadata } from "./contract";
import { loadHotspots } from "./data";

type Result = { year: number; data: HotspotCollection | null; error: boolean };

export function useHotspots(metadata: Metadata, year: number, enabled = true) {
  const [result, setResult] = useState<Result | null>(null);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    loadHotspots(metadata, year).then(
      (data) => { if (active) setResult({ year, data, error: false }); },
      () => { if (active) setResult({ year, data: null, error: true }); },
    );
    return () => { active = false; };
  }, [metadata, year, enabled, attempt]);
  return {
    data: result?.year === year ? result.data : null,
    error: result?.year === year && result.error,
    retry: () => { setResult(null); setAttempt((value) => value + 1); },
  };
}
