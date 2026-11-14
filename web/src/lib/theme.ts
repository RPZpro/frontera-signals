import type { Sensor } from "./contract";

/**
 * Sensor identity colours. Each sensor owns one hue everywhere (marks, calendar
 * ramp, selector), so MODIS and VIIRS values are never read on a shared scale.
 * The pair passes the dataviz palette validator on the dark surface.
 */
export const SENSOR_COLOR: Record<Sensor, string> = {
  MODIS: "#3987b8",
  VIIRS: "#c47b1c",
};

/** Sequential ramps, one hue per sensor, dark to bright. Index 0 is the lowest non-zero step. */
export const SENSOR_RAMP: Record<Sensor, string[]> = {
  MODIS: ["#1c3549", "#235474", "#2f78a6", "#56a6d6", "#a9daf5"],
  VIIRS: ["#3f2b16", "#6d4417", "#a26118", "#d98d24", "#f8c96e"],
};

export const SENSOR_BLURB: Record<Sensor, string> = {
  MODIS: "1 km pixels",
  VIIRS: "375 m pixels",
};
