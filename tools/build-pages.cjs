"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { execFileSync } = require("node:child_process");
const data = require("../agent/data/index.cjs");
const engine = require("../agent/forecast.cjs");
const model = require("../agent/text-model.cjs");
const { createHarness } = require("../agent/harness.cjs");
const { evaluate } = require("../agent/evaluation.cjs");

const output = process.argv[2];
if (!output) throw new Error("Usage: node tools/build-pages.cjs <output-directory>");
const root = path.resolve(output);
const dist = path.resolve(__dirname, "../dist");
if (fs.existsSync(root) && fs.readdirSync(root).length) throw new Error("Use an empty output directory.");
fs.cpSync(dist, root, { recursive: true });
fs.renameSync(path.join(root, "index.html"), path.join(root, "film.html"));
const page = fs.readFileSync(path.join(root, "agent.html"), "utf8")
  .replace('<html lang="zh-CN">', '<html lang="zh-CN" data-public-replay>')
  .replace('<script defer src="agent-ui.js">', '<script defer src="pages-forecast.js"></script>\n  <script defer src="pages-replay.js"></script>\n  <script defer src="agent-ui.js">')
  .replace('演练模式</span>', '公开回放</span>')
  .replace('<a id="method-link"', '<a href="film.html">三维演出</a>\n      <a id="method-link"')
  .replace('<details id="source-options"', '<details hidden id="source-options"')
  .replace('<label class="speed-control" for="agent-mode">', '<label hidden style="display:none" class="speed-control" for="agent-mode">')
  .replace('<details class="inject-box">', '<details class="inject-box" hidden>');
fs.writeFileSync(path.join(root, "index.html"), page);
fs.unlinkSync(path.join(root, "agent.html"));
const film = path.join(root, "film.html");
fs.writeFileSync(film, fs.readFileSync(film, "utf8").replace('http://127.0.0.1:8765/', './'));
fs.writeFileSync(path.join(root, ".nojekyll"), "");
fs.mkdirSync(path.join(root, "replays"));
const harness = createHarness(":memory:", data, engine, model);
try {
  const scenarios = data.catalog.map(({ id }) => {
    const { title, basin, startAt, duration, sources } = data.loadScenario(id);
    const run = harness.start(id, [], "text-model");
    harness.advance(run.id, duration);
    const events = harness.history(run.id);
    if (!events.some(event => event.type === "forecast")) throw new Error("Missing forecast for " + id);
    fs.writeFileSync(path.join(root, "replays", id + ".json"), JSON.stringify(events));
    return { id, title, basin, startAt, duration, sources };
  });
  fs.writeFileSync(path.join(root, "replays", "catalog.json"), JSON.stringify({ scenarios }));
  fs.writeFileSync(path.join(root, "replays", "method.json"), JSON.stringify(evaluate()));
} finally {
  harness.close();
}
execFileSync(process.env.RUNOUT_ESBUILD || "esbuild", [
  path.resolve(__dirname, "pages-forecast.cjs"), "--bundle", "--minify", "--platform=browser",
  "--outfile=" + path.join(root, "pages-forecast.js"),
], { stdio: "inherit" });
