"""Create the offline grids from local Copernicus GLO-30 GeoTIFF tiles."""
import argparse
import base64
import json
from math import cos, radians
from pathlib import Path

import numpy as np
import rasterio
from rasterio.enums import Resampling
from rasterio.windows import from_bounds

ROOT = Path(__file__).resolve().parent
SCENES = {
    "himalaya": ("N28_00_E085_00", [85.287, 28.117, 85.595, 28.415], 110),
    "andes": ("S44_00_W073_00", [-72.463, -43.450, -72.317, -43.326], 60),
}


def extract(tile_dir, tile, bounds, cell):
    west, south, east, north = bounds
    cols = round((east - west) * 111_320 * cos(radians((north + south) / 2)) / cell)
    rows = round((north - south) * 111_320 / cell)
    with rasterio.open(tile_dir / (tile + ".tif")) as source:
        height = source.read(
            1, window=from_bounds(*bounds, transform=source.transform),
            out_shape=(rows, cols), resampling=Resampling.bilinear,
        )
    if not np.isfinite(height).all() or height.min() < -50:
        raise ValueError(f"Missing or invalid elevations in {tile}")
    samples = np.rint(height).astype("<i2")
    return {
        "bounds": bounds, "cols": cols, "rows": rows, "cell": cell,
        "encoded": base64.b64encode(samples.tobytes()).decode("ascii"),
    }


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("tiles", type=Path)
    args = parser.parse_args()
    scenes = {name: extract(args.tiles, *spec) for name, spec in SCENES.items()}
    (ROOT / "dist" / "terrain-data.js").write_text(
        "globalThis.ValleyTerrain = " + json.dumps(scenes, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
