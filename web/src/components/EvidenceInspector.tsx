"use client";

import type { Metadata, MetricKey, MonthlyRecord } from "@/lib/contract";
import { fmtInt } from "@/lib/data";
import { useSelection } from "@/lib/selection";

const METRICS: MetricKey[] = ["hotspot_count", "frp_sum_mw", "active_cells", "percentile_vs_reference"];

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-muted">{label}</dt>
      <dd className="text-soft">{children}</dd>
    </>
  );
}

/** Where the numbers on screen come from: files, versions, definitions and the raw record. */
export function EvidenceInspector({ metadata, record }: { metadata: Metadata; record: MonthlyRecord | undefined }) {
  const { regionId, sensor } = useSelection();
  const region = metadata.regions.find((r) => r.region_id === regionId) ?? metadata.regions[0];
  const cov = metadata.sensors[sensor];
  const synthetic = metadata.data_status !== "nasa_firms";
  const files = metadata.input_files.filter((f) => f.sensor === sensor);

  return (
    <section aria-labelledby="evidence-title" className="flex flex-col gap-5">
      <div>
        <h2 id="evidence-title" className="font-display text-xl font-semibold">
          Evidence for these figures
        </h2>
        <p className="mt-1 max-w-[68ch] text-sm text-soft">
          {synthetic
            ? "This dataset is synthetic. It exists to test the interface and traces back to a generator script, not to NASA files."
            : "Every figure traces back to the NASA FIRMS files listed here."}
        </p>
      </div>

      <dl className="grid gap-x-6 gap-y-2 text-sm sm:grid-cols-[max-content_1fr]">
        <Row label="Data status">
          <span className={synthetic ? "font-bold text-demo" : "font-bold text-ink"}>
            {synthetic ? "Synthetic demonstration data" : "NASA FIRMS data"}
          </span>{" "}
          <span className="text-muted">({metadata.data_status})</span>
        </Row>
        <Row label="Product">
          {cov.product}, version {record?.product_version ?? cov.product_version}
        </Row>
        <Row label="Platforms">{cov.platforms.join(", ")}</Row>
        <Row label="Nominal pixel">{fmtInt(cov.nominal_resolution_m)} m</Row>
        <Row label="Sensor coverage">
          <span className="tabular">
            {cov.period_min} to {cov.period_max}
          </span>{" "}
          (UTC months)
        </Row>
        <Row label="Region">
          {region.name}. Bounding box W {region.bbox[0]}, S {region.bbox[1]}, E {region.bbox[2]}, N {region.bbox[3]}.{" "}
          {region.boundary_note}
        </Row>
        <Row label="Grid">{metadata.grid.description}</Row>
        <Row label="Reference period">
          <span className="tabular">
            {metadata.reference_period.start} to {metadata.reference_period.end}
          </span>
          . {metadata.reference_period.description}
        </Row>
        <Row label="Pipeline">
          {metadata.pipeline_version}, run <span className="tabular">{metadata.run_timestamp_utc}</span>, data contract{" "}
          {metadata.contract_version}
        </Row>
      </dl>

      <div>
        <h3 className="font-bold text-soft">{sensor} input files</h3>
        {files.length === 0 ? (
          <p className="mt-1.5 max-w-[68ch] text-sm text-muted">
            {synthetic
              ? "None. Synthetic fixtures have no NASA input files. When the real pipeline output is loaded, each file appears here with its SHA-256 checksum and the number of rows validation removed."
              : `The metadata lists no ${sensor} input files, so these figures cannot be traced to a file. Treat them as unverified.`}
          </p>
        ) : (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[44rem] border-collapse text-left text-sm">
              <thead className="text-muted">
                <tr className="border-b border-line">
                  <th className="py-2 pr-4 font-normal">File</th>
                  <th className="py-2 pr-4 text-right font-normal">Rows read</th>
                  <th className="py-2 pr-4 text-right font-normal">Rows valid</th>
                  <th className="py-2 pr-4 font-normal">Rows dropped, by reason</th>
                  <th className="py-2 pr-4 text-right font-normal">Duplicates removed</th>
                  <th className="py-2 font-normal">SHA-256</th>
                </tr>
              </thead>
              <tbody className="text-soft">
                {files.map((f) => (
                  <tr key={f.sha256} className="border-b border-line align-top">
                    <td className="py-2 pr-4">{f.source_file}</td>
                    <td className="tabular py-2 pr-4 text-right">{fmtInt(f.rows_read)}</td>
                    <td className="tabular py-2 pr-4 text-right">{fmtInt(f.rows_valid)}</td>
                    <td className="py-2 pr-4">
                      {Object.entries(f.dropped).map(([reason, n]) => `${reason}: ${n}`).join("; ") || "None"}
                    </td>
                    <td className="tabular py-2 pr-4 text-right">{fmtInt(f.duplicates_removed)}</td>
                    <td className="break-all py-2 font-mono text-xs">{f.sha256}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <details className="rounded-md border border-line bg-panel">
        <summary className="cursor-pointer px-4 py-3 font-bold text-soft">How each figure is defined</summary>
        <dl className="grid gap-x-6 gap-y-3 border-t border-line px-4 py-4 text-sm sm:grid-cols-[max-content_1fr]">
          {METRICS.map((k) => {
            const m = metadata.metrics[k];
            return (
              <Row key={k} label={m.label}>
                {m.metric_kind === "raw" ? "Raw" : "Derived"}, in {m.unit}. {m.description}{" "}
                <span className="text-muted">Field: {k}</span>
              </Row>
            );
          })}
        </dl>
      </details>

      <details className="rounded-md border border-line bg-panel">
        <summary className="cursor-pointer px-4 py-3 font-bold text-soft">Record for the selected month, as delivered</summary>
        <pre className="overflow-x-auto border-t border-line px-4 py-4 text-xs leading-relaxed text-soft">
          {record ? JSON.stringify(record, null, 2) : "No record for this region, sensor and month in monthly.json."}
        </pre>
      </details>
    </section>
  );
}
