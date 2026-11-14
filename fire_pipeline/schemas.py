"""Input and output schemas for the Fire Seasons pipeline.

Input schemas describe NASA FIRMS active-fire CSV files exactly as distributed
(NRT "active_fire" files and Standard Processing / archive downloads).
Output schema describes the canonical, sensor-tagged detection table that every
downstream stage (grid aggregation, percentiles, agreement) consumes.

References
----------
- FIRMS attribute descriptions (MODIS C6.1, VIIRS 375 m C2):
  https://www.earthdata.nasa.gov/data/tools/firms  (FAQ / "Attribute fields")
- MODIS C6.1 active fire user guide (Giglio et al.): confidence 0-100 %.
- VIIRS 375 m user guide (Schroeder et al.): confidence classes low/nominal/high.
"""

from __future__ import annotations

from dataclasses import dataclass, field

# --------------------------------------------------------------------------
# Sensors
# --------------------------------------------------------------------------
MODIS = "MODIS"
VIIRS = "VIIRS"

# FIRMS `satellite` codes -> platform name. Kept per sensor so a MODIS file
# containing a VIIRS code (or vice versa) is rejected, not silently accepted.
PLATFORMS: dict[str, dict[str, str]] = {
    MODIS: {"T": "Terra", "A": "Aqua", "Terra": "Terra", "Aqua": "Aqua"},
    VIIRS: {
        "N": "Suomi NPP",
        "1": "NOAA-20",  # some archive files use numeric codes
        "N20": "NOAA-20",
        "N21": "NOAA-21",
    },
}

# Product label written to every output row (provenance).
PRODUCT: dict[str, str] = {
    MODIS: "MODIS Collection 6.1 Active Fire (MCD14 / FIRMS)",
    VIIRS: "VIIRS 375 m Active Fire (VNP14IMG / VJ114IMG / FIRMS)",
}

NOMINAL_RESOLUTION_M: dict[str, int] = {MODIS: 1000, VIIRS: 375}


# --------------------------------------------------------------------------
# Input schemas
# --------------------------------------------------------------------------
@dataclass(frozen=True)
class InputSchema:
    sensor: str
    required: tuple[str, ...]
    optional: tuple[str, ...] = field(default_factory=tuple)
    # sensor-specific column -> canonical column
    rename: dict[str, str] = field(default_factory=dict)


_COMMON_REQUIRED = (
    "latitude",
    "longitude",
    "scan",
    "track",
    "acq_date",
    "acq_time",
    "satellite",
    "confidence",
    "version",
    "frp",
    "daynight",
)
# `type` (0 vegetation, 1 volcano, 2 static land source, 3 offshore) and
# `instrument` appear only in archive / standard-processing downloads.
_COMMON_OPTIONAL = ("type", "instrument")

MODIS_INPUT = InputSchema(
    sensor=MODIS,
    required=_COMMON_REQUIRED + ("brightness", "bright_t31"),
    optional=_COMMON_OPTIONAL,
    rename={"brightness": "bright_primary_k", "bright_t31": "bright_secondary_k"},
)

VIIRS_INPUT = InputSchema(
    sensor=VIIRS,
    required=_COMMON_REQUIRED + ("bright_ti4", "bright_ti5"),
    optional=_COMMON_OPTIONAL,
    rename={"bright_ti4": "bright_primary_k", "bright_ti5": "bright_secondary_k"},
)

INPUT_SCHEMAS = {MODIS: MODIS_INPUT, VIIRS: VIIRS_INPUT}

# Physical / domain bounds used by validation. Generous on purpose: they catch
# corrupted rows, they do not filter "suspicious" science.
BOUNDS = {
    "latitude": (-90.0, 90.0),
    "longitude": (-180.0, 180.0),
    "scan": (0.0, 10.0),  # km, pixel size along scan
    "track": (0.0, 10.0),  # km
    "frp": (0.0, None),  # MW; FIRMS can report 0
    "bright_primary_k": (150.0, 600.0),  # K
    "bright_secondary_k": (150.0, 600.0),  # K
}

VIIRS_CONFIDENCE = {"l": "low", "n": "nominal", "h": "high",
                    "low": "low", "nominal": "nominal", "high": "high"}

FIRE_TYPE = {0: "presumed vegetation fire", 1: "active volcano",
             2: "other static land source", 3: "offshore"}


# --------------------------------------------------------------------------
# Canonical detection table (loader output)
# --------------------------------------------------------------------------
# name -> (dtype, raw|derived, units or None, description)
DETECTION_COLUMNS: dict[str, tuple[str, str, str | None, str]] = {
    "sensor": ("str", "raw", None, "MODIS or VIIRS"),
    "platform": ("str", "derived", None, "Terra, Aqua, Suomi NPP, NOAA-20, NOAA-21"),
    "satellite_code": ("str", "raw", None, "FIRMS `satellite` field as distributed"),
    "product": ("str", "derived", None, "Product family label"),
    "version": ("str", "raw", None, "FIRMS `version`, e.g. 6.1NRT, 6.1, 2.0NRT"),
    "is_nrt": ("bool", "derived", None, "True if version ends in NRT"),
    "latitude": ("float64", "raw", "degrees_north", "Pixel centre, WGS84"),
    "longitude": ("float64", "raw", "degrees_east", "Pixel centre, WGS84"),
    "acq_datetime_utc": ("datetime64[UTC]", "derived", None,
                         "acq_date + acq_time, both UTC in FIRMS"),
    "scan": ("float64", "raw", "km", "Along-scan pixel size"),
    "track": ("float64", "raw", "km", "Along-track pixel size"),
    "bright_primary_k": ("float64", "raw", "K",
                         "MODIS `brightness` (21/22, 4 um) | VIIRS `bright_ti4` (I4)"),
    "bright_secondary_k": ("float64", "raw", "K",
                           "MODIS `bright_t31` (11 um) | VIIRS `bright_ti5` (I5)"),
    "frp_mw": ("float64", "raw", "MW", "Fire radiative power"),
    "confidence_raw": ("str", "raw", None,
                       "As distributed: MODIS 0-100, VIIRS l/n/h"),
    "confidence_pct": ("Int64", "raw", "percent", "MODIS only; null for VIIRS"),
    "confidence_class": ("str", "derived", None,
                         "low/nominal/high. MODIS binned 0-29/30-79/80-100 per "
                         "FIRMS guidance. NOT a cross-sensor equivalence."),
    "daynight": ("str", "raw", None, "D or N"),
    "fire_type": ("Int64", "raw", None, "Archive `type` 0-3; null in NRT files"),
    "source_file": ("str", "derived", None, "Basename of the ingested CSV"),
}

DETECTION_COLUMN_ORDER = tuple(DETECTION_COLUMNS)
