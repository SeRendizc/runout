(function () {
  'use strict';

  const runs = new Map();
  let sequence = 0;
  let catalog;

  async function load(name) {
    const response = await fetch(`replays/${name}.json`);
    if (!response.ok) throw new Error('回放文件暂时无法读取。');
    return response.json();
  }

  function advance(record, time) {
    const { run, events } = record;
    run.time = Math.min(run.duration, time);
    while (record.cursor < events.length && events[record.cursor].time <= run.time) {
      const event = events[record.cursor++];
      if (event.type === 'forecast') record.snapshot = event.data;
      record.emit?.(event);
    }
    if (run.time === run.duration) run.status = 'complete';
    record.emit?.({ type: 'clock', time: run.time, data: { ...run } });
  }

  async function request(path, body) {
    if (path === '/api/scenarios') return catalog ||= await load('catalog');
    if (path === '/api/method') return load('method');
    if (path === '/api/runs') {
      const scenario = catalog.scenarios.find(item => item.id === body.scenarioId);
      if (!scenario) throw new Error('找不到演练场景。');
      const events = await load(scenario.id);
      runs.clear();
      const run = { id: String(++sequence), scenarioId: scenario.id, duration: scenario.duration, time: 0,
        status: 'paused', speed: 1, mode: 'text-model', disabledSources: [] };
      runs.set(run.id, { run, events, scenario, cursor: 0, nextSeq: events.at(-1).seq });
      return { run: { ...run } };
    }
    const url = new URL(path, location.origin);
    const [, id, operation] = /^\/api\/runs\/([^/]+)\/(\w+)$/.exec(url.pathname) || [];
    const record = runs.get(id);
    if (!record) throw new Error('找不到当前演练。');
    const { run, snapshot, scenario } = record;
    if (operation === 'control') {
      if (run.status === 'complete') return { run: { ...run } };
      run.status = body.action === 'play' ? 'playing' : 'paused';
      run.speed = body.speed;
      advance(record, run.time + (body.action === 'step' ? body.seconds : 0));
      return { run: { ...run } };
    }
    if (operation === 'query') {
      if (!snapshot) return { result: { status: 'insufficient', reason: 'no-geolocated-physical-evidence' } };
      const [lon, lat, accuracy] = ['lon', 'lat', 'accuracy'].map(key => Number(url.searchParams.get(key)));
      const input = { lon, lat, accuracy, forecastVersion: snapshot.version };
      const details = { name: 'query_position', evidenceIds: snapshot.evidenceIds };
      const emit = (type, data) => record.emit?.({ type, data, time: run.time, seq: ++record.nextSeq });
      const start = performance.now();
      emit('tool.started', { ...details, input });
      try {
        const result = { ...window.RunoutPagesForecast.query(scenario, snapshot, lon, lat, accuracy, run.time),
          asOf: run.time, version: snapshot.version };
        emit('tool.succeeded', { ...details, result, elapsedMs: Math.round((performance.now() - start) * 100) / 100 });
        return { result };
      } catch (error) {
        emit('tool.failed', { ...details, message: error.message });
        throw error;
      }
    }
    throw new Error('此操作需要本地运行服务。');
  }

  function openStream(id) {
    const record = runs.get(id);
    const stream = { addEventListener() {}, close() { record.emit = undefined; } };
    record.emit = event => stream.onmessage?.({ data: JSON.stringify(event) });
    queueMicrotask(() => { if (record.emit) { stream.onopen?.(); advance(record, record.run.time); } });
    return stream;
  }

  let last = performance.now();
  setInterval(() => {
    const now = performance.now();
    for (const record of runs.values()) {
      if (record.run.status === 'playing') advance(record, record.run.time + (now - last) * record.run.speed / 1000);
    }
    last = now;
  }, 200);

  window.RunoutPagesReplay = { request, openStream };
})();
