import type { StyleSpecification } from "maplibre-gl";
import type { Region } from "./contract";

export const GROUND = "#07101b";
export const HAS_CARTO_BASEMAP = true;

export type MapModeId = "dark" | "satellite" | "topo" | "streets";

export interface MapMode {
  id: MapModeId;
  label: string;
  baseTiles: string[];
  labelTiles?: string[];
}

const ESRI_ATTR = "Tiles &copy; Esri, Maxar, Earthstar Geographics, and the GIS User Community";

export const MAP_MODES: MapMode[] = [
  {
    id: "dark",
    label: "Dark",
    baseTiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"],
    labelTiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Reference/MapServer/tile/{z}/{y}/{x}"],
  },
  {
    id: "satellite",
    label: "Satellite",
    baseTiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"],
    labelTiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}"],
  },
  {
    id: "topo",
    label: "Terrain",
    baseTiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}"],
  },
  {
    id: "streets",
    label: "Streets",
    baseTiles: ["https://server.arcgisonline.com/ArcGIS/rest/services/World_Street_Map/MapServer/tile/{z}/{y}/{x}"],
  },
];

export const BASE_STYLE: StyleSpecification = {
  version: 8,
  sources: {
    basemap: { type: "raster", tiles: MAP_MODES[0].baseTiles, tileSize: 256, maxzoom: 19, attribution: ESRI_ATTR },
    labels: { type: "raster", tiles: MAP_MODES[0].labelTiles!, tileSize: 256, maxzoom: 19 },
  },
  layers: [
    { id: "ground", type: "background", paint: { "background-color": GROUND } },
    { id: "basemap", type: "raster", source: "basemap", paint: { "raster-opacity": 0.92 } },
  ],
};

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
