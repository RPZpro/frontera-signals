import type { StyleSpecification } from "maplibre-gl";
import type { Region } from "./contract";

export const GROUND = "#07101b";

const cartoKey = process.env.NEXT_PUBLIC_CARTO_BASEMAP_KEY?.trim();
export const HAS_CARTO_BASEMAP = Boolean(cartoKey);
const carto = (layer: string) => [
  `https://basemaps.cartocdn.com/${layer}/{z}/{x}/{y}.png?key=${encodeURIComponent(cartoKey ?? "")}`,
];
const attribution = '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap contributors</a>, © <a href="https://carto.com/attribution/">CARTO</a>';

/**
 * Inline style: the data layers still draw on the plain background if the free
 * raster basemap is unreachable. The "labels" source is added by each map above its data.
 */
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: HAS_CARTO_BASEMAP ? {
    basemap: { type: "raster", tiles: carto("dark_nolabels"), tileSize: 256, maxzoom: 19, attribution },
    labels: { type: "raster", tiles: carto("dark_only_labels"), tileSize: 256, maxzoom: 19 },
  } : {},
  layers: [
    { id: "ground", type: "background", paint: { "background-color": GROUND } },
    ...(HAS_CARTO_BASEMAP ? [{ id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.8 } } as const] : []),
  ],
};

/** See scripts/copy-maplibre-worker.mjs. */
export const WORKER_URL = "/vendor/maplibre/maplibre-gl-worker.mjs";

export function regionOutline(region: Region): GeoJSON.FeatureCollection {
  if (region.boundary) return region.boundary;
  const [w, s, e, n] = region.bbox;
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: {},
      geometry: { type: "LineString", coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
    }],
  };
}
