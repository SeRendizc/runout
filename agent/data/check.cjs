"use strict";

const assert = require("node:assert/strict");
const { createHash } = require("node:crypto");
const { readFileSync } = require("node:fs");
const path = require("node:path");
const { catalog, loadScenario } = require("./index.cjs");
const corpus = require("./posts.cjs");

assert.deepEqual(catalog.map(x => x.id),
  ["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "andes"]);
const counts = { normal: 0, clue: 0, confounder: 0 };
const texts = new Set();
const records = new Map(corpus.map(row => [row.observation.id, row]));
for (const { observation, truth } of corpus) {
  counts[truth.label]++;
  texts.add(observation.text);
  if (observation.parentId) {
    const original = records.get(observation.parentId);
    assert.ok(original);
    assert.equal(original.truth.cluster, truth.cluster);
    assert.equal(original.truth.partition, truth.partition);
    assert.ok(original.observation.availableAt < observation.availableAt);
  }
}
assert.deepEqual(counts, { normal: 65, clue: 25, confounder: 30 });
assert.equal(texts.size, 120);
assert.deepEqual([...new Set(corpus.map(row => row.observation.language))].sort(), ["en", "ne", "zh"]);

for (const { id } of catalog) {
  const scenario = loadScenario(id);
  assert.ok(Number.isFinite(Date.parse(scenario.startAt)));
  const byId = new Map(scenario.observations.map(row => [row.id, row]));
  const sources = new Set(scenario.sources.map(source => source.id));
  assert.equal(scenario.observations.length, byId.size);
  assert.ok(scenario.terminals.length > 0);
  for (const { lon, lat, walkSeconds } of scenario.terminals) {
    assert.ok(Number.isFinite(lon) && Math.abs(lon) <= 180);
    assert.ok(Number.isFinite(lat) && Math.abs(lat) <= 90);
    assert.ok(Number.isFinite(walkSeconds) && walkSeconds >= 0);
  }
  let previous = 0;
  for (const row of scenario.observations) {
    assert.ok(row.availableAt >= previous && row.availableAt <= scenario.duration);
    assert.ok(row.observedAt >= 0 && row.observedAt <= row.availableAt);
    assert.ok(sources.has(row.sourceId));
    if (row.kind === "post") {
      assert.ok(!Object.hasOwn(row, "candidateLocation") && !Object.hasOwn(row, "partition"));
      assert.ok(row.publishedAt >= row.observedAt && row.publishedAt <= row.availableAt);
      if (row.parentId) assert.ok(byId.has(row.parentId));
    }
    if (row.releaseId) assert.ok(byId.has(row.releaseId));
    previous = row.availableAt;
  }
}

const scenario = loadScenario("01");
const real = scenario.observations.filter(x => !x.synthetic);
assert.equal(real.length, 1);
assert.equal(real[0].kind, "waveform");
assert.equal(real[0].evidenceScope, "waveform_anomaly_only");
assert.equal(real[0].availableAt, real[0].evidenceEndAt + real[0].replayIngestSeconds);
assert.equal(real[0].sourceHypothesisSynthetic, true);
assert.equal(real[0].picks.length, 2);
const bytes = readFileSync(path.join(__dirname, real[0].archive.path));
assert.equal(createHash("sha256").update(bytes).digest("hex"), real[0].archive.sha256);
scenario.observations.length = 0;
assert.ok(loadScenario("01").observations.length > 0);
console.log("Verified 11 independent scenario definitions, 120 synthetic posts and the raw-derived waveform cue.");
