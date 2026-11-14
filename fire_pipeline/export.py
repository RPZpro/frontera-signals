"""Export frontend datasets (data contract v1).

Usage:
    python -m fire_pipeline.export            # reads data/processed, writes data/export

Writes (validated against docs/schemas/*.schema.json):
    metadata.json      provenance, series, methods parameters, metric dictionary, limitations
    monthly.json       region x series x month: raw + derived metrics + seasonal percentiles
    agreement.json     sensor comparison per metric and pair of series
    weather.json       region x month x variable: NASA POWER values + anomalies
    hotspots_<YEAR>.geojson  every detection in the region, one file per year (original observations)
    methodology.md     copy of docs/methodology.md

Conventions: unavailable values are null, never 0 or NaN. Each measurement
carries region, series/sensor, period, source, product version, unit, quality and
kind ("raw" | "derived").
"""

from __future__ import annotations

import argparse
import json
import math
import shutil
import subprocess
from datetime import datetime, timezone
from pathlib import Path

import geopandas as gpd
import pandas as pd

from . import __version__
from .aggregate import METRICS
from .schemas import FIRE_TYPE, NOMINAL_RESOLUTION_M

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_VERSION = "1.0.0"

SERIES_INFO = {
    "MODIS": {"sensor": "MODIS", "platforms": ["Terra", "Aqua"], "product": "MOD14/MYD14",
              "label_en": "MODIS (Terra + Aqua)", "label_es": "MODIS (Terra + Aqua)"},
    "VIIRS_SNPP": {"sensor": "VIIRS", "platforms": ["Suomi NPP"], "product": "VNP14IMG",
                   "label_en": "VIIRS Suomi NPP", "label_es": "VIIRS Suomi NPP"},
    "VIIRS_NOAA20": {"sensor": "VIIRS", "platforms": ["NOAA-20"], "product": "VJ114IMG",
                     "label_en": "VIIRS NOAA-20", "label_es": "VIIRS NOAA-20"},
}
FIRMS_SOURCE = "NASA FIRMS yearly country summary (standard processing)"

METRIC_INFO = {
    "hotspot_count": {"label_en": "Hotspots", "label_es": "Puntos de calor",
                      "description": "Number of FIRMS detections (pixels). Not comparable across sensors."},
    "frp_sum_mw": {"label_en": "Total fire radiative power", "label_es": "Potencia radiativa total",
                   "description": "Sum of FRP of all detections in the month."},
    "active_cells": {"label_en": "Active 10 km cells", "label_es": "Celdas activas de 10 km",
                     "description": "Distinct 10 km equal-area cells with >= 1 detection; reduces pixel-size effect."},
    "active_cell_days": {"label_en": "Active cell-days", "label_es": "Celdas-día activas",
                         "description": "Distinct (cell, UTC day) pairs with >= 1 detection."},
}
WEATHER_INFO = {
    "T2M": {"long_name": "Temperature at 2 m", "label_es": "Temperatura a 2 m"},
    "RH2M": {"long_name": "Relative humidity at 2 m", "label_es": "Humedad relativa a 2 m"},
    "PRECTOTCORR": {"long_name": "Precipitation (bias corrected)", "label_es": "Precipitación"},
    "WS10M": {"long_name": "Wind speed at 10 m", "label_es": "Velocidad del viento a 10 m"},
}
HOTSPOT_PROPERTIES = {
    "series": "MODIS | VIIRS_SNPP | VIIRS_NOAA20",
    "platform": "Terra, Aqua, Suomi NPP, NOAA-20",
    "version": "FIRMS version (6.03 = MODIS C6.0, 61.03 = MODIS C6.1, 2 = VIIRS C2)",
    "t": "acquisition time, UTC, YYYY-MM-DDTHH:MMZ",
    "dn": "D day / N night",
    "frp_mw": "fire radiative power, MW",
    "bright_k": "brightness temperature, K (MODIS ch21/22, VIIRS I4)",
    "conf": "confidence as distributed (MODIS 0-100, VIIRS l/n/h)",
    "conf_class": "low/nominal/high (MODIS binned 0-29/30-79/80-100; not cross-sensor equivalent)",
    "fire_type": "0 vegetation, 1 volcano, 2 static land source, 3 offshore",
    "counted": "true if included in monthly metrics (fire_type filter)",
}
ACTIVITY_CLASSES = {
    "above_range": {"en": "Highest of the record for this calendar month",
                    "es": "El más alto del registro para este mes"},
    "within_range": {"en": "Within the range of other years", "es": "Dentro del rango de otros años"},
    "below_range": {"en": "Lowest of the record for this calendar month",
                    "es": "El más bajo del registro para este mes"},
    "not_evaluated": {"en": "Not evaluated (incomplete coverage)",
                      "es": "No evaluado (cobertura incompleta)"},
    "insufficient_reference": {"en": "Too few reference years", "es": "Muy pocos años de referencia"},
}
LIMITATIONS = [
    {"id": "raw_counts", "en": "Raw MODIS and VIIRS hotspot counts are not directly comparable: "
     "resolution, sensitivity, overpass time and confidence definitions differ. Compare percentiles.",
     "es": "Los conteos crudos de MODIS y VIIRS no son comparables directamente: difieren en "
     "resolución, sensibilidad, hora de paso y definición de confianza. Comparar percentiles."},
    {"id": "hotspot_not_fire", "en": "A hotspot is a hot pixel at overpass time, not an independent fire.",
     "es": "Un punto de calor es un pixel caliente al paso del satélite, no un incendio independiente."},
    {"id": "no_cause", "en": "A thermal anomaly does not indicate cause, intent or criminal activity.",
     "es": "Una anomalía térmica no indica causa, intención ni actividad criminal."},
    {"id": "absence", "en": "No detection does not prove absence of fire (clouds, timing, small fires).",
     "es": "Que no haya detección no prueba que no hubo fuego (nubes, horario, incendios pequeños)."},
    {"id": "short_record", "en": "Fire percentiles use only 6 years (each month vs 5 others): "
     "'above_range' means highest in this record, not a rare event.",
     "es": "Los percentiles de fuego usan solo 6 años (cada mes contra otros 5): "
     "'above_range' significa el más alto del registro, no un evento raro."},
    {"id": "modis_collection", "en": "MODIS is Collection 6.0 for 2020-2022 and 6.1 for 2023-2025.",
     "es": "MODIS es Colección 6.0 en 2020-2022 y 6.1 en 2023-2025."},
    {"id": "weather_regional", "en": "Weather values are regional means of ~55 km reanalysis cells, "
     "not conditions at each fire. Fire-weather association is not causation.",
     "es": "El clima es un promedio regional de celdas de reanálisis de ~55 km, no las condiciones "
     "en cada incendio. La asociación fuego-clima no implica causalidad."},
    {"id": "precip_qc", "en": "NASA POWER precipitation for 2020-06 is excluded (source artifact).",
     "es": "La precipitación de NASA POWER de 2020-06 está excluida (error en la fuente)."},
]


# ---------------------------------------------------------------- helpers
def clean(v):
    """JSON-safe scalar: NaN/NA -> None, numpy -> python."""
    if v is None or (isinstance(v, float) and math.isnan(v)) or v is pd.NA or v is pd.NaT:
        return None
    if hasattr(v, "item"):
        v = v.item()
        if isinstance(v, float) and math.isnan(v):
            return None
    return v


def write_json(path: Path, obj, indent: int | None = 2) -> None:
    path.write_text(json.dumps(obj, indent=indent, ensure_ascii=False, allow_nan=False,
                               separators=None if indent else (",", ":")) + "\n")


def _git_commit() -> dict:
    try:
        sha = subprocess.run(["git", "rev-parse", "HEAD"], cwd=ROOT, capture_output=True,
                             text=True, check=True).stdout.strip()
        dirty = bool(subprocess.run(["git", "status", "--porcelain", "--", "fire_pipeline"],
                                    cwd=ROOT, capture_output=True, text=True).stdout.strip())
        return {"commit": sha, "code_dirty": dirty}
    except (OSError, subprocess.CalledProcessError):
        return {"commit": None, "code_dirty": None}


# ---------------------------------------------------------------- builders
def build_monthly(monthly: pd.DataFrame, seasonal: pd.DataFrame, collections: dict) -> dict:
    seas = seasonal.set_index(["region_id", "series", "month", "metric"])
    records = []
    for r in monthly.itertuples(index=False):
        metrics = {}
        for m, (kind, unit) in METRICS.items():
            s = seas.loc[(r.region_id, r.series, r.month, m)]
            metrics[m] = {
                "value": clean(getattr(r, m)), "unit": unit, "kind": kind,
                "seasonal": {
                    "kind": "derived", "ref_period": s["ref_period"], "n_ref": clean(s["n_ref"]),
                    "ref_median": clean(s["ref_median"]), "ref_min": clean(s["ref_min"]),
                    "ref_max": clean(s["ref_max"]), "percentile": clean(s["percentile"]),
                    "activity_class": s["activity_class"],
                },
            }
        coll = collections.get(r.series, {}).get(r.month[:4], [])
        records.append({
            "region_id": r.region_id, "series": r.series, "sensor": r.sensor,
            "period": r.month, "period_type": "month", "time_standard": "UTC",
            "source": FIRMS_SOURCE, "product": SERIES_INFO[r.series]["product"],
            "product_version": "/".join(coll) if coll else None,
            "quality": r.quality, "coverage_fraction": clean(round(r.coverage_fraction, 4)),
            "metrics": metrics,
        })
    return {"schema_version": SCHEMA_VERSION, "records": records}


def build_agreement(agreement: dict) -> dict:
    return {"schema_version": SCHEMA_VERSION, "ref_years": agreement["ref_years"],
            "kind": "derived", "pairs": agreement["pairs"]}


def build_weather(weather: pd.DataFrame, years: tuple[int, int], wrep: dict) -> dict:
    w = weather[weather["month"].str[:4].astype(int).between(*years)]
    records = [{
        "region_id": r.region_id, "variable": r.variable,
        "long_name": WEATHER_INFO[r.variable]["long_name"],
        "period": r.month, "period_type": "month", "time_standard": "LST",
        "source": r.source, "dataset": "MERRA-2 reanalysis via NASA POWER",
        "native_resolution_deg": [wrep["grid"]["dlat"], wrep["grid"]["dlon"]],
        "unit": r.unit, "kind": "derived", "quality": r.quality,
        "value": clean(r.value), "normal_period": r.normal_period,
        "normal_mean": clean(r.normal_mean), "anomaly": clean(r.anomaly),
        "anomaly_pct": clean(r.anomaly_pct),
    } for r in w.itertuples(index=False)]
    return {"schema_version": SCHEMA_VERSION, "records": records}


def build_hotspots(det: pd.DataFrame, counted_types: list[int] | None, region_id: str,
                   year: int) -> dict:
    """One FeatureCollection per year. Per-feature properties are kept minimal;
    constant fields (region, kind, product per series) live at collection level
    or in metadata.json."""
    feats = []
    for r in det.itertuples(index=False):
        ft = clean(r.fire_type)
        feats.append({
            "type": "Feature",
            "geometry": {"type": "Point",
                         "coordinates": [round(float(r.longitude), 5), round(float(r.latitude), 5)]},
            "properties": {
                "series": r.series, "platform": r.platform, "version": str(r.version),
                "t": r.acq_datetime_utc, "dn": r.daynight,
                "frp_mw": clean(r.frp_mw), "bright_k": clean(r.bright_primary_k),
                "conf": str(r.confidence_raw), "conf_class": r.confidence_class,
                "fire_type": ft,
                "counted": bool(counted_types is None or ft is None or ft in counted_types),
            },
        })
    return {"type": "FeatureCollection", "schema_version": SCHEMA_VERSION,
            "region_id": region_id, "year": year, "kind": "raw",
            "source": FIRMS_SOURCE, "time_standard": "UTC",
            "properties_legend": HOTSPOT_PROPERTIES, "features": feats}


def build_metadata(rr: dict, wrep: dict, region_gdf: gpd.GeoDataFrame, outputs: list[str],
                   weather_years: tuple[int, int]) -> dict:
    reg = region_gdf.iloc[0]
    area = float(region_gdf.to_crs("EPSG:6933").area.iloc[0] / 1e6)
    b = [round(float(x), 5) for x in region_gdf.total_bounds]
    series = {}
    for s, info in SERIES_INFO.items():
        if s not in rr["coverage"]:
            continue
        series[s] = {**info, "nominal_resolution_m": NOMINAL_RESOLUTION_M[info["sensor"]],
                     "coverage": rr["coverage"][s],
                     "collections_by_year": rr["collections_by_series_year"][s],
                     "source": FIRMS_SOURCE}
    metric_dict = {m: {"unit": u, "kind": k, **METRIC_INFO[m]} for m, (k, u) in METRICS.items()}
    return {
        "schema_version": SCHEMA_VERSION,
        "pipeline": {"name": "fire_pipeline", "version": __version__, **_git_commit(),
                     "generated_utc": datetime.now(timezone.utc).isoformat(timespec="seconds")},
        "project": {"team": "Frontera Signal", "challenge": "NASA Space Apps 2026 — "
                    "Harmonization of MODIS and VIIRS Hot Spots",
                    "title": "Fire Seasons — Historical Thermal Anomalies"},
        "regions": [{"region_id": reg["region_id"], "name": reg.get("shapeName"),
                     "iso_3166_2": reg.get("shapeISO"), "area_km2": round(area, 1), "bbox": b,
                     "boundary_source": "geoBoundaries gbOpen MEX ADM1 (INEGI 2020), CC BY 3.0 IGO"}],
        "series": series,
        "methods": {
            "time_standard_fire": "UTC", "grid": rr["grid"],
            "monthly_fire_types": rr["monthly_fire_types"],
            "fire_type_labels": {str(k): v for k, v in FIRE_TYPE.items()},
            "excluded_by_fire_type": rr["monthly_excluded_by_type"],
            "seasonal_reference": "leave-one-out, same calendar month, same series",
            "weather_normal_period": wrep["normal_period"],
            "weather_aggregation": wrep["aggregation"],
            "weather_qc": wrep["qc"],
        },
        "metrics": metric_dict,
        "activity_classes": ACTIVITY_CLASSES,
        "weather_variables": {v: {**WEATHER_INFO[v], "unit": m["unit"]}
                              for v, m in ((m["variable"], m) for m in wrep["variables"])},
        "weather_years_exported": list(weather_years),
        "inputs": [{"file": i["source_file"], "sha256": i["sha256"], "series": i["series"],
                    "year": i["year"], "rows_read": i["rows_read"], "rows_valid": i["rows_valid"],
                    "rows_in_region": i["region_filter"]["rows_matched"]} for i in rr["inputs"]]
                  + [{"file": v["file"], "variable": v["variable"]} for v in wrep["variables"]],
        "exploratory_fire_weather_association": wrep["association_exploratory"],
        "limitations": LIMITATIONS,
        "hotspot_properties": HOTSPOT_PROPERTIES,
        "files": outputs,
    }


def run(processed: Path, out_dir: Path, boundary: Path, weather_years=(2020, 2025)) -> dict:
    tag = "mx_bcn"
    monthly = pd.read_csv(processed / f"monthly_{tag}.csv", dtype={"month": "str"})
    seasonal = pd.read_csv(processed / f"seasonal_{tag}.csv", dtype={"month": "str"})
    weather = pd.read_csv(processed / f"weather_{tag}.csv", dtype={"month": "str", "cal_month": "str"})
    det = pd.read_csv(processed / f"detections_{tag}.csv",
                      dtype={"version": "str", "confidence_raw": "str"})
    agreement = json.loads((processed / f"agreement_{tag}.json").read_text())
    rr = json.loads((processed / "run_report.json").read_text())
    wrep = json.loads((processed / "weather_report.json").read_text())

    out_dir.mkdir(parents=True, exist_ok=True)
    years = sorted(det["acq_datetime_utc"].str[:4].astype(int).unique())
    files = ["metadata.json", "monthly.json", "agreement.json", "weather.json",
             *[f"hotspots_{y}.geojson" for y in years], "methodology.md"]
    write_json(out_dir / "monthly.json", build_monthly(monthly, seasonal, rr["collections_by_series_year"]))
    write_json(out_dir / "agreement.json", build_agreement(agreement))
    write_json(out_dir / "weather.json", build_weather(weather, weather_years, wrep))
    rid = rr["regions"][0]
    for f in out_dir.glob("hotspots*.geojson"):
        f.unlink()  # remove stale years
    for y in years:
        d = det[det["acq_datetime_utc"].str.startswith(str(y))]
        write_json(out_dir / f"hotspots_{y}.geojson",
                   build_hotspots(d, rr["monthly_fire_types"], rid, int(y)), indent=None)
    shutil.copyfile(ROOT / "docs" / "methodology.md", out_dir / "methodology.md")
    meta = build_metadata(rr, wrep, gpd.read_file(boundary), files, weather_years)
    write_json(out_dir / "metadata.json", meta)
    return {f: (out_dir / f).stat().st_size for f in files}


def main(argv=None) -> None:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--processed", type=Path, default=ROOT / "data" / "processed")
    ap.add_argument("--out", type=Path, default=ROOT / "data" / "export")
    ap.add_argument("--boundary", type=Path, default=ROOT / "data/boundaries/mx_bcn_adm1.geojson")
    a = ap.parse_args(argv)
    sizes = run(a.processed, a.out, a.boundary)
    for f, n in sizes.items():
        print(f"{f:18s} {n / 1e6:8.2f} MB")


if __name__ == "__main__":
    main()
