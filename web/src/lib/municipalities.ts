import type { Region } from "./contract";

export interface SubRegion extends Region {
  parentId: string;
}

export const BC_SUBREGIONS: SubRegion[] = [
  {
    region_id: "MX-BCN-TIJ",
    parentId: "MX-BCN",
    name: "Tijuana & Playas de Rosarito",
    bbox: [-117.13, 32.12, -116.55, 32.56],
    boundary_note: "Municipal bounding box covering Tijuana and Playas de Rosarito.",
  },
  {
    region_id: "MX-BCN-TEC",
    parentId: "MX-BCN",
    name: "Tecate",
    bbox: [-116.75, 32.18, -115.75, 32.63],
    boundary_note: "Municipal bounding box covering Tecate and La Rumorosa.",
  },
  {
    region_id: "MX-BCN-ENS",
    parentId: "MX-BCN",
    name: "Ensenada & San Quintín",
    bbox: [-118.37, 28.0, -114.6, 32.22],
    boundary_note: "Municipal bounding box covering Ensenada, Valle de Guadalupe, and San Quintín.",
  },
  {
    region_id: "MX-BCN-MXL",
    parentId: "MX-BCN",
    name: "Mexicali & San Felipe",
    bbox: [-115.85, 30.8, -114.65, 32.72],
    boundary_note: "Municipal bounding box covering Mexicali Valley and San Felipe.",
  },
];

export function findSubRegion(regionId: string): SubRegion | undefined {
  return BC_SUBREGIONS.find((r) => r.region_id === regionId);
}

export function pointInBbox(coords: number[], bbox: [number, number, number, number]): boolean {
  const [lng, lat] = coords;
  const [w, s, e, n] = bbox;
  return lng >= w && lng <= e && lat >= s && lat <= n;
}
