"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import type { HotspotCollection, HotspotProperties, MonthlyRecord, Region } from "@/lib/contract";
import { fmtInt, MONTHS_LONG } from "@/lib/data";
import { BASE_STYLE, GROUND, WORKER_URL } from "@/lib/mapStyle";
import { useSelection } from "@/lib/selection";
import { SENSOR_COLOR } from "@/lib/theme";

maplibregl.setWorkerUrl(WORKER_URL);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

function regionOutline(region: Region): GeoJSON.Feature {
  const [w, s, e, n] = region.bbox;
  return {
    type: "Feature",
    properties: {},
    geometry: { type: "LineString", coordinates: [[w, s], [e, s], [e, n], [w, n], [w, s]] },
  };
}

interface Props {
  regions: Region[];
  hotspots: HotspotCollection;
  /** Monthly record for the current selection, used to tell "zero" from "no data". */
  record: MonthlyRecord | undefined;
  synthetic: boolean;
}

export function FireMap({ regions, hotspots, record, synthetic }: Props) {
  const { regionId, sensor, year, month, period } = useSelection();
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);

  const region = regions.find((r) => r.region_id === regionId) ?? regions[0];

  // Only the selected region, sensor and UTC month ever reach the map source.
  const visible = useMemo<GeoJSON.FeatureCollection>(
    () => ({
      type: "FeatureCollection",
      features: hotspots.features.filter(
        (f) =>
          f.properties.region_id === regionId &&
          f.properties.sensor === sensor &&
          f.properties.acq_datetime_utc.startsWith(period),
      ),
    }),
    [hotspots, regionId, sensor, period],
  );

  useEffect(() => {
    if (!container.current) return;
    let map: maplibregl.Map;
    try {
      map = new maplibregl.Map({
        container: container.current,
        style: BASE_STYLE,
        center: [-116.3, 32.2],
        zoom: 7,
        attributionControl: { compact: true },
      });
    } catch (err) {
      // eslint-disable-next-line react-hooks/set-state-in-effect -- report a WebGL start-up failure
      setFailed(err instanceof Error ? err.message : "WebGL is not available in this browser.");
      return;
    }
    mapRef.current = map;
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.on("load", () => {
      map.addSource("region", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("hotspots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "region-outline",
        type: "line",
        source: "region",
        paint: { "line-color": "#b6c3d3", "line-width": 1, "line-dasharray": [3, 3], "line-opacity": 0.7 },
      });
      map.addLayer({
        id: "hotspots",
        type: "circle",
        source: "hotspots",
        paint: {
          // area grows with fire radiative power; the ring separates overlapping pixels
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "frp_mw"]], 0, 3, 10, 9],
          "circle-color": ["match", ["get", "sensor"], "MODIS", SENSOR_COLOR.MODIS, SENSOR_COLOR.VIIRS],
          "circle-opacity": 0.85,
          "circle-stroke-color": GROUND,
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({ id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.8 } });

      map.on("mouseenter", "hotspots", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "hotspots", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "hotspots", (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const p = f.properties as HotspotProperties;
        const html = [
          `<strong>${esc(p.sensor)} hot pixel</strong> (${esc(p.platform)})`,
          `${esc(p.acq_datetime_utc.replace("T", " ").replace(":00Z", ""))} UTC, ${p.daynight === "D" ? "day" : "night"}`,
          `Fire radiative power: ${Number(p.frp_mw).toFixed(1)} MW`,
          `Confidence: ${esc(p.confidence_class)} (as distributed: ${esc(String(p.confidence_raw))})`,
          `Product version: ${esc(String(p.version))}`,
          synthetic ? `<em>Synthetic demo point, not a NASA measurement</em>` : `Source file: ${esc(p.source_file)}`,
        ].join("<br>");
        new maplibregl.Popup({ maxWidth: "280px" })
          .setLngLat(f.geometry.coordinates as [number, number])
          .setHTML(html)
          .addTo(map);
      });
      setReady(true);
    });

    return () => {
      mapRef.current = null;
      map.remove();
    };
  }, [synthetic]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("hotspots") as GeoJSONSource).setData(visible);
  }, [ready, visible]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource("region") as GeoJSONSource).setData(regionOutline(region));
    const [w, s, e, n] = region.bbox;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    map.fitBounds([[w, s], [e, n]], { padding: 36, duration: reduce ? 0 : 600 });
  }, [ready, region]);

  const noData = !record || record.quality === "no_data" || record.hotspot_count === null;
  const monthLabel = `${MONTHS_LONG[month - 1]} ${year}`;
  const status = noData
    ? `No ${sensor} data for ${monthLabel}. This is a gap in the record, not zero detections.`
    : visible.features.length === 0
      ? `${sensor} recorded no detections in ${monthLabel}. No detection does not mean no fire.`
      : null;

  return (
    <section aria-labelledby="map-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="map-title" className="font-display text-xl font-semibold">
          {region.name}, {monthLabel}
        </h2>
        <p className="tabular flex items-center gap-2 text-sm text-soft">
          <span aria-hidden className="size-3 rounded-full" style={{ background: SENSOR_COLOR[sensor] }} />
          {noData ? `${sensor}: no data` : `${fmtInt(visible.features.length)} ${sensor} hot pixels`}
        </p>
      </div>

      <div className="relative h-[22rem] overflow-hidden rounded-md border border-line bg-panel sm:h-[28rem] lg:h-[34rem]">
        <div ref={container} className="h-full w-full" role="application" aria-label={`Map of ${sensor} hot pixels in ${region.name}, ${monthLabel}`} />
        {!ready && !failed && (
          <p className="absolute inset-0 grid place-items-center text-sm text-muted">Loading map…</p>
        )}
        {failed && (
          <p role="alert" className="absolute inset-0 grid place-items-center p-6 text-center text-sm text-soft">
            The map could not start: {failed} The calendar and monthly figures still work.
          </p>
        )}
        {ready && status && (
          <p
            role="status"
            className={`absolute inset-x-3 top-3 mr-12 rounded-md border border-line px-3 py-2 text-sm text-ink ${noData ? "hatch" : "bg-ground/90"}`}
          >
            <span className={noData ? "rounded bg-ground/90 px-1 py-0.5 box-decoration-clone" : ""}>{status}</span>
          </p>
        )}
      </div>
      <p className="max-w-[68ch] text-sm text-muted">
        Each dot is one hot pixel, sized by fire radiative power. A hot pixel is not an independent fire, and it says
        nothing about cause. Dates are UTC. The dashed box is a rough region outline, not an official boundary.
      </p>
    </section>
  );
}
