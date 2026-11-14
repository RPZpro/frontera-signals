"use client";

import type { Region } from "@/lib/contract";
import { useSelection } from "@/lib/selection";

export function RegionSelector({ regions }: { regions: Region[] }) {
  const { regionId, setRegion } = useSelection();
  return (
    <label className="flex flex-col gap-1.5 text-sm text-muted">
      Region
      <select
        value={regionId}
        onChange={(e) => setRegion(e.target.value)}
        className="h-11 min-w-56 rounded-md border border-line bg-raised px-3 text-base text-ink"
      >
        {regions.map((r) => (
          <option key={r.region_id} value={r.region_id}>
            {r.name}
          </option>
        ))}
      </select>
    </label>
  );
}
