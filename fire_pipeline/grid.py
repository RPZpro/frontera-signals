"""Common equal-area spatial grid used to compare MODIS and VIIRS activity.

Why a grid: raw hotspot counts depend on pixel size (VIIRS 375 m pixels split
one fire into more detections than MODIS 1 km pixels). Counting *distinct
grid cells with >= 1 detection* reduces that resolution effect. It does not
remove differences in sensitivity or overpass time.

Grid definition
---------------
* CRS: EPSG:6933, WGS 84 / NSIDC EASE-Grid 2.0 Global (equal-area cylindrical),
  so every cell has the same area wherever it is.
* Cell size: 10 km by default. That is larger than the off-nadir MODIS pixel
  (about 2 x 4.8 km at the scan edge) plus geolocation error, and it can be
  configured.
* Origin: projection origin (0, 0), so a cell id is global and deterministic:
  ``"{ix}_{iy}"`` with ix = floor(x / size), iy = floor(y / size).
"""

from __future__ import annotations

import numpy as np
import pandas as pd
from pyproj import Transformer

GRID_CRS = "EPSG:6933"
DEFAULT_CELL_M = 10_000

_TO_GRID = Transformer.from_crs("EPSG:4326", GRID_CRS, always_xy=True)


def assign_cells(df: pd.DataFrame, cell_m: float = DEFAULT_CELL_M) -> pd.DataFrame:
    """Return a copy of ``df`` with a ``cell_id`` column for the common grid."""
    if not (np.isfinite(cell_m) and cell_m > 0):
        raise ValueError(f"cell size must be a positive number of metres, got {cell_m}")
    x, y = _TO_GRID.transform(df["longitude"].to_numpy(), df["latitude"].to_numpy())
    ix = np.floor(np.asarray(x) / cell_m).astype("int64")
    iy = np.floor(np.asarray(y) / cell_m).astype("int64")
    out = df.copy()
    out["cell_id"] = pd.Series(ix, index=df.index).astype("str") + "_" + \
        pd.Series(iy, index=df.index).astype("str")
    return out


def grid_metadata(cell_m: float = DEFAULT_CELL_M) -> dict:
    return {
        "crs": GRID_CRS,
        "crs_name": "WGS 84 / NSIDC EASE-Grid 2.0 Global",
        "cell_size_m": cell_m,
        "cell_area_km2": (cell_m / 1000) ** 2,
        "origin": [0.0, 0.0],
        "cell_id_format": "{ix}_{iy}, ix=floor(x/cell_size_m), iy=floor(y/cell_size_m)",
    }
