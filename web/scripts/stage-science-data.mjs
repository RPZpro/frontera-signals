import { copyFile, mkdir, readFile } from "node:fs/promises";

const source = new URL("../../data/export/", import.meta.url);
const destination = new URL("../public/data/firms/", import.meta.url);
const metadata = JSON.parse(await readFile(new URL("metadata.json", source), "utf8"));

await mkdir(destination, { recursive: true });
await Promise.all(metadata.files.map((file) => copyFile(new URL(file, source), new URL(file, destination))));
await copyFile(
  new URL("../../data/boundaries/mx_bcn_adm1.geojson", import.meta.url),
  new URL("mx_bcn_adm1.geojson", destination),
);
