const model = require("./dist/terrain-model.js");
require("./dist/terrain-data.js");
require("./dist/scenarios.js");

for (const [key, data] of Object.entries(globalThis.ValleyTerrain)) {
  const bytes = Buffer.from(data.encoded, "base64");
  const heights = Int16Array.from({ length: bytes.length / 2 }, (_, index) => bytes.readInt16LE(2 * index));
  const grid = { ...data, heights };
  const scene = globalThis.ValleyScenes[key];
  const source = model.lonLatToCell(grid, ...scene.source);
  const path = model.route(grid, model.prepare(grid), source);
  const arrival = model.envelope(grid, path);
  const sites = scene.sites.map(site => {
    const id = model.lonLatToCell(grid, ...site.coordinate);
    return { name: site.name, inEnvelope: Number.isFinite(arrival[id]), nearest: model.nearest(grid, path, id) };
  });

  let overlap;
  if (scene.observed) {
    const [west, south, east, north] = grid.bounds;
    const polygon = scene.observed.map(([lon, lat]) => [
      (lon - west) / (east - west) * grid.cols,
      (north - lat) / (north - south) * grid.rows
    ]);
    overlap = model.compare(grid, arrival, polygon);
  }
  console.log(JSON.stringify({ key, cellMeters: grid.cell, sites, overlap }, null, 2));
}
