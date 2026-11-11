"use strict";

// Usage: node tools/check-runout-ems.cjs <AOI01 vectors.zip> <AOI02 vectors.zip>
// Download the EMSR927 Copernicus GRA_PRODUCT vector ZIPs from:
// https://rapidmapping.emergency.copernicus.eu/backend/EMSR927/AOI01/GRA_PRODUCT/EMSR927_AOI01_GRA_PRODUCT_v1.zip?type=vectors
// https://rapidmapping.emergency.copernicus.eu/backend/EMSR927/AOI02/GRA_PRODUCT/EMSR927_AOI02_GRA_PRODUCT_v2.zip?type=vectors
// This only compares DEM-cell centers in each AOI; it does not test arrival times.
const { execFileSync } = require("node:child_process");
require("../dist/terrain-data.js");
require("../dist/runout-terrain.js");
require("../dist/scenarios.js");
const { create } = require("../dist/runout-model.js");

function contains(ring, lon, lat) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[i], [x2, y2] = ring[j];
    if ((y1 > lat) !== (y2 > lat) && lon < (x2 - x1) * (lat - y1) / (y2 - y1) + x1) {
      inside = !inside;
    }
  }
  return inside;
}

function polygonContains(rings, lon, lat) {
  return contains(rings[0], lon, lat) && rings.slice(1).every(ring => !contains(ring, lon, lat));
}

function polygons(archive, layer) {
  const json = execFileSync("unzip", ["-p", archive, "*" + layer + "*.json"], { encoding: "utf8" });
  return JSON.parse(json).features.flatMap(({ geometry }) => {
    if (geometry.type === "Polygon") return [geometry.coordinates];
    if (geometry.type === "MultiPolygon") return geometry.coordinates;
    throw new TypeError("Unexpected " + layer + " geometry " + geometry.type);
  });
}

function compare(world, archive) {
  const { grid, arrival } = world;
  const [west, south, east, north] = grid.bounds;
  const extent = polygons(archive, "areaOfInterestA");
  const affected = polygons(archive, "observedEventA");
  let observed = 0, modeled = 0, overlap = 0;
  for (let y = 0; y < grid.rows; y++) {
    const lat = north - (y + 0.5) / grid.rows * (north - south);
    for (let x = 0; x < grid.cols; x++) {
      const lon = west + (x + 0.5) / grid.cols * (east - west);
      if (!extent.some(p => polygonContains(p, lon, lat))) continue;
      const mapped = affected.some(p => polygonContains(p, lon, lat));
      const forecast = Number.isFinite(arrival[y * grid.cols + x]);
      if (mapped) observed++;
      if (forecast) modeled++;
      if (mapped && forecast) overlap++;
    }
  }
  const union = observed + modeled - overlap;
  return {
    observed, modeled, overlap,
    coverage: observed ? overlap / observed : null,
    iou: union ? overlap / union : null
  };
}

const archives = process.argv.slice(2);
if (archives.length !== 2) {
  console.error("Usage: node tools/check-runout-ems.cjs <AOI01 vectors.zip> <AOI02 vectors.zip>");
  process.exitCode = 2;
} else {
  const world = create("01");
  archives.forEach((archive, index) => console.log("EMSR927 AOI0" + (index + 1), compare(world, archive)));
}
