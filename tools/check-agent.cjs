"use strict";

const assert = require("node:assert/strict");
const { mkdtempSync, rmSync } = require("node:fs");
const { tmpdir } = require("node:os");
const path = require("node:path");
const data = require("../agent/data/index.cjs");
const engine = require("../agent/forecast.cjs");
const model = require("../agent/text-model.cjs");
const { createHarness } = require("../agent/harness.cjs");

const dir = mkdtempSync(path.join(tmpdir(), "runout-agent-"));
const file = path.join(dir, "test.sqlite");
let harness = createHarness(file, data, engine, model);
function events(id, type) {
  return harness.history(id).filter(event => event.type === type);
}

try {
  const config = data.loadScenario("01");
  const waveform = config.observations.find(row => row.kind === "waveform");
  const observed = config.observations.filter(row => ["waveform", "camera", "gauge"].includes(row.kind));
  assert.equal(waveform.synthetic, false);
  const run = harness.start("01", [], "text-model");
  harness.advance(run.id, waveform.availableAt - 1);
  assert.equal(events(run.id, "forecast").length, 0);
  assert.equal(harness.query(run.id, 85.34, 28.16, 0).status, "insufficient");
  harness.advance(run.id, waveform.availableAt + 30);
  const first = events(run.id, "forecast")[0];
  assert.deepEqual(first.data.evidenceIds, [waveform.id]);
  assert.ok(events(run.id, "delivery").some(event => event.data.kind === "Alert" && event.data.status === "delivered"));

  const disabled = harness.start("01", [waveform.sourceId]);
  harness.advance(disabled.id, waveform.availableAt + 30);
  assert.equal(events(disabled.id, "forecast").length, 0);
  harness.advance(run.id, observed.at(-1).availableAt + 40);
  const revisions = events(run.id, "forecast");
  assert.ok(revisions.length >= 2);
  const windows = revisions.map(event => event.data.sites.find(site => site.id === "syapru"))
    .filter(site => site.status === "affected");
  assert.ok(windows.length >= 2);
  assert.ok(windows.some(site => site.earliest !== windows[0].earliest || site.latest !== windows[0].latest));
  const deliveries = events(run.id, "delivery");
  assert.ok(deliveries.some(event => event.data.kind === "Update" && event.data.status === "delivered"));
  const syapruUpdates = deliveries.filter(event =>
    event.data.targetId === "syapru" && event.data.kind === "Update" && event.data.status === "delivered");
  assert.ok(syapruUpdates.length >= 2);
  assert.ok(syapruUpdates[0].data.margin > 0 && syapruUpdates[1].data.margin <= 0);
  assert.ok(events(run.id, "tool.succeeded").some(event => event.data.name === "classify_text"));

  const forecast = revisions.at(-1).data;
  const site = config.terminals.find(point => point.id === "syapru");
  const position = harness.query(run.id, site.lon, site.lat, 0);
  assert.equal(position.version, forecast.version);
  assert.equal(position.asOf, harness.get(run.id).time);
  assert.equal(harness.query(run.id, 0, 0, 10).status, "insufficient");
  assert.ok(events(run.id, "decision").some(event => /排除/.test(event.data.message)));
  assert.ok(events(run.id, "decision").some(event => /暂缓/.test(event.data.message)));
  assert.ok(events(run.id, "decision").some(event => /同一线索/.test(event.data.message)));
  const persisted = harness.history(run.id);
  harness.close();
  harness = createHarness(file, data, engine, model);
  assert.deepEqual(harness.history(run.id), persisted);
  assert.deepEqual(harness.history(run.id, persisted.at(-2).seq), persisted.slice(-1));

  // Holding out later observations must not change an earlier forecast.
  const replay = harness.start("01");
  const prefix = waveform.availableAt + 30;
  harness.advance(replay.id, prefix);
  assert.deepEqual(events(replay.id, "forecast")[0].data, first.data);
  const injected = {
    id: "early-manual-gauge", kind: "gauge", sourceId: "manual-test", synthetic: true,
    observedAt: prefix - 4, availableAt: prefix, lon: site.lon, lat: site.lat, role: "downstream_constraint"
  };
  harness.inject(replay.id, injected);
  assert.equal(events(replay.id, "observation").at(-1).data.id, injected.id);
  assert.deepEqual(events(replay.id, "forecast")[0].data, first.data);

  for (const item of data.catalog) {
    const another = harness.start(item.id);
    const completed = harness.advance(another.id, another.duration);
    assert.equal(completed.status, "complete", item.id);
    const snapshots = events(another.id, "forecast").map(event => event.data);
    assert.ok(snapshots.length > 0, item.id);
    assert.ok(snapshots.some(snapshot => snapshot.presentation.wet.length > 0), item.id);
    for (const snapshot of snapshots) {
      assert.equal(snapshot.presentation.waves.length, snapshot.sources.length, item.id);
      assert.equal(snapshot.presentation.wet.length % 2, 0, item.id);
      for (const wave of snapshot.presentation.waves) {
        assert.ok(wave.path.length > 0, item.id);
        assert.ok(wave.path.every(point => Number.isFinite(point.minute)), item.id);
      }
    }
    assert.equal(events(another.id, "tool.failed").length, 0, item.id);
  }
  console.log(JSON.stringify({
    scenarios: data.catalog.length,
    firstForecastSeconds: first.time, revisions: revisions.length,
    syapruWindows: windows.map(site => [site.earliest, site.latest]),
    deliveredInitialAndUpdates: deliveries.filter(event => event.data.status === "delivered").map(event =>
      [event.data.name, event.data.kind, event.time]),
    heldOutSyntheticText: model.evaluate()
  }, null, 2));
} finally {
  harness.close();
  rmSync(dir, { recursive: true, force: true });
}
