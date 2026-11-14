"use client";

import { useEffect, useRef } from "react";
import * as maplibregl from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HotspotFeature, Region } from "@/lib/contract";
import { BASE_STYLE, GROUND, WORKER_URL } from "@/lib/mapStyle";

maplibregl.setWorkerUrl(WORKER_URL);

/**
 * Full-bleed, non-interactive map behind the cover. It draws the same hot
 * pixels the dashboard holds for one sensor and one month: nothing decorative.
 */
export function HeroMap({ regions, features, color }: { regions: Region[]; features: HotspotFeature[]; color: string }) {
  const container = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({ container: container.current, style: BASE_STYLE, interactive: false, attributionControl: { compact: true } });
    } catch {
      return; // no WebGL: the cover still works as plain text on the dark ground
    }
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
    map.on("load", () => {
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
      map.addLayer({ id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.55 } });
      fit();
    });
    map.on("resize", fit);
    return () => map.remove();
  }, [regions, features, color]);

  return <div ref={container} aria-hidden className="h-full w-full" />;
}
