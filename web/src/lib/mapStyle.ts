import type { StyleSpecification } from "maplibre-gl";
import type { Region } from "./contract";

export const GROUND = "#07101b";

const carto = (layer: string) => ["a", "b", "c", "d"].map((s) => `https://${s}.basemaps.cartocdn.com/${layer}/{z}/{x}/{y}.png`);

/**
 * Inline style: the data layers still draw on the plain background if the free
 * raster basemap is unreachable. The "labels" source is added by each map above its data.
 */
export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    basemap: { type: "raster", tiles: carto("dark_nolabels"), tileSize: 256, maxzoom: 19, attribution: "© OpenStreetMap contributors © CARTO" },
    labels: { type: "raster", tiles: carto("dark_only_labels"), tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": GROUND } },
    { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.8 } },
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
