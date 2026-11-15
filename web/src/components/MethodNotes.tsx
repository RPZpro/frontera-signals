"use client";

import { SENSOR_LABEL, type Metadata, type Sensor } from "@/lib/contract";
import { DATA_BASE } from "@/lib/data";
import { SENSOR_COLOR } from "@/lib/theme";

const ABOUT: Record<"MODIS" | "VIIRS", { name: string; text: string }> = {
  MODIS: {
    name: "Moderate Resolution Imaging Spectroradiometer",
    text: "Flies on NASA's Terra and Aqua satellites. Its fire record starts in late 2000, the longest available. Each pixel covers about 1 km on the ground, so small or cool fires can go unseen.",
  },
  VIIRS: {
    name: "Visible Infrared Imaging Radiometer Suite",
    text: "Flies on Suomi NPP and the NOAA-20 and NOAA-21 satellites. Its 375 m record starts in January 2012. Smaller pixels catch smaller and cooler fires, so it reports more hot pixels for the same activity.",
  },
};

const STEPS: { title: string; text: string }[] = [
  { title: "Read the files as NASA distributes them", text: "Each FIRMS file is fingerprinted with a SHA-256 checksum so anyone can confirm it is the same file." },
  { title: "Validate every row", text: "Rows that fail a check are dropped and counted by reason. Nothing is filled in or estimated." },
  { title: "Remove duplicates", text: "Repeated detections are removed and the number removed is reported." },
  { title: "Keep the sensors apart", text: "MODIS and VIIRS detections are never merged into one count." },
  { title: "Summarise by region and month", text: "Counts, summed fire radiative power and the month's rank against its own history. A month without data stays empty; it is never written as zero." },
];

/** Plain-language method: what each sensor is, what the pipeline does, and what the site does not claim. */
export function MethodNotes({ metadata, sensors }: { metadata: Metadata; sensors: Sensor[] }) {
  const synthetic = metadata.data_status !== "nasa_firms";
  return (
    <div className="flex flex-col gap-10">
      <section aria-labelledby="sensors-title" className="flex flex-col gap-4">
        <div>
          <h2 id="sensors-title" className="font-display text-xl font-semibold">
            Two sensors, two different instruments
          </h2>
          <p className="mt-1 max-w-[72ch] text-sm text-soft">
            Both flag pixels that are hotter than their surroundings. They differ in pixel size, sensitivity and the
            time of day they pass overhead, which is why this site never adds their counts together.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          {sensors.map((s) => {
            const cov = metadata.sensors[s];
            return (
              <article key={s} className="rounded-md border border-line bg-panel p-5" style={{ borderTopColor: SENSOR_COLOR[s], borderTopWidth: 3 }}>
                <h3 className="font-display text-2xl font-semibold">{SENSOR_LABEL[s]}</h3>
                <p className="text-sm text-muted">{ABOUT[s === "MODIS" ? "MODIS" : "VIIRS"].name}</p>
                <p className="mt-3 max-w-[60ch] text-sm text-soft">{ABOUT[s === "MODIS" ? "MODIS" : "VIIRS"].text}</p>
                <dl className="mt-4 grid grid-cols-[max-content_1fr] gap-x-5 gap-y-1.5 border-t border-line pt-4 text-sm">
                  <dt className="text-muted">Pixel size</dt>
                  <dd className="tabular text-soft">{cov.nominal_resolution_m.toLocaleString("en-US")} m</dd>
                  <dt className="text-muted">Product in this dataset</dt>
                  <dd className="text-soft">
                    {cov.product}, version {cov.product_version}
                  </dd>
                  <dt className="text-muted">Satellites in this dataset</dt>
                  <dd className="text-soft">{cov.platforms.join(", ")}</dd>
                  <dt className="text-muted">Months covered here</dt>
                  <dd className="tabular text-soft">
                    {cov.period_min} to {cov.period_max}
                  </dd>
                </dl>
              </article>
            );
          })}
        </div>
      </section>

      <section aria-labelledby="pipeline-title" className="flex flex-col gap-4">
        <div>
          <h2 id="pipeline-title" className="font-display text-xl font-semibold">
            From NASA file to the figures on screen
          </h2>
          <p className="mt-1 max-w-[72ch] text-sm text-soft">
            {synthetic ? "The synthetic demonstration data were generated separately." : <a className="underline" href={`${DATA_BASE}/methodology.md`}>Read the pipeline methodology and results</a>}
          </p>
        </div>
        <ol className="grid gap-x-8 gap-y-5 md:grid-cols-2 xl:grid-cols-3">
          {STEPS.map((step, i) => (
            <li key={step.title} className="flex gap-4 border-t border-line pt-4">
              <span aria-hidden className="tabular font-display text-3xl font-semibold text-muted">
                {i + 1}
              </span>
              <div>
                <h3 className="font-bold">
                  {step.title}
                </h3>
                <p className="mt-1 max-w-[52ch] text-sm text-soft">{step.text}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="limits-title" className="flex flex-col gap-3">
        <h2 id="limits-title" className="font-display text-xl font-semibold">
          What this data can and cannot say
        </h2>
        <ul className="flex max-w-[80ch] list-disc flex-col gap-1.5 pl-5 text-sm text-soft">
          {metadata.limitations.map((l) => (
            <li key={l}>{l}</li>
          ))}
          <li>This site does not identify who or what started a fire, and it makes no claim about illegal activity.</li>
          <li>The seasonal rankings compare relative activity within each series. Physical equivalence between series remains unvalidated.</li>
        </ul>
      </section>
    </div>
  );
}
