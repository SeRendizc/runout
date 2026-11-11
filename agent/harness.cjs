"use strict";

const { randomUUID } = require("node:crypto");
const { performance } = require("node:perf_hooks");
const { DatabaseSync } = require("node:sqlite");

function location(text, terminals) {
  const aliases = {
    port: ["rasuwagadhi", "rasuwagadi", "gyirong", "吉隆", "रसुवागढी"],
    timure: ["timure", "टिमुरे", "提姆雷"],
    syapru: ["syapru", "syabru", "स्याफ्रु", "स्याब्रु", "沙布鲁"]
  };
  const normalized = text.toLowerCase();
  return terminals.filter(site =>
    [site.name, ...(aliases[site.id] ?? [])].some(name => name && normalized.includes(name.toLowerCase()))
  ).map(({ id, name }) => ({ id, name }));
}

function claim(text) {
  if (/旧闻|去年|转发自|old footage|last year|पुरानो|गत वर्ष/iu.test(text)) return "stale";
  if (/泥石流|河水暴涨|冰崩|洪水|过流|debris flow|river (rose|surged)|flood|बाढी|पहिरो|लेदो/iu.test(text)) return "candidate";
  return "irrelevant";
}

function createHarness(filename, { loadScenario }, engine, textModel) {
  const db = new DatabaseSync(filename);
  db.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA journal_mode = WAL;
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY, scenario_id TEXT NOT NULL, time REAL NOT NULL, duration REAL NOT NULL,
      status TEXT NOT NULL, speed REAL NOT NULL, disabled TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS run_manifest (
      run_id TEXT PRIMARY KEY REFERENCES runs(id), payload TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS observations (
      run_id TEXT NOT NULL REFERENCES runs(id), id TEXT NOT NULL, available REAL NOT NULL,
      payload TEXT NOT NULL, PRIMARY KEY(run_id,id)
    );
    CREATE TABLE IF NOT EXISTS run_events (
      run_id TEXT NOT NULL REFERENCES runs(id), seq INTEGER NOT NULL, time REAL NOT NULL,
      type TEXT NOT NULL, payload TEXT NOT NULL, PRIMARY KEY(run_id,seq)
    );
    CREATE INDEX IF NOT EXISTS events_by_type ON run_events(run_id,type,seq);
    CREATE TABLE IF NOT EXISTS forecasts (
      run_id TEXT NOT NULL REFERENCES runs(id), version INTEGER NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY(run_id,version)
    );
    CREATE TABLE IF NOT EXISTS deliveries (
      run_id TEXT NOT NULL REFERENCES runs(id), target_id TEXT NOT NULL, version INTEGER NOT NULL,
      due REAL NOT NULL, status TEXT NOT NULL, payload TEXT NOT NULL,
      PRIMARY KEY(run_id,target_id,version)
    );
    UPDATE runs SET status='paused' WHERE status='playing';
  `);
  if (!db.prepare("PRAGMA table_info(runs)").all().some(column => column.name === "mode")) {
    db.exec("ALTER TABLE runs ADD COLUMN mode TEXT NOT NULL DEFAULT 'rules'");
  }
  const row = db.prepare("SELECT * FROM runs WHERE id=?");
  const eventInsert = db.prepare(`
    INSERT INTO run_events SELECT ?, COALESCE(MAX(seq),0)+1, ?, ?, ?
    FROM run_events WHERE run_id=? RETURNING seq
  `);
  const insertObservation = db.prepare("INSERT INTO observations VALUES (?,?,?,?)");
  const latestForecast = db.prepare("SELECT payload FROM forecasts WHERE run_id=? ORDER BY version DESC LIMIT 1");
  const subscribers = new Map();
  const eventsAfter = db.prepare("SELECT seq,time,type,payload FROM run_events WHERE run_id=? AND seq>? ORDER BY seq");
  const accepted = db.prepare("SELECT payload FROM run_events WHERE run_id=? AND type='evidence.accepted' ORDER BY seq");
  const readForecast = id => JSON.parse(latestForecast.get(id)?.payload ?? "null");
  function scenario(run) {
    const stored = db.prepare("SELECT payload FROM run_manifest WHERE run_id=?").get(run.id);
    if (stored) return JSON.parse(stored.payload);
    const { observations, ...config } = loadScenario(run.scenarioId);
    return config;
  }
  function get(id) {
    const stored = row.get(id);
    if (!stored) return null;
    const { scenario_id: scenarioId, disabled, ...run } = stored;
    return { ...run, scenarioId, disabledSources: JSON.parse(disabled) };
  }
  function history(id, after = 0) {
    return eventsAfter.all(id, after).map(({ payload, ...event }) => ({ ...event, data: JSON.parse(payload) }));
  }
  function publish(id, event) {
    for (const cb of subscribers.get(id) ?? []) cb(event);
  }
  function transaction(id, fn) {
    const events = [];
    db.exec("BEGIN IMMEDIATE");
    const emit = (time, type, data) => {
      const { seq } = eventInsert.get(id, time, type, JSON.stringify(data), id);
      events.push({ seq, time, type, data });
    };
    let result;
    try {
      result = fn(emit);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    for (const event of events) publish(id, event);
    return result;
  }
  function start(scenarioId, disabledSources = [], mode = 'rules') {
    const config = loadScenario(scenarioId);
    const id = randomUUID();
    transaction(id, emit => {
      db.prepare("INSERT INTO runs (id,scenario_id,time,duration,status,speed,disabled,mode) VALUES (?,?,0,?,'paused',1,?,?)")
        .run(id, scenarioId, config.duration, JSON.stringify(disabledSources), mode);
      const { observations, ...manifest } = config;
      db.prepare("INSERT INTO run_manifest VALUES (?,?)").run(id, JSON.stringify(manifest));
      for (const observation of observations) {
        insertObservation.run(id, observation.id, observation.availableAt, JSON.stringify(observation));
      }
      emit(0, "decision", {
        message: `已载入 ${observations.length} 条观测。等待当前时刻可见的证据。`,
        mode, evidenceIds: []
      });
    });
    return get(id);
  }
  function tool(emit, time, name, evidenceIds, work, summarize = value => value, input) {
    const started = performance.now();
    emit(time, "tool.started", { name, evidenceIds, ...(input ? { input } : {}) });
    try {
      const result = work();
      emit(time, "tool.succeeded", {
        name, evidenceIds, result: summarize(result), elapsedMs: Math.round((performance.now() - started) * 100) / 100
      });
      return result;
    } catch (error) {
      emit(time, "tool.failed", { name, evidenceIds, message: error.message, elapsedMs: Math.round((performance.now() - started) * 100) / 100 });
      return null;
    }
  }
  function receive(run, config, observation, time, emit) {
    const { label, partition, familyId, ...input } = observation;
    emit(time, "observation", input);
    function decide(message) {
      emit(time, "decision", { message, evidenceIds: [input.id] });
    }
    if (run.disabledSources.includes(input.sourceId) || run.disabledSources.includes(input.kind)) {
      decide("本轮关闭了此来源，观测未进入预测。");
      return;
    }
    if (input.kind === "post") {
      const text = typeof input.text === "string" ? input.text : "";
      const candidate = tool(emit, time, "extract_claim", [input.id], () => ({ status: claim(text), excerpt: text.slice(0, 140) }));
      const classified = run.mode === "text-model" && candidate?.status !== "stale" && textModel
        ? tool(emit, time, "classify_text", [input.id], () => textModel.classify(text, input.language)) : null;
      if (candidate?.status !== "candidate" && classified?.status !== "candidate" && !input.parentId) {
        decide(candidate?.status === "stale" ? "旧闻或转发标记，排除。" : "未识别到现场灾害主张，排除。");
        return;
      }
      const places = tool(emit, time, "match_location", [input.id], () => location(text, config.terminals));
      const duplicates = tool(emit, time, "check_independence", [input.id], () => {
        const matches = db.prepare("SELECT payload FROM run_events WHERE run_id=? AND type='observation' ORDER BY seq").all(run.id)
          .map(record => JSON.parse(record.payload)).filter(other => other.id !== input.id && other.kind === "post");
        return { duplicateOf: matches.find(other => other.id === input.parentId || (text.trim() && other.text?.trim() === text.trim()))?.id ?? null };
      });
      if (duplicates?.duplicateOf || input.parentId) {
        decide(duplicates?.duplicateOf ? "已关联已有贴文，合并为同一线索。" : "转发的原始贴文当前不可见，暂缓使用。");
      } else if (places?.length !== 1) {
        decide("目击位置未确认，暂缓使用。");
      } else {
        decide("保留为人工查证线索。地点提及无法独立确认波前或改变速度。");
      }
      return;
    }
    if (!["waveform", "camera", "gauge"].includes(input.kind)) {
      decide("已归档状态或资料，等待可定位的物理观测。");
      return;
    }
    if (!Number.isFinite(input.lon) || !Number.isFinite(input.lat) || !Number.isFinite(input.observedAt) || input.observedAt > time) {
      decide("观测缺少有效的时空锚点。");
      return;
    }
    emit(time, "evidence.accepted", input);
    const evidence = accepted.all(run.id).map(record => JSON.parse(record.payload));
    const previous = readForecast(run.id);
    const snapshot = tool(emit, time, "revise_forecast", evidence.map(item => item.id), () =>
      engine.forecast(config, evidence, time, (previous?.version ?? 0) + 1),
      result => ({ version: result.version, source: result.source, evidenceIds: result.evidenceIds, sites: result.sites }));
    if (!snapshot) return;
    db.prepare("INSERT INTO forecasts VALUES (?,?,?)").run(run.id, snapshot.version, JSON.stringify(snapshot));
    emit(time, "forecast", snapshot);
    const affected = snapshot.sites.filter(site => site.status === "affected").length;
    const rejected = snapshot.rejectedEvidenceIds?.length ?? 0;
    emit(time, "decision", {
      message: snapshot.source
        ? `已重算 v${snapshot.version}。模型覆盖 ${affected} 个接收点，排除 ${rejected} 个不相容锚点。`
        : "尚无可用源区定位，返回资料不足。",
      evidenceIds: snapshot.evidenceIds
    });
    if (!snapshot.source) return;
    const targets = tool(emit, time, "propose_alert", snapshot.evidenceIds, () => {
      const proposals = [];
      for (const site of snapshot.sites) {
        const prior = db.prepare(`SELECT payload FROM deliveries WHERE run_id=? AND target_id=? AND status='delivered' ORDER BY version DESC LIMIT 1`).get(run.id, site.id);
        const delivered = prior ? JSON.parse(prior.payload) : null;
        if (site.status !== "affected") {
          if (delivered && delivered.kind !== "Cancel" && site.status === "outside") proposals.push({ site, kind: "Cancel", priorVersion: delivered.version });
          continue;
        }
        if (site.phase === "past-modeled-window" || site.latest <= time) continue;
        if (!delivered || delivered.kind === "Cancel") proposals.push({ site, kind: "Alert" });
        else {
          const newWave = site.waves?.some(wave => !(delivered.waves ?? []).some(previous => previous.sourceId === wave.sourceId));
          if (newWave || Math.abs(site.earliest - delivered.earliest) >= 5 || Math.abs(site.latest - delivered.latest) >= 5) {
            proposals.push({ site, kind: "Update", priorVersion: delivered.version });
          }
        }
      }
      return proposals;
    });
    if (!targets) return;
    const pending = db.prepare("SELECT target_id,version,payload FROM deliveries WHERE run_id=? AND status='queued' ORDER BY version,target_id").all(run.id);
    db.prepare("UPDATE deliveries SET status='superseded' WHERE run_id=? AND status='queued'").run(run.id);
    for (const item of pending) emit(time, "delivery", { ...JSON.parse(item.payload), status: "superseded" });
    targets.forEach(({ site, kind, priorVersion }, index) => {
      const due = time + 12 + index * 2;
      const payload = {
        targetId: site.id, name: site.name, lon: site.lon, lat: site.lat,
        version: snapshot.version, kind, priorVersion, earliest: site.earliest,
        latest: site.latest, waves: site.waves, margin: Number.isFinite(site.margin) ? site.margin - (due - time) : null,
        evidenceIds: snapshot.evidenceIds, exercise: true,
        instruction: kind === "Cancel" ? "旧版区域判断已撤回，等待当地正式解除信息。"
          : site.earliest <= due ? "可能已进入到达窗口，候选路线需要现场核验。" : "关注可能到达窗口，查看本场演练路线。"
      };
      db.prepare("INSERT INTO deliveries VALUES (?,?,?,?,?,?)").run(run.id, site.id, snapshot.version, due, "queued", JSON.stringify(payload));
      emit(time, "alert", { ...payload, status: "queued", due });
    });
  }
  function advance(id, end) {
    const run = get(id);
    if (!run) return null;
    const limit = Math.max(run.time, Math.min(run.duration, end));
    const config = scenario(run);
    const nextObservation = db.prepare(`
      SELECT o.payload,o.available FROM observations o
      WHERE o.run_id=? AND o.available<=?
      AND NOT EXISTS (SELECT 1 FROM run_events e WHERE e.run_id=o.run_id AND e.type='observation' AND json_extract(e.payload,'$.id')=o.id)
      ORDER BY o.available,o.id LIMIT 1
    `);
    const nextDelivery = db.prepare("SELECT * FROM deliveries WHERE run_id=? AND status='queued' AND due<=? ORDER BY due,target_id LIMIT 1");
    transaction(id, emit => {
      for (;;) {
        const observation = nextObservation.get(id, limit);
        const delivery = nextDelivery.get(id, limit);
        if (!observation && !delivery) break;
        if (observation && (!delivery || observation.available <= delivery.due)) {
          receive(run, config, JSON.parse(observation.payload), Math.max(run.time, observation.available), emit);
        } else {
          const payload = JSON.parse(delivery.payload);
          const status = payload.kind !== "Cancel" && payload.latest <= delivery.due ? "expired" : "delivered";
          db.prepare("UPDATE deliveries SET status=? WHERE run_id=? AND target_id=? AND version=?")
            .run(status, id, delivery.target_id, delivery.version);
          emit(delivery.due, "delivery", { ...payload, status, ...(status === "delivered" ? { receivedAt: delivery.due } : {}) });
        }
      }
      db.prepare("UPDATE runs SET time=?, status=? WHERE id=?").run(limit, limit >= run.duration ? "complete" : run.status, id);
    });
    const current = get(id);
    publish(id, { type: "clock", time: current.time, data: current });
    return current;
  }
  function control(id, action, speed, seconds) {
    const run = get(id);
    if (!run || run.status === "complete") return run;
    db.prepare("UPDATE runs SET status=?,speed=? WHERE id=?")
      .run(action === "play" ? "playing" : "paused", speed ?? run.speed, id);
    if (action === "step") return advance(id, run.time + (seconds ?? 30));
    const current = get(id);
    publish(id, { type: "clock", time: current.time, data: current });
    return current;
  }
  function inject(id, observation) {
    const run = get(id);
    if (!run || run.status === "complete") return null;
    insertObservation.run(id, observation.id, observation.availableAt, JSON.stringify(observation));
    return advance(id, run.time);
  }
  function query(id, lon, lat, accuracy) {
    const run = get(id);
    if (!run) return null;
    const snapshot = readForecast(id);
    if (!snapshot) return { status: "insufficient", reason: "等待初报。", earliest: null, latest: null };
    return transaction(id, emit => tool(emit, run.time, "query_position", snapshot.evidenceIds, () => ({
      ...engine.query(scenario(run), snapshot, lon, lat, accuracy, run.time), version: snapshot.version, asOf: run.time
    }), undefined, { lon, lat, accuracy, forecastVersion: snapshot.version })) ?? { status: "insufficient", reason: "位置工具执行失败。", earliest: null, latest: null };
  }
  function subscribe(id, fn) {
    if (!subscribers.has(id)) subscribers.set(id, new Set());
    const list = subscribers.get(id);
    list.add(fn);
    return () => {
      list.delete(fn);
      if (!list.size) subscribers.delete(id);
    };
  }
  function tick(seconds) {
    for (const run of db.prepare("SELECT id,time,speed FROM runs WHERE status='playing'").all()) {
      advance(run.id, run.time + seconds * run.speed);
    }
  }
  return { start, get, history, advance, control, inject, query, subscribe, tick, close: () => db.close() };
}

module.exports = { createHarness };
