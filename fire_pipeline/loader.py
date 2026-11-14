"""Load and validate NASA FIRMS MODIS / VIIRS active-fire CSV files.

Design rules
------------
* Never impute: invalid rows are dropped (or raise in strict mode) and every
  drop is counted in the ValidationReport with its reason.
* One file = one sensor. Mixed or unrecognised files are rejected.
* FIRMS acq_date / acq_time are UTC; we build a tz-aware UTC timestamp.
* Sensor-specific fields (brightness channels, confidence) are mapped to
  canonical names but keep their native meaning; nothing here claims that a
  MODIS value equals a VIIRS value.
"""

from __future__ import annotations

import hashlib
from dataclasses import dataclass, field
from pathlib import Path

import pandas as pd

from . import schemas as S


class SchemaError(ValueError):
    """The file does not match any supported FIRMS schema."""


class ValidationError(ValueError):
    """Row-level validation failed in strict mode."""


@dataclass
class ValidationReport:
    source_file: str
    sha256: str
    sensor: str
    rows_read: int = 0
    rows_valid: int = 0
    dropped: dict[str, int] = field(default_factory=dict)
    duplicates_removed: int = 0
    versions: list[str] = field(default_factory=list)
    collections: list[str] = field(default_factory=list)
    platforms: list[str] = field(default_factory=list)
    date_min: str | None = None
    date_max: str | None = None

    def _drop(self, reason: str, n: int) -> None:
        if n:
            self.dropped[reason] = self.dropped.get(reason, 0) + int(n)

    def to_dict(self) -> dict:
        return dict(self.__dict__)


def detect_sensor(columns) -> str:
    cols = {c.strip().lower() for c in columns}
    is_modis = {"brightness", "bright_t31"} <= cols
    is_viirs = {"bright_ti4", "bright_ti5"} <= cols
    if is_modis and not is_viirs:
        return S.MODIS
    if is_viirs and not is_modis:
        return S.VIIRS
    raise SchemaError(
        "Cannot identify sensor: expected MODIS (brightness, bright_t31) or "
        f"VIIRS (bright_ti4, bright_ti5) columns, got {sorted(cols)}"
    )


def _sha256(path: Path) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as fh:
        for chunk in iter(lambda: fh.read(1 << 20), b""):
            h.update(chunk)
    return h.hexdigest()


def _parse_utc(acq_date: pd.Series, acq_time: pd.Series) -> pd.Series:
    """acq_date 'YYYY-MM-DD' + acq_time HHMM (may lose leading zeros) -> UTC."""
    t = pd.to_numeric(acq_time, errors="coerce")
    valid_t = t.notna() & (t % 1 == 0) & (t >= 0) & ((t // 100) <= 23) & ((t % 100) <= 59)
    hhmm = t.where(valid_t).astype("Int64").astype("str").str.zfill(4)
    stamp = acq_date.astype("str").str.strip() + " " + hhmm
    out = pd.to_datetime(stamp, format="%Y-%m-%d %H%M", errors="coerce", utc=True)
    return out.where(valid_t)


def _modis_conf_class(pct: pd.Series) -> pd.Series:
    bins = pd.cut(pct.astype("float64"), bins=[-0.5, 29.5, 79.5, 100.5],
                  labels=["low", "nominal", "high"])
    return bins.astype("str").where(bins.notna(), None)


def load_firms_csv(
    path: str | Path,
    sensor: str | None = None,
    *,
    strict: bool = False,
    drop_duplicates: bool = True,
) -> tuple[pd.DataFrame, ValidationReport]:
    """Read one FIRMS CSV and return (canonical detections, report).

    Parameters
    ----------
    sensor : 'MODIS' | 'VIIRS' | None
        Expected sensor. If given and the file is the other sensor -> SchemaError.
    strict : bool
        Raise ValidationError on any invalid row instead of dropping it.
    drop_duplicates : bool
        Remove exact duplicate records (same sensor/platform/time/location/
        values) — these are file-level duplicates, not cross-sensor ones.
    """
    path = Path(path)
    raw = pd.read_csv(path, dtype="str", keep_default_na=False, na_values=[""])
    raw.columns = [c.strip().lower() for c in raw.columns]

    detected = detect_sensor(raw.columns)
    if sensor is not None and sensor.upper() != detected:
        raise SchemaError(f"{path.name}: expected {sensor.upper()}, file is {detected}")
    schema = S.INPUT_SCHEMAS[detected]

    missing = [c for c in schema.required if c not in raw.columns]
    if missing:
        raise SchemaError(f"{path.name}: missing required columns {missing}")

    report = ValidationReport(source_file=path.name, sha256=_sha256(path),
                              sensor=detected, rows_read=len(raw))

    df = raw.rename(columns=schema.rename)
    for c in ("latitude", "longitude", "scan", "track", "frp",
              "bright_primary_k", "bright_secondary_k"):
        df[c] = pd.to_numeric(df[c], errors="coerce")

    bad = pd.Series(False, index=df.index)

    def flag(mask: pd.Series, reason: str) -> None:
        nonlocal bad
        mask = mask.fillna(True) & ~bad
        report._drop(reason, mask.sum())
        bad = bad | mask

    # 1. numeric fields present and within physical bounds
    for col, (lo, hi) in S.BOUNDS.items():
        v = df[col]
        m = v.isna()
        if lo is not None:
            m |= v < lo
        if hi is not None:
            m |= v > hi
        flag(m, f"{col}_missing_or_out_of_range")

    # 2. timestamp
    ts = _parse_utc(df["acq_date"], df["acq_time"])
    flag(ts.isna(), "invalid_acq_datetime")

    # 3. platform code must belong to this sensor
    sat = df["satellite"].str.strip()
    platform = sat.map(S.PLATFORMS[detected])
    flag(platform.isna(), "unknown_satellite_for_sensor")

    # 4. confidence
    conf_raw = df["confidence"].str.strip()
    if detected == S.MODIS:
        pct = pd.to_numeric(conf_raw, errors="coerce")
        flag(pct.isna() | (pct < 0) | (pct > 100) | (pct % 1 != 0), "invalid_confidence")
        conf_pct = pct.where(~bad).astype("Int64")
        conf_class = _modis_conf_class(conf_pct)
    else:
        conf_class = conf_raw.str.lower().map(S.VIIRS_CONFIDENCE)
        flag(conf_class.isna(), "invalid_confidence")
        conf_pct = pd.Series(pd.NA, index=df.index, dtype="Int64")

    # 5. day/night
    dn = df["daynight"].str.strip().str.upper()
    flag(~dn.isin(["D", "N"]), "invalid_daynight")

    # 6. version -> collection (unknown versions are rejected, not guessed)
    version = df["version"].str.strip()
    v = version.str.upper().str.replace("NRT", "", regex=False).str.strip()
    collection = pd.Series(pd.NA, index=df.index, dtype="str")
    for pattern, label in S.COLLECTION_PATTERNS[detected]:
        collection = collection.mask(v.str.match(pattern, na=False), label)
    flag(collection.isna(), "unrecognised_version")

    # 7. optional archive `type`
    if "type" in df.columns:
        ftype = pd.to_numeric(df["type"], errors="coerce")
        flag(df["type"].notna() & ~ftype.isin(list(S.FIRE_TYPE)), "invalid_fire_type")
        ftype = ftype.astype("Int64")
    else:
        ftype = pd.Series(pd.NA, index=df.index, dtype="Int64")

    if strict and bad.any():
        raise ValidationError(f"{path.name}: {report.dropped}")

    out = pd.DataFrame({
        "sensor": detected,
        "platform": platform,
        "satellite_code": sat,
        "series": platform.map(S.SERIES[detected]),
        "collection": collection,
        "product": platform.map(S.PRODUCT_CODE) + " " + collection,
        "version": version,
        "is_nrt": version.str.upper().str.endswith("NRT"),
        "latitude": df["latitude"],
        "longitude": df["longitude"],
        "acq_datetime_utc": ts,
        "scan": df["scan"],
        "track": df["track"],
        "bright_primary_k": df["bright_primary_k"],
        "bright_secondary_k": df["bright_secondary_k"],
        "frp_mw": df["frp"],
        "confidence_raw": conf_raw,
        "confidence_pct": conf_pct,
        "confidence_class": conf_class,
        "daynight": dn,
        "fire_type": ftype,
        "source_file": path.name,
    })[~bad]

    if drop_duplicates:
        n = len(out)
        out = out.drop_duplicates(subset=[c for c in out.columns if c != "source_file"])
        report.duplicates_removed = n - len(out)

    out = (out.sort_values(["acq_datetime_utc", "latitude", "longitude"], kind="stable")
              .reset_index(drop=True)
              .astype({"sensor": "str", "platform": "str", "series": "str",
                       "collection": "str", "product": "str",
                       "is_nrt": "bool", "confidence_class": "str"}))
    out = out[list(S.DETECTION_COLUMN_ORDER)]

    report.rows_valid = len(out)
    report.versions = sorted(out["version"].unique().tolist())
    report.collections = sorted(out["collection"].unique().tolist())
    report.platforms = sorted(out["platform"].unique().tolist())
    if len(out):
        report.date_min = out["acq_datetime_utc"].min().isoformat()
        report.date_max = out["acq_datetime_utc"].max().isoformat()
    return out, report


def load_many(paths, sensor: str | None = None, **kw) -> tuple[pd.DataFrame, list[ValidationReport]]:
    """Load several files of the SAME sensor and concatenate them."""
    frames, reports = [], []
    for p in paths:
        df, rep = load_firms_csv(p, sensor=sensor, **kw)
        frames.append(df)
        reports.append(rep)
    sensors = {r.sensor for r in reports}
    if len(sensors) > 1:
        raise SchemaError(f"load_many received mixed sensors {sensors}; load them separately")
    if not frames:
        return pd.DataFrame(columns=list(S.DETECTION_COLUMN_ORDER)), reports
    return pd.concat(frames, ignore_index=True), reports


__all__ = ["load_firms_csv", "load_many", "detect_sensor", "ValidationReport",
           "SchemaError", "ValidationError"]
