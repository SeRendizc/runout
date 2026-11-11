"""Extract RUNOUT's expanded DEM from the local Copernicus GLO-30 tile."""
import argparse
import json
from pathlib import Path
import runpy


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("tiles", type=Path)
    args = parser.parse_args()
    root = Path(__file__).resolve().parents[1]
    extract = runpy.run_path(str(root / "build-terrain.py"))["extract"]
    grid = extract(args.tiles, "N28_00_E085_00", [85.287, 28.117, 85.685, 28.45], 110)
    output = root / "dist" / "runout-terrain.js"
    output.write_text(
        "globalThis.RunoutTerrain = " + json.dumps(grid, separators=(",", ":")) + ";\n",
        encoding="utf-8",
    )
    print(f"Prepared {grid['cols']} × {grid['rows']} cells at {grid['cell']} m")


if __name__ == "__main__":
    main()
