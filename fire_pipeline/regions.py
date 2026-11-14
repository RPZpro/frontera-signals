"""Geographic filtering of detections with official boundary polygons.

Method: a detection belongs to a region when its pixel centre (FIRMS
latitude/longitude) intersects the region polygon (boundary counts as inside).
Pixels have a footprint (MODIS >= 1 km, VIIRS ~375 m), so pixels straddling a
border are assigned by their centre only. This is documented, not corrected.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from pathlib import Path

import geopandas as gpd
import pandas as pd

WGS84 = "EPSG:4326"


class RegionError(ValueError):
    """Boundary file is unusable (invalid geometry, bad ids, no CRS)."""


@dataclass
class FilterReport:
    rows_in: int = 0
    rows_matched: int = 0
    rows_outside: int = 0
    per_region: dict[str, int] = field(default_factory=dict)

    def to_dict(self) -> dict:
        return dict(self.__dict__)


def load_regions(path: str | Path, id_col: str = "region_id") -> gpd.GeoDataFrame:
    """Read a polygon file, validate it, return [region_id, geometry] in WGS84."""
    g = gpd.read_file(path)
    if g.crs is None:
        raise RegionError(f"{path}: boundary file has no CRS")
    if id_col not in g.columns:
        raise RegionError(f"{path}: missing id column {id_col!r}")
    ids = g[id_col]
    if ids.isna().any() or ids.duplicated().any():
        raise RegionError(f"{path}: region ids must be unique and non-null")
    if g.geometry.isna().any() or g.geometry.is_empty.any():
        raise RegionError(f"{path}: empty geometry")
    if not g.geom_type.isin(["Polygon", "MultiPolygon"]).all():
        raise RegionError(f"{path}: only Polygon/MultiPolygon supported")
    if not g.is_valid.all():
        # Do not silently repair: a repaired border changes which fires count.
        raise RegionError(f"{path}: invalid geometries {list(ids[~g.is_valid])}")
    g = g.to_crs(WGS84)
    return gpd.GeoDataFrame({"region_id": ids.astype("str")}, geometry=g.geometry, crs=WGS84)


def filter_to_regions(
    detections: pd.DataFrame, regions: gpd.GeoDataFrame
) -> tuple[pd.DataFrame, FilterReport]:
    """Keep detections whose pixel centre lies in a region; add `region_id`.

    A point in two overlapping regions appears once per region (counts are per
    region, never summed across regions).
    """
    rep = FilterReport(rows_in=len(detections))
    if regions.crs is None:
        raise RegionError("regions GeoDataFrame has no CRS")
    regions = regions.to_crs(WGS84)

    pts = gpd.GeoDataFrame(
        detections.reset_index(drop=True),
        geometry=gpd.points_from_xy(detections["longitude"], detections["latitude"]),
        crs=WGS84,
    )
    joined = gpd.sjoin(pts, regions[["region_id", "geometry"]],
                       how="inner", predicate="intersects")
    matched_idx = joined.index.unique()
    rep.rows_matched = len(matched_idx)
    rep.rows_outside = rep.rows_in - rep.rows_matched

    out = (pd.DataFrame(joined.drop(columns=["geometry", "index_right"]))
             .sort_values(["region_id", "acq_datetime_utc", "latitude", "longitude"],
                          kind="stable")
             .reset_index(drop=True))
    out = out[["region_id"] + [c for c in detections.columns]]
    rep.per_region = {r: int((out["region_id"] == r).sum()) for r in regions["region_id"]}
    return out, rep
