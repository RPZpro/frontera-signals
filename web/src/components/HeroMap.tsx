"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HotspotFeature, Region } from "@/lib/contract";
import { BASE_STYLE, GROUND, HAS_CARTO_BASEMAP, regionOutline, WORKER_URL } from "@/lib/mapStyle";

maplibregl.setWorkerUrl(WORKER_URL);

/**
 * Full-bleed map for the cover's featured series and month.
 */
export function HeroMap({ regions, features, color }: { regions: Region[]; features: HotspotFeature[]; color: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({ container: container.current, style: BASE_STYLE, scrollZoom: false, dragRotate: false, attributionControl: false });
    } catch {
      return; // no WebGL: the cover still works as plain text on the dark ground
    }
    if (HAS_CARTO_BASEMAP) map.addControl(new maplibregl.AttributionControl({ compact: false }), "top-right");
    const fit = () => {
      const w = Math.min(...regions.map((r) => r.bbox[0]));
      const s = Math.min(...regions.map((r) => r.bbox[1]));
      const e = Math.max(...regions.map((r) => r.bbox[2]));
      const n = Math.max(...regions.map((r) => r.bbox[3]));
      const el = map.getContainer();
      const wide = el.clientWidth >= 1024;
      // keep the points clear of the headline: right half on wide screens, top half on phones
      map.fitBounds([[w, s], [e, n]], {
        padding: wide
          ? { left: el.clientWidth * 0.42, right: 48, top: 64, bottom: 96 }
          : { left: 20, right: 20, top: 28, bottom: el.clientHeight * 0.55 },
        duration: 0,
      });
    };
    map.once("style.load", () => {
      map.addSource("outline", { type: "geojson", data: regionOutline(regions[0]) });
      map.addLayer({ id: "outline", type: "line", source: "outline", paint: { "line-color": "#8798ad", "line-opacity": 0.7 } });
      map.addSource("hot", { type: "geojson", data: { type: "FeatureCollection", features } as GeoJSON.FeatureCollection });
      map.addLayer({
        id: "glow",
        type: "circle",
        source: "hot",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "frp_mw"]], 0, 10, 10, 30],
          "circle-color": color,
          "circle-blur": 1,
          "circle-opacity": 0.45,
        },
      });
      map.addLayer({
        id: "core",
        type: "circle",
        source: "hot",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "frp_mw"]], 0, 2.5, 10, 7],
          "circle-color": color,
          "circle-stroke-color": GROUND,
          "circle-stroke-width": 1,
        },
      });
      if (HAS_CARTO_BASEMAP) map.addLayer({ id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.55 } });
      fit();
    });
    map.on("resize", fit);
    return () => map.remove();
  }, [regions, features, color]);

  return <div ref={container} role="application" aria-label="Map of the featured month" className="h-full w-full" />;
}
