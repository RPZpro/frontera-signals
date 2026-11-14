# Boundary provenance

| File | Region | Source | Year | License |
|---|---|---|---|---|
| `mx_bcn_adm1.geojson` | `MX-BCN` Baja California (state, ADM1) | geoBoundaries gbOpen MEX ADM1, original source **INEGI** | 2020 | CC BY 3.0 IGO |

- Download URL: https://github.com/wmgeolab/geoBoundaries/raw/90a1d52/releaseData/gbOpen/MEX/ADM1/geoBoundaries-MEX-ADM1.geojson
- Downloaded: 2026-11-14. SHA-256 of the full national file: `7cfdc0e6a3f1420ba57b12b971db9b3c9febda8e7b00565e159a25b6dd4f35e0`
- Extraction: kept the row `shapeISO == "MX-BCN"` and added `region_id = "MX-BCN"`. Geometry is unmodified and full resolution (MultiPolygon, 81 parts including islands, valid).
- Area in EPSG:6372: ~73,206 km² (includes islands).

Cite as: Runfola et al. (2020) geoBoundaries: A global database of political
administrative boundaries. PLoS ONE 15(4): e0231866.

Not used: geoBoundaries MEX ADM2 (municipalities), because its source is World Bank 2012 rather than INEGI. For Tijuana municipality, use the INEGI Marco Geoestadístico.
