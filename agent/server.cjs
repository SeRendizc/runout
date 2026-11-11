"use strict";

const http = require("node:http");
const { createReadStream } = require("node:fs");
const { stat } = require("node:fs/promises");
const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const path = require("node:path");
const { createHarness } = require("./harness.cjs");
const data = require("./data/index.cjs");
const engine = require("./forecast.cjs");
const textModel = require("./text-model.cjs");
const { evaluate } = require("./evaluation.cjs");

const port = Number(process.env.RUNOUT_PORT ?? 8765);
const harness = createHarness(process.env.RUNOUT_DB ?? path.join(__dirname, "runout.sqlite"), data, engine, textModel);
const dist = path.resolve(__dirname, "../dist");
let evaluation;
const mime = {
  ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8", ".jpg": "image/jpeg", ".png": "image/png",
  ".svg": "image/svg+xml", ".json": "application/json", ".txt": "text/plain; charset=utf-8"
};

function json(res, status, value) {
  res.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" });
  res.end(JSON.stringify(value));
}

function invalid(message) {
  throw Object.assign(new Error(message), { status: 400 });
}

async function body(req) {
  if (!req.headers["content-type"]?.startsWith("application/json")) invalid("需要 JSON 请求体。");
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 8192) invalid("请求体超过大小限制。");
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString()); }
  catch { invalid("JSON 请求体无效。"); }
  if (!value || typeof value !== "object" || Array.isArray(value)) invalid("需要 JSON 对象。");
  return value;
}

function number(value, min, max, name) {
  if (!Number.isFinite(value) || value < min || value > max) invalid(name + " 超出允许范围。");
  return value;
}

function connect(req, res, id, url) {
  const raw = req.headers["last-event-id"] ?? url.searchParams.get("after") ?? "0";
  const cursor = number(Number(raw), 0, Number.MAX_SAFE_INTEGER, "游标");
  if (!Number.isSafeInteger(cursor)) invalid("游标必须为整数。");
  res.writeHead(200, {
    "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store",
    Connection: "keep-alive", "X-Accel-Buffering": "no"
  });
  const queue = harness.history(id, cursor);
  const run = harness.get(id);
  queue.push({ type: "clock", time: run.time, data: run });
  function flush() {
    while (queue.length && !res.writableNeedDrain && !res.destroyed) {
      const event = queue.shift();
      const prefix = event.seq === undefined ? "" : "id: " + event.seq + "\n";
      res.write(prefix + "data: " + JSON.stringify(event) + "\n\n");
    }
  }
  const off = harness.subscribe(id, event => {
    if (event.type === "clock" && queue.at(-1)?.type === "clock") queue.pop();
    queue.push(event);
    if (queue.length > 5000) res.destroy();
    else flush();
  });
  res.on("drain", flush);
  const heartbeat = setInterval(() => {
    if (!queue.length && !res.writableNeedDrain) res.write(": heartbeat\n\n");
  }, 15000);
  res.on("close", () => { clearInterval(heartbeat); off(); });
  flush();
}

function inject(run, input) {
  const common = { id: "manual-" + randomUUID(), sourceId: "operator-exercise", availableAt: run.time, synthetic: true };
  if (input.kind === "post") {
    if (typeof input.text !== "string" || !input.text.trim() || input.text.length > 600) invalid("贴文需要 1–600 个字符。");
    return { ...common, kind: "post", text: input.text, observedAt: run.time };
  }
  if (!["gauge", "camera"].includes(input.kind)) invalid("支持 gauge、camera 或 post。");
  const observedAt = number(input.observedAt ?? run.time, 0, run.time, "观测时刻");
  return {
    ...common, kind: input.kind, observedAt, lon: number(input.lon, -180, 180, "经度"),
    lat: number(input.lat, -90, 90, "纬度"), feature: "passage", role: "arrival", quality: "manual-exercise"
  };
}

async function api(req, res, url) {
  if (url.pathname === "/api/method" && req.method === "GET") {
    evaluation ??= evaluate();
    return json(res, 200, evaluation);
  }
  if (url.pathname === "/api/scenarios" && req.method === "GET") {
    const scenarios = data.catalog.map(entry => {
      const { id, title, basin, startAt, duration, sources } = data.loadScenario(typeof entry === "string" ? entry : entry.id);
      return { id, title, basin, startAt, duration, sources };
    });
    return json(res, 200, { scenarios });
  }
  if (url.pathname === "/api/runs" && req.method === "POST") {
    const { scenarioId, disabledSources = [], mode = "rules" } = await body(req);
    if (!["rules", "text-model"].includes(mode)) invalid("未知筛选模式。");
    if (!data.catalog.some(item => (typeof item === "string" ? item : item.id) === scenarioId)) invalid("未知场景。");
    if (!Array.isArray(disabledSources) || disabledSources.length > 32 ||
        disabledSources.some(id => typeof id !== "string" || id.length > 128)) invalid("来源列表无效。");
    return json(res, 201, { run: harness.start(scenarioId, disabledSources, mode) });
  }
  const match = /^\/api\/runs\/([a-z0-9-]+)(?:\/(control|events|query|inject))?$/.exec(url.pathname);
  const run = match && harness.get(match[1]);
  if (!run) return json(res, 404, { error: "未找到请求的运行或接口。" });
  const operation = match[2];
  if (req.method === "GET" && operation === "events") return connect(req, res, run.id, url);
  if (req.method === "GET" && !operation) return json(res, 200, { run });
  if (req.method === "GET" && operation === "query") {
    if (!url.searchParams.get("lon")?.trim() || !url.searchParams.get("lat")?.trim()) invalid("请提供经纬度。");
    const lon = number(Number(url.searchParams.get("lon")), -180, 180, "经度");
    const lat = number(Number(url.searchParams.get("lat")), -90, 90, "纬度");
    const accuracy = number(Number(url.searchParams.get("accuracy") ?? 0), 0, 10000, "定位精度");
    return json(res, 200, { result: harness.query(run.id, lon, lat, accuracy) });
  }
  if (req.method === "POST" && operation === "control") {
    const { action, speed, seconds } = await body(req);
    if (!["play", "pause", "step"].includes(action)) invalid("未知时钟操作。");
    if (speed !== undefined) number(speed, 0.25, 120, "播放速度");
    if (seconds !== undefined) number(seconds, 0.1, 86400, "推进秒数");
    return json(res, 200, { run: harness.control(run.id, action, speed, seconds) });
  }
  if (req.method === "POST" && operation === "inject") {
    const input = inject(harness.get(run.id), await body(req));
    const changed = harness.inject(run.id, input);
    return changed ? json(res, 200, { run: changed, observation: input }) : json(res, 409, { error: "运行已结束。" });
  }
  return json(res, 405, { error: "请求方法无效。" });
}

const server = http.createServer(async (req, res) => {
  try {
    const host = req.headers.host ?? "";
    if (!/^(?:127\.0\.0\.1|localhost)(?::\d+)?$/.test(host)) return json(res, 403, { error: "使用本地地址访问。" });
    if (req.headers.origin && req.headers.origin !== "http://" + host) return json(res, 403, { error: "来源无效。" });
    const url = new URL(req.url, "http://" + host);
    if (url.pathname.startsWith("/api/")) return await api(req, res, url);
    if (!["GET", "HEAD"].includes(req.method)) return json(res, 405, { error: "请求方法无效。" });
    const page = url.pathname === "/" ? "/agent.html" : decodeURIComponent(url.pathname);
    const file = path.resolve(dist, "." + page);
    if (!file.startsWith(dist + path.sep) || !mime[path.extname(file)]) return json(res, 404, { error: "未找到页面。" });
    const info = await stat(file).catch(() => null);
    if (!info?.isFile()) return json(res, 404, { error: "未找到页面。" });
    res.writeHead(200, { "Content-Type": mime[path.extname(file)], "Content-Length": info.size, "Cache-Control": "no-cache" });
    if (req.method === "HEAD") res.end();
    else createReadStream(file).on("error", () => res.destroy()).pipe(res);
  } catch (error) {
    if (!error.status) console.error(error);
    if (!res.headersSent && !res.destroyed) json(res, error.status ?? 500, { error: error.status ? error.message : "运行处理失败。" });
    else res.destroy();
  }
});

let previous = performance.now();
const timer = setInterval(() => {
  const now = performance.now();
  try { harness.tick((now - previous) / 1000); }
  catch (error) { console.error(error); }
  previous = now;
}, 250);
server.listen(port, "127.0.0.1", () => {
  console.log("RUNOUT Agent Live · http://127.0.0.1:" + server.address().port + "/");
});
function shutdown() {
  clearInterval(timer);
  server.close(() => { harness.close(); });
  server.closeAllConnections();
}
process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
