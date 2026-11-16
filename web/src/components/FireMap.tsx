"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import * as maplibregl from "maplibre-gl";
import type { GeoJSONSource, RasterTileSource } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { SENSOR_LABEL, type HotspotFeature, type HotspotProperties, type MonthlyRecord, type Region } from "@/lib/contract";
import { fmtInt, MONTHS_LONG } from "@/lib/data";
import { BASE_STYLE, GROUND, MAP_MODES, type MapModeId, regionOutline, WORKER_URL } from "@/lib/mapStyle";
import { useSelection } from "@/lib/selection";
import { SENSOR_COLOR } from "@/lib/theme";

maplibregl.setWorkerUrl(WORKER_URL);

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c] as string);

interface Props {
  regions: Region[];
  features: HotspotFeature[] | null;
  pointsFailed: boolean;
  record: MonthlyRecord | undefined;
  synthetic: boolean;
}

export function FireMap({ regions, features, pointsFailed, record, synthetic }: Props) {
  const { regionId, sensor, year, month } = useSelection();
  const label = SENSOR_LABEL[sensor];
  const container = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const [failed, setFailed] = useState<string | null>(null);
  const [basemapFailed, setBasemapFailed] = useState(false);
  const [mapMode, setMapMode] = useState<MapModeId>("dark");

  const region = regions.find((r) => r.region_id === regionId) ?? regions[0];

  const visible = useMemo<GeoJSON.FeatureCollection>(
    () => ({ type: "FeatureCollection", features: features ?? [] }),
    [features],
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
    map.on("error", (event) => {
      if ("sourceId" in event && (event.sourceId === "basemap" || event.sourceId === "labels")) setBasemapFailed(true);
    });
    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
    map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

    map.once("style.load", () => {
      map.addSource("region", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addSource("hotspots", { type: "geojson", data: { type: "FeatureCollection", features: [] } });
      map.addLayer({
        id: "region-outline",
        type: "line",
        source: "region",
        paint: { "line-color": "#e2e8f0", "line-width": 1.75, "line-dasharray": [4, 3], "line-opacity": 0.85 },
      });
      map.addLayer({
        id: "hotspots",
        type: "circle",
        source: "hotspots",
        paint: {
          "circle-radius": ["interpolate", ["linear"], ["sqrt", ["get", "frp_mw"]], 0, 3.5, 10, 10],
          "circle-color": ["match", ["get", "sensor"], "MODIS", SENSOR_COLOR.MODIS, "VIIRS_NOAA20", SENSOR_COLOR.VIIRS_NOAA20, SENSOR_COLOR.VIIRS],
          "circle-opacity": 0.88,
          "circle-stroke-color": GROUND,
          "circle-stroke-width": 1.5,
        },
      });
      map.addLayer({ id: "labels", type: "raster", source: "labels", paint: { "raster-opacity": 0.9 } });

      map.on("mouseenter", "hotspots", () => (map.getCanvas().style.cursor = "pointer"));
      map.on("mouseleave", "hotspots", () => (map.getCanvas().style.cursor = ""));
      map.on("click", "hotspots", (e) => {
        const f = e.features?.[0];
        if (!f || f.geometry.type !== "Point") return;
        const p = f.properties as HotspotProperties;
        const html = [
          `<strong>${esc(SENSOR_LABEL[p.sensor])} hot pixel</strong> (${esc(p.platform)})`,
          `${esc(p.acq_datetime_utc.replace("T", " ").replace(/(:00)?Z$/, ""))} UTC, ${p.daynight === "D" ? "day" : "night"}`,
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
    const mode = MAP_MODES.find((m) => m.id === mapMode) ?? MAP_MODES[0];
    const baseSrc = map.getSource("basemap") as RasterTileSource | undefined;
    const labelSrc = map.getSource("labels") as RasterTileSource | undefined;
    if (baseSrc) baseSrc.setTiles(mode.baseTiles);
    if (labelSrc) {
      if (mode.labelTiles) {
        labelSrc.setTiles(mode.labelTiles);
        map.setLayoutProperty("labels", "visibility", "visible");
      } else {
        map.setLayoutProperty("labels", "visibility", "none");
      }
    }
  }, [ready, mapMode]);

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
    ? `No ${label} data for ${monthLabel}.`
    : !features ? (pointsFailed ? "Hotspot locations unavailable" : "Loading hotspot locations...")
      : features.length === 0 ? `${label} recorded no detections in ${monthLabel}.` : null;

  return (
    <section aria-labelledby="map-title" className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1">
        <h2 id="map-title" className="font-display text-xl font-semibold">
          {region.name}, {monthLabel}
        </h2>
        <p className="tabular flex items-center gap-2 text-sm text-soft">
          <span aria-hidden className="size-3 rounded-full" style={{ background: SENSOR_COLOR[sensor] }} />
          {noData ? `${label}: no data` : `${fmtInt(features ? features.length : record.hotspot_count!)} ${label} hot pixels`}
        </p>
      </div>

      <div className="relative h-[22rem] overflow-hidden rounded-md border border-line bg-panel sm:h-[28rem] lg:h-[34rem]">
        <div ref={container} className="h-full w-full" role="application" aria-label={`Map of ${sensor} hot pixels in ${region.name}, ${monthLabel}`} />

        {ready && (
          <div
            role="group"
            aria-label="Map style"
            className="absolute bottom-8 right-2 z-10 flex overflow-hidden rounded-md border border-line bg-ground/90 shadow-md backdrop-blur-sm"
          >
            {MAP_MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                aria-pressed={mapMode === m.id}
                onClick={() => setMapMode(m.id)}
                className={`px-2.5 py-1 text-xs font-medium transition-colors ${
                  mapMode === m.id
                    ? "bg-ink text-ground"
                    : "text-soft hover:bg-raised hover:text-ink"
                }`}
              >
                {m.label}
              </button>
            ))}
          </div>
        )}

        {!ready && !failed && (
          <p className="absolute inset-0 grid place-items-center text-sm text-muted">Loading map...</p>
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
        nothing about cause. Dates are UTC. {region.boundary_note ?? "The dashed box marks the approximate region."}
        {basemapFailed && " Some basemap tiles are unavailable. The regional outline and hotspot layers are local."}
      </p>
    </section>
  );
}

