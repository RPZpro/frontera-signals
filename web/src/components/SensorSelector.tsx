"use client";

import { SENSOR_LABEL, type Sensor } from "@/lib/contract";
import { useSelection } from "@/lib/selection";
import { SENSOR_BLURB, SENSOR_COLOR } from "@/lib/theme";

/**
 * One sensor at a time, on purpose: raw MODIS and VIIRS detections are not
 * comparable, so there is no "both" or "combined" option here.
 */
export function SensorSelector({ sensors }: { sensors: Sensor[] }) {
  const { sensor, setSensor } = useSelection();
  return (
    <fieldset className="flex flex-col gap-1.5">
      <legend className="mb-1.5 text-sm text-muted">Satellite series</legend>
      <div className="flex flex-wrap gap-2">
        {sensors.map((s) => {
          const active = s === sensor;
          return (
            <label
              key={s}
              className={`flex h-11 cursor-pointer items-center gap-2.5 rounded-md border px-3.5 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-2 has-[:focus-visible]:outline-ink ${
                active ? "border-soft bg-raised text-ink" : "border-line text-soft hover:border-muted"
              }`}
            >
              <input
                type="radio"
                name="sensor"
                value={s}
                checked={active}
                onChange={() => setSensor(s)}
                className="sr-only"
              />
              <span aria-hidden className="size-3 rounded-full" style={{ background: SENSOR_COLOR[s] }} />
              <span className="font-bold">{SENSOR_LABEL[s]}</span>
              <span className="hidden text-sm text-muted sm:inline">{SENSOR_BLURB[s]}</span>
            </label>
          );
        })}
      </div>
    </fieldset>
  );
}
