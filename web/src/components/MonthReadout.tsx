"use client";

import { SENSOR_LABEL, type Metadata, type MetricKey, type MonthlyRecord } from "@/lib/contract";
import { fmtInt, MONTHS_LONG } from "@/lib/data";
import { useSelection } from "@/lib/selection";

const ORDER: MetricKey[] = ["hotspot_count", "frp_sum_mw", "active_cells", "percentile_vs_reference"];

function format(key: MetricKey, value: number): string {
  if (key === "frp_sum_mw") return value.toLocaleString("en-US", { maximumFractionDigits: 1 });
  if (key === "percentile_vs_reference") return value.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return fmtInt(value);
}

/** Figures for the selected month, each with its unit and whether it is raw or derived. */
export function MonthReadout({ metadata, record }: { metadata: Metadata; record: MonthlyRecord | undefined }) {
  const { sensor, year, month } = useSelection();
  const coverage = metadata.sensors[sensor];
  const quality =
    !record || record.quality === "no_data"
      ? "No data for this month"
      : record.quality === "partial_coverage"
        ? "Partial coverage: the month is incomplete, so figures are a lower bound"
        : "Full month";

  return (
    <section aria-labelledby="readout-title" className="rounded-md border border-line bg-panel p-5">
      <h2 id="readout-title" className="font-display text-xl font-semibold">
        {SENSOR_LABEL[sensor]} in {MONTHS_LONG[month - 1]} {year}
      </h2>
      <p className="mt-1 text-sm text-soft">{quality}</p>

      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-5 lg:grid-cols-4">
        {ORDER.map((key) => {
          const m = metadata.metrics[key];
          const value = record ? record[key] : null;
          return (
            <div key={key}>
              <dt className="text-sm text-muted">{m.label}</dt>
              <dd className="tabular mt-1 font-display text-3xl font-semibold">
                {value === null ? (
                  <span className="text-xl font-normal text-muted">Not available</span>
                ) : (
                  <>
                    {format(key, value)}
                    <span className="ml-1.5 font-sans text-sm font-normal text-soft">{m.unit}</span>
                  </>
                )}
              </dd>
              <dd className="mt-1 text-xs text-muted">
                {m.metric_kind === "raw" ? "Raw" : "Derived"}. {m.description}
              </dd>
            </div>
          );
        })}
      </dl>

      <dl className="mt-6 grid gap-x-6 gap-y-2 border-t border-line pt-4 text-sm sm:grid-cols-[auto_1fr]">
        <dt className="text-muted">Source</dt>
        <dd className="text-soft">{record?.source ?? "Not available"}</dd>
        <dt className="text-muted">Product</dt>
        <dd className="text-soft">
          {coverage.product}, version {record?.product_version ?? coverage.product_version}, {coverage.platforms.join(" and ")},{" "}
          {coverage.nominal_resolution_m} m nominal pixel
        </dd>
        <dt className="text-muted">Coverage</dt>
        <dd className="tabular text-soft">
          {coverage.period_min} to {coverage.period_max} (UTC months)
        </dd>
        <dt className="text-muted">Reference</dt>
        <dd className="text-soft">
          {metadata.reference_period.description}
          {record?.seasonal && ` ${record.seasonal.label}. ${record.seasonal.n_ref} comparison years.`}
        </dd>
      </dl>
    </section>
  );
}
