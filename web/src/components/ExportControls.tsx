"use client";

import { SENSOR_LABEL, type HotspotFeature, type Metadata, type MonthlyRecord, type WeatherFile } from "@/lib/contract";
import { download, evidenceReportHtml, exportName, hotspotsCsv, monthlyCsv } from "@/lib/export";
import type { EnvironmentalAnalysis } from "@/lib/environmentalAnomaly";
import { useSelection } from "@/lib/selection";

interface Props {
  metadata: Metadata;
  monthly: MonthlyRecord[];
  features: HotspotFeature[] | null;
  weather: WeatherFile | null;
  analysis: EnvironmentalAnalysis;
  pointsFailed: boolean;
}

const button =
  "h-11 rounded-md border border-line bg-raised px-4 text-left text-sm font-bold text-ink hover:border-soft disabled:cursor-not-allowed disabled:font-normal disabled:text-muted disabled:hover:border-line";

/** Downloads for exactly what is on screen: same region, sensor and month. */
export function ExportControls({ metadata, monthly, features, weather, analysis, pointsFailed }: Props) {
  const { regionId, sensor, year, month, period } = useSelection();
  const region = metadata.regions.find((r) => r.region_id === regionId) ?? metadata.regions[0];
  const records = monthly.filter((r) => r.region_id === regionId && r.sensor === sensor);
  const record = records.find((r) => r.period === period);

  return (
    <section aria-labelledby="export-title" className="flex flex-col gap-3">
      <h2 id="export-title" className="font-display text-xl font-semibold">
        Export this view
      </h2>
      <div className="flex flex-wrap gap-2.5">
        <button
          type="button"
          className={button}
          disabled={!record}
          onClick={() => record && download(exportName(metadata, [regionId, sensor, period, "monthly"], "csv"), monthlyCsv(metadata, [record]), "text/csv")}
        >
          Download selected month (CSV)
        </button>
        <button
          type="button"
          className={button}
          disabled={!features?.length}
          onClick={() => features && download(exportName(metadata, [regionId, sensor, period, "hot-pixels"], "csv"), hotspotsCsv(metadata, features), "text/csv")}
        >
          {!features ? (pointsFailed ? "Hotspot locations unavailable" : "Loading hotspot locations…")
            : features.length === 0 ? "No hot pixels to download for this month" : `Download ${features.length} hot pixels (CSV)`}
        </button>
        <button
          type="button"
          className={button}
          onClick={() =>
            download(
              exportName(metadata, [regionId, sensor, period, "evidence-report"], "html"),
              evidenceReportHtml({ metadata, region, sensor, year, month, records, record, weather, analysis, viewUrl: window.location.href }),
              "text/html",
            )
          }
        >
          Download evidence report (printable HTML)
        </button>
      </div>
      <p className="max-w-[68ch] text-sm text-muted">
        CSVs cover {region.name} and {SENSOR_LABEL[sensor]}. The report also compares seasonal classifications across series.
        {metadata.data_status !== "nasa_firms" && " Every file is marked as synthetic demo data in its name and contents."}
      </p>
    </section>
  );
}
