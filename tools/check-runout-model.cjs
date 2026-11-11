"use strict";

const assert = require("node:assert/strict");
require("../dist/terrain-data.js");
require("../dist/runout-terrain.js");
require("../dist/scenarios.js");
const model = require("../dist/runout-model.js");

assert.deepEqual(model.catalog.map(item => item.id),
  ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "andes"]);
assert.equal(model.catalog.at(-1).example, true);
const worlds = new Map(model.catalog.map(({ id }) => [id, model.create(id)]));

function cell(grid, point) {
  assert.ok(point.x >= 0 && point.x < grid.cols);
  assert.ok(point.y >= 0 && point.y < grid.rows);
  return Math.floor(point.y) * grid.cols + Math.floor(point.x);
}

for (const [id, world] of worlds) {
  const { grid, arrival, duration, waves, sites } = world;
  assert.equal(grid.heights.length, grid.rows * grid.cols);
  assert.equal(arrival.length, grid.heights.length);
  assert.ok(waves.length > 0);
  for (const { path, start } of waves) {
    assert.ok(path.length > 20);
    assert.ok(start + path.at(-1).minute < duration);
    path.forEach((p, i) => {
      assert.equal(cell(grid, p), p.id);
      if (i > 0) {
        assert.ok(path[i - 1].minute < p.minute);
        assert.ok(path[i - 1].distance < p.distance);
      }
    });
  }
  for (const site of sites) {
    const t = arrival[cell(grid, site)];
    assert.equal(site.arrival, Number.isFinite(t) ? t : null);
    if (site.arrival === null) assert.equal(site.notify, null);
    for (const point of [...site.route, ...(site.backup || [])]) cell(grid, point);
    if (site.arrival !== null) assert.ok(site.arrival < duration);
    if (site.notify !== null) assert.ok(site.notify < duration);
    assert.equal(arrival[cell(grid, (site.backup || site.route).at(-1))], Infinity);
  }
  console.log(id, `${waves.length} wave(s), ${duration} min`,
    sites.map(site => `${site.id}:${site.arrival?.toFixed(2) ?? "outside"}`).join(", "));
}

const historical = worlds.get("01");
assert.ok(Math.abs(historical.sites[0].arrival - 7.35) < 0.001);
assert.equal(historical.waves[1].kind, "return");
assert.equal(historical.waves[1].start, historical.confluenceTime);
assert.equal(worlds.get("03").sites[1].arrival, null);
assert.equal(worlds.get("04").sites.at(-1).arrival, null);
assert.equal(worlds.get("05").sites[1].arrival, null);
const simultaneous = worlds.get("06");
assert.deepEqual(simultaneous.waves.map(wave => wave.start), [0, 0]);
const shared = simultaneous.waves.map(wave =>
  wave.path.find(p => p.id === simultaneous.confluence.id).minute);
assert.ok(Math.abs(shared[0] - shared[1]) < 0.15);
const second = worlds.get("07");
assert.ok(second.waves[1].start > 0);
assert.ok(second.sites.filter(site => Number.isFinite(site.updates[0].arrival)).length >= 2);
for (const site of second.sites) {
  const [update] = site.updates;
  assert.ok(second.waves[1].start < update.minute);
  if (Number.isFinite(update.arrival)) {
    assert.ok(update.minute < update.arrival);
    assert.ok(site.arrival < update.arrival);
  }
}
const separate = worlds.get("08");
const separateCells = new Set(separate.waves[0].path.map(p => p.id));
assert.ok(separate.waves[1].path.every(p => !separateCells.has(p.id)));
const outage = worlds.get("09");
assert.deepEqual(outage.waves, historical.waves);
assert.ok(outage.sites[0].arrival < outage.sites[0].notify);
assert.ok(outage.sites[2].notify + outage.sites[2].walk < outage.sites[2].arrival);
const bridges = worlds.get("10");
assert.equal(bridges.bridges.length, 2);
for (const site of bridges.sites) {
  assert.ok(site.closure < site.notify && site.notify < site.arrival);
  assert.ok(site.bridgeFraction > 0 && site.bridgeFraction < 1);
}
assert.equal(bridges.sites[0].backup, undefined);
assert.ok(bridges.sites[1].notify + bridges.sites[1].backupWalk < bridges.sites[1].arrival);
const example = worlds.get("andes");
assert.ok(example.metrics.coverage > 0.7 && example.metrics.iou > 0.4);
console.log("Andes observed-overlap comparison:", example.metrics);

for (const [, world] of worlds) {
  assert.equal(world.clearance.length, world.arrival.length);
  for (let i = 0; i < world.arrival.length; i++) {
    const arrival = world.arrival[i], tail = world.clearance[i];
    if (Number.isFinite(arrival)) assert.ok(tail > arrival && tail < world.duration);
    else assert.equal(tail, Infinity);
  }
  for (const { path } of world.waves) {
    assert.ok(path.some(p => p.width > 0));
    assert.ok(path.every(p => p.width >= 0 && p.width <= 3.2 && p.depth > 0 && p.depth <= 18));
  }
}
assert.equal(historical.interactions[0].kind, "junction");
assert.equal(simultaneous.interactions[0].kind, "reinforcement");
assert.ok(simultaneous.interactions[0].minute >= Math.max(...shared));
assert.ok(simultaneous.interactions[0].strength <= 0.62);
assert.equal(second.interactions.length, 0);
assert.equal(separate.interactions.length, 0);

const [port, timure, syapru] = historical.sites;
assert.ok(port.notify + 0.55 + port.walk > port.arrival);
assert.ok(timure.notify + 0.55 + timure.walk < timure.arrival);
assert.ok(syapru.notify + 0.55 + syapru.walk < syapru.arrival);
assert.equal(model.probe(historical, { x: -1, y: 1 }, 0).status, "insufficient");
assert.equal(model.probe(historical, { x: Number.NaN, y: 0 }, 0).status, "insufficient");
const outside = model.probe(historical, { x: 16, y: 20 }, 1);
assert.equal(outside.status, "outside");
assert.equal(outside.arrival, null);
assert.ok(Number.isFinite(outside.elevation));

const portProbe = model.probe(historical, port, port.notify);
assert.equal(portProbe.status, "affected");
assert.equal(portProbe.arrival, port.arrival);
assert.ok(portProbe.clear > portProbe.arrival);
assert.equal(portProbe.route.length, 0);
const afterArrival = model.probe(historical, syapru, syapru.arrival + 1);
assert.equal(afterArrival.status, "affected");
assert.equal(afterArrival.route.length, 0);

const routeProbe = model.probe(historical, syapru, syapru.notify);
assert.equal(routeProbe.status, "affected");
assert.ok(routeProbe.route.length > 1);
assert.ok(routeProbe.targetElevation >= routeProbe.elevation + 15);
const destination = routeProbe.route.at(-1);
assert.equal(historical.arrival[cell(historical.grid, destination)], Infinity);
let stepTime = syapru.notify + 0.55;
for (let index = 1; index < routeProbe.route.length; index++) {
  const a = routeProbe.route[index - 1], b = routeProbe.route[index];
  const aId = cell(historical.grid, a), bId = cell(historical.grid, b);
  const meters = Math.hypot(b.x - a.x, b.y - a.y) * historical.grid.cell;
  const slope = (historical.grid.heights[bId] - historical.grid.heights[aId]) / meters;
  const step = meters / 68 * (1 + Math.max(0, slope) * 3.3 + Math.max(0, -slope - 0.16) * 2.4);
  assert.ok(historical.arrival[aId] > stepTime + step / 2 + 0.25);
  stepTime += step;
  assert.ok(historical.arrival[bId] > stepTime + 0.25);
}
assert.ok(Math.abs(stepTime - syapru.notify - 0.55 - routeProbe.walk) < 0.00001);
assert.equal(model.probe(historical, { x: 0, y: 1 }, 0).status, "insufficient");
console.log("Adaptive footprint, wave-tail and time-constrained probe checks passed.");
