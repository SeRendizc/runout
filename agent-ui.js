(function () {
  'use strict';

  const get = (id) => document.getElementById(id);
  const svgNS = 'http://www.w3.org/2000/svg';
  const finite = Number.isFinite;
  const knownEvents = ['observation', 'tool.started', 'tool.succeeded', 'tool.failed', 'decision', 'forecast', 'alert', 'delivery', 'clock'];
  const state = {
    scenarios: [], run: null, stream: null, seen: new Set(), events: [], observations: new Map(), deliveries: new Map(),
    forecast: null, grid: null, point: null, result: null, busy: false, injecting: false, tab: 'trace', traceLimit: 32, expanded: false,
    receiptPulses: new Map(), streamReady: false, watchPoint: false,
    beats: [], inspectedBeat: null, liveBeat: null, pointName: null,
  };
  let queryRequest = 0;
  let pendingRender = 0;
  const terrainCache = new WeakMap();
  const scene = window.RunoutAgentScene.create(get('agent-scene'), get('scene-notification'), {
    clock, windowText, signed,
    onSelect(lon, lat, siteId) {
      const name = state.forecast?.data.sites.find(site => site.id === siteId)?.name;
      pickPoint(lon, lat, name);
    },
    onReceiptShown(event) {
      const beat = state.beats.find(item => item.seq === event.seq);
      if (beat && (!state.liveBeat || beat.seq >= state.liveBeat.seq)) {
        state.liveBeat = beat;
        renderStory();
      }
    },
  });
  const modeButtons = [...document.querySelectorAll('[data-scene-mode]')];

  function sceneView(mode) {
    try { scene.setView(mode); }
    catch {
      mode = 'map';
      scene.setView(mode);
      for (const button of modeButtons) {
        if (button.dataset.sceneMode !== 'map') button.disabled = true;
      }
    }
    for (const button of modeButtons) button.setAttribute('aria-pressed', String(button.dataset.sceneMode === mode));
  }

  function updateScene() {
    const result = effectivePointResult();
    scene.update({ ...state, result, forecast: state.forecast?.data });
    const panel = get('scene-position');
    panel.hidden = !result;
    if (result) {
      const [status] = positionVerdict(result);
      const arrival = finite(result.earliest) ? ` · 最早 ${clock(result.earliest)}` : '';
      const elevation = finite(result.targetElevation) ? ` · 演练目标海拔 ${Math.round(result.targetElevation)} m` : '';
      const text = `${status}${arrival}${elevation}`;
      if (panel.textContent !== text) panel.textContent = text;
    }
    if (result && state.point) {
      renderQuery(result, state.point);
      if (!result.route?.length) get('map-geometry').querySelector('.map-route')?.remove();
    }
    renderReview();
  }

  function renderReview() {
    const panel = get('run-review');
    panel.hidden = !isFinished();
    if (panel.hidden) return;
    const receipts = new Map();
    for (const event of state.events) {
      if (event.type === 'delivery' && event.data.status === 'delivered' && event.data.kind === 'Alert') {
        if (!receipts.has(event.data.targetId)) receipts.set(event.data.targetId, event.data);
      }
    }
    const measured = [...receipts.values()].filter(item => finite(item.margin));
    const positive = measured.filter(item => item.margin > 0).length;
    const versions = state.events.filter(event => event.type === 'forecast').length;
    const summary = `${versions} 版预测 · ${receipts.size} 个终端首次送达${measured.length ? ` · ${positive}/${measured.length} 个可估算点位在送达时有正撤离余量` : ''}`;
    if (panel.dataset.summary !== summary) {
      panel.dataset.summary = summary;
      panel.replaceChildren(node('strong', '演练复盘'), node('span', summary),
        node('small', '余量按本次模型和演练路径计算，供比较不同证据与分发配置。'));
    }
  }


  function node(tag, content, className) {
    const element = document.createElement(tag);
    if (content !== undefined) element.textContent = content;
    if (className) element.className = className;
    return element;
  }

  function svg(tag, attributes) {
    const element = document.createElementNS(svgNS, tag);
    for (const [key, value] of Object.entries(attributes)) element.setAttribute(key, value);
    return element;
  }

  function clock(seconds) {
    if (!finite(seconds)) return '—';
    const total = Math.max(0, Math.round(seconds));
    return `T+${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
  }

  function duration(seconds) {
    if (!finite(seconds)) return '—';
    const total = Math.round(Math.abs(seconds));
    const minutes = Math.floor(total / 60);
    return minutes ? `${minutes} 分${total % 60 ? ` ${total % 60} 秒` : ''}` : `${total} 秒`;
  }

  function signed(seconds) {
    return `${seconds < 0 ? '−' : '+'}${duration(seconds)}`;
  }

  function windowText(earliest, latest) {
    if (!finite(earliest) && !finite(latest)) return '时间待判读';
    return finite(earliest) && finite(latest) && earliest !== latest ? `${clock(earliest)}–${clock(latest)}` : clock(earliest ?? latest);
  }

  function versionText(version) {
    if (version === undefined || version === null) return '—';
    return /^\d+$/.test(String(version)) ? `v${version}` : String(version);
  }

  function hazardStatus(status) {
    if (['affected', 'at-risk', 'warning', 'watch', 'possible'].includes(status)) return ['预计受影响', 'impact'];
    if (['outside', 'not-detected', 'clear'].includes(status)) return ['本次估计未覆盖', 'other'];
    return ['资料不足', 'unknown'];
  }

  function isPlaying() { return ['playing', 'running'].includes(state.run?.status); }

  function isFinished() {
    return ['complete', 'completed', 'finished', 'ended'].includes(state.run?.status)
      || (finite(state.run?.duration) && state.run.duration > 0 && state.run.time >= state.run.duration);
  }

  async function request(path, body) {
    if (window.RunoutPagesReplay) return window.RunoutPagesReplay.request(path, body);
    const response = await fetch(path, body === undefined ? {} : {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
    });
    let payload;
    try { payload = await response.json(); }
    catch { throw new Error('运行服务返回了无法读取的结果。'); }
    if (!response.ok) throw new Error(payload.error?.message || payload.error || payload.message || `服务错误 ${response.status}`);
    return payload;
  }

  function runPath(suffix = '') { return `/api/runs/${encodeURIComponent(state.run.id)}${suffix}`; }

  function showError(message) {
    const error = get('live-error');
    error.textContent = message || '';
    error.hidden = !message;
  }

  function streamState(label, tone = 'muted') {
    const indicator = get('stream-state');
    indicator.textContent = label;
    indicator.dataset.tone = tone;
  }

  function updateControls() {
    get('new-run').disabled = state.busy || !state.scenarios.length;
    get('scenario').disabled = state.busy || !state.scenarios.length;
    get('agent-mode').disabled = state.busy;
    get('toggle-run').disabled = !state.run || state.busy || isFinished();
    get('step-run').disabled = !state.run || state.busy || isFinished();
    get('query-button').disabled = !state.run;
    get('inject-button').disabled = !state.run || state.injecting || isFinished();
    get('toggle-run').textContent = isPlaying() ? '暂停' : '播放';
    get('run-time').textContent = clock(state.run?.time ?? 0);
    get('run-duration').textContent = clock(state.run?.duration);
    const progress = get('run-progress');
    progress.max = state.run?.duration || 1;
    progress.value = state.run?.time ?? 0;
  }

  function selectedScenario() {
    return state.scenarios.find((scenario) => scenario.id === get('scenario').value);
  }

  function scenarioOfRun() {
    return state.scenarios.find((scenario) => scenario.id === state.run?.scenarioId) || selectedScenario();
  }

  function sourceInfo(value) {
    return typeof value === 'string' ? { id: value, name: value } : {
      ...value, id: value.id || value.sourceId, name: value.label || value.name || value.title || value.id || value.sourceId,
    };
  }

  function updateSourceCount() {
    const count = get('source-checks').querySelectorAll('input:checked').length;
    get('source-count').textContent = count ? `关闭 ${count}` : '';
    get('source-count').hidden = !count;
  }

  function updateSourceOptions() {
    const sources = (selectedScenario()?.sources || []).map(sourceInfo)
      .filter((source) => source.id && !source.referenceOnly && source.disableable !== false);
    get('source-checks').replaceChildren(...sources.map((source) => {
      const label = node('label');
      const checkbox = node('input');
      checkbox.type = 'checkbox';
      checkbox.value = source.id;
      label.append(checkbox, node('span', source.name || source.id));
      return label;
    }));
    if (!sources.length) get('source-checks').append(node('p', '该场景的输入配置由服务提供。'));
    updateSourceCount();
  }

  function drawTerrain(scenario) {
    const andes = /andes|and[eé]s|安第斯|santa luc[ií]a/i.test([scenario?.id, scenario?.basin, scenario?.title].join(' '));
    const grid = andes ? window.ValleyTerrain?.andes : (window.RunoutTerrain || window.ValleyTerrain?.himalaya);
    if (!grid || state.grid === grid) return;
    state.grid = grid;
    get('map-geo').setAttribute('viewBox', `0 0 ${grid.cols} ${grid.rows}`);
    const canvas = get('terrain-shade');
    canvas.width = grid.cols;
    canvas.height = grid.rows;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    let image = terrainCache.get(grid);
    if (!image) {
      const binary = atob(grid.encoded);
      const count = grid.cols * grid.rows;
      const heights = new Int16Array(count);
      let low = Infinity;
      let high = -Infinity;
      for (let index = 0; index < count; index++) {
        heights[index] = binary.charCodeAt(index * 2) | (binary.charCodeAt(index * 2 + 1) << 8);
        low = Math.min(low, heights[index]);
        high = Math.max(high, heights[index]);
      }
      image = ctx.createImageData(grid.cols, grid.rows);
      const span = Math.max(1, high - low);
      for (let y = 0; y < grid.rows; y++) {
        for (let x = 0; x < grid.cols; x++) {
          const i = y * grid.cols + x;
          const dx = (heights[i + (x + 1 < grid.cols ? 1 : 0)] - heights[i - (x > 0 ? 1 : 0)]) / (2 * grid.cell);
          const dy = (heights[i + (y + 1 < grid.rows ? grid.cols : 0)] - heights[i - (y > 0 ? grid.cols : 0)]) / (2 * grid.cell);
          const shade = (0.67 + 0.5 * dx + 0.54 * dy) / Math.hypot(dx, dy, 1);
          const level = (heights[i] - low) / span;
          const light = 0.58 + Math.max(0.02, shade) * 0.68;
          image.data[i * 4] = (51 + level * 155) * light;
          image.data[i * 4 + 1] = (76 + level * 134) * light;
          image.data[i * 4 + 2] = (63 + level * 143) * light;
          image.data[i * 4 + 3] = 255;
        }
      }
      terrainCache.set(grid, image);
    }
    ctx.putImageData(image, 0, 0);
  }

  function locate(lon, lat) {
    if (!state.grid || !finite(lon) || !finite(lat)) return null;
    const { bounds: [west, south, east, north], cols, rows } = state.grid;
    return { x: (lon - west) / (east - west) * cols, y: (north - lat) / (north - south) * rows };
  }

  function inMap(point) {
    return point && point.x >= 0 && point.y >= 0 && point.x <= state.grid.cols && point.y <= state.grid.rows;
  }

  function coordinates(value) {
    return Array.isArray(value) ? { lon: value[0], lat: value[1] }
      : { lon: value?.lon ?? value?.longitude, lat: value?.lat ?? value?.latitude };
  }

  function geoPath(value, closed) {
    if (!Array.isArray(value)) return '';
    const points = value.map(coordinates).map(({ lon, lat }) => locate(lon, lat)).filter(Boolean);
    if (points.length < (closed ? 3 : 2)) return '';
    return `M${points.map(({ x, y }) => `${x.toFixed(2)},${y.toFixed(2)}`).join(' L')}${closed ? 'Z' : ''}`;
  }

  function polygons(geo) {
    if (geo?.type === 'Feature') return polygons(geo.geometry);
    if (geo?.type === 'FeatureCollection') return (geo.features || []).flatMap(polygons);
    if (geo?.type === 'Polygon') return [geo.coordinates];
    return geo?.type === 'MultiPolygon' ? geo.coordinates : [];
  }

  function drawForecastGeometry(forecast, layers) {
    const features = forecast?.map?.type === 'FeatureCollection' ? forecast.map.features || [] : [];
    const areas = [forecast?.geometry || forecast?.impactGeometry];
    const paths = [];
    for (const feature of features) {
      if (feature.properties?.role === 'modeled-impact') areas.push(feature.geometry);
      if (feature.properties?.role === 'modeled-path' && feature.geometry?.type === 'LineString') paths.push(feature.geometry.coordinates);
    }
    let areaCount = 0;
    for (const polygon of areas.flatMap(polygons)) {
      const path = polygon.map((ring) => geoPath(ring, true)).filter(Boolean).join(' ');
      if (!path) continue;
      layers.push(svg('path', { class: 'map-extent', d: path }));
      areaCount += 1;
    }
    for (const points of paths) {
      const path = geoPath(points, false);
      if (path) layers.push(svg('path', { class: 'map-model-path', d: path }));
    }
    get('map-model-key').hidden = !areaCount;
  }

  function receiptPulse(id, element) {
    const started = state.receiptPulses.get(String(id));
    if (started === undefined) return false;
    const age = performance.now() - started;
    if (age >= 1000) { state.receiptPulses.delete(String(id)); return false; }
    element.style.animationDelay = `${-age}ms`;
    return true;
  }

  function pickPoint(lon, lat, name = null, reveal = false) {
    if (!finite(lon) || !finite(lat)) return;
    get('lon').value = lon.toFixed(6);
    get('lat').value = lat.toFixed(6);
    get('accuracy').value = '0';
    state.pointName = name;
    state.point = { lon, lat, accuracy: 0 };
    state.result = null;
    state.watchPoint = false;
    queryRequest += 1;
    if (state.run) get('query-form').requestSubmit();
    else {
      get('query-result').textContent = '已选位置，演练开始后可查询。';
      renderMap();
    }
    if (reveal) get('query-result').scrollIntoView({ block: 'nearest' });
  }

  function renderMap() {
    if (!state.grid) return;
    updateScene();
    const forecast = state.forecast?.data;
    const sites = Array.isArray(forecast?.sites) ? forecast.sites : [];
    const geometry = [];
    drawForecastGeometry(forecast, geometry);
    const route = effectivePointResult()?.route;
    const routePath = geoPath(route?.geometry?.coordinates || route?.coordinates || route, false);
    if (routePath) geometry.push(svg('path', { class: 'map-route', d: routePath }));
    get('map-geometry').replaceChildren(...geometry);
    const pins = [];
    const buttons = [];
    for (const site of sites) {
      const { lon, lat } = coordinates(site);
      const point = locate(lon, lat);
      if (!inMap(point)) continue;
      const name = site.name || site.id || '预测点位';
      const [status, tone] = hazardStatus(site.status);
      const group = svg('g', { class: 'map-pin', transform: `translate(${point.x} ${point.y})`, tabindex: '0', role: 'button', 'aria-label': `${name}，${status}` });
      group.dataset.tone = tone;
      const title = svg('title', {});
      title.textContent = `${name} · ${status} · ${windowText(site.earliest, site.latest)}`;
      group.append(title, svg('circle', { class: 'pin-point', r: 3 }));
      if (state.deliveries.has(String(site.id))) {
        group.append(svg('circle', { class: 'pin-delivered', r: 4.8 }));
        const pulse = svg('circle', { class: 'pin-pulse', r: 4.8 });
        if (receiptPulse(site.id, pulse)) group.append(pulse);
      }
      const label = svg('text', { x: point.x > state.grid.cols - 50 ? -6 : 6, y: -3, 'text-anchor': point.x > state.grid.cols - 50 ? 'end' : 'start' });
      label.textContent = name;
      group.append(label);
      group.addEventListener('click', (event) => { event.stopPropagation(); pickPoint(lon, lat, name); });
      group.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); pickPoint(lon, lat, name); }
      });
      pins.push(group);
      const button = node('button', name);
      button.type = 'button';
      button.addEventListener('click', () => { pickPoint(lon, lat, name, true); });
      buttons.push(button);
    }
    get('map-markers').replaceChildren(...pins);
    get('map-sites').replaceChildren(...buttons);
    const selected = state.point && locate(state.point.lon, state.point.lat);
    const queryMarker = get('map-query-marker');
    queryMarker.replaceChildren();
    if (inMap(selected)) {
      if (state.point.accuracy > 0) queryMarker.append(svg('circle', { class: 'map-query-ring', cx: selected.x, cy: selected.y, r: state.point.accuracy / state.grid.cell }));
      queryMarker.append(svg('circle', { class: 'map-query-point', cx: selected.x, cy: selected.y, r: 2.1 }));
    }
    get('forecast-version').textContent = forecast ? `预测 ${versionText(forecast.version)}` : '等待预测';
    get('map-asof').textContent = forecast ? `截至 ${clock(forecast.asOf ?? state.forecast.time)} · ${sites.length} 个点位` : '点选地图可填写查询坐标';
  }

  function observationOf(event) { return event.data?.observation || event.data || {}; }

  function toolResult(result) {
    if (typeof result === 'string') return result;
    if (Array.isArray(result)) {
      const examples = result.slice(0, 3).map((value) => value?.name || value?.id || (typeof value === 'string' ? value : '')).filter(Boolean);
      return `${result.length} 条匹配${examples.length ? ` · ${examples.join('、')}` : ''}`;
    }
    if (!result || typeof result !== 'object') return '';
    const fields = [
      result.version != null ? `版本 ${versionText(result.version)}` : '',
      typeof result.status === 'string' ? `判读 ${result.status}` : '',
      Array.isArray(result.sites) ? `${result.sites.length} 个预测点位` : '',
      result.duplicateOf ? `关联 ${result.duplicateOf}` : '',
      result.modelId ? `模型 ${result.modelId}` : '',
      finite(result.earliest) || finite(result.latest) ? windowText(result.earliest, result.latest) : '',
    ];
    return fields.filter(Boolean).join(' · ') || '结构化结果已记录。';
  }

  function eventDescription(event) {
    const data = event.data || {};
    if (event.type === 'observation') {
      const obs = observationOf(event);
      const id = obs.id ?? obs.observationId ?? obs.evidenceId ?? data.evidenceId;
      const registry = (scenarioOfRun()?.sources || []).map(sourceInfo).find((item) => item.id === obs.sourceId);
      const source = registry?.name || obs.source?.label || obs.source?.name || obs.sourceId || (typeof obs.source === 'string' ? obs.source : '') || obs.kind || '输入源';
      const provenance = obs.synthetic === true ? '合成演练输入' : obs.synthetic === false ? '档案衍生输入' : '回放输入';
      const observed = finite(obs.observedAt) ? ` · 观测 ${clock(obs.observedAt)}` : '';
      const detail = obs.message || obs.summary || obs.text || obs.notes || provenance;
      return [provenance, `${source}${id ? ` · ${id}` : ''}`, `${detail}${observed}`];
    }
    if (event.type === 'decision') return ['决策依据', data.message || data.summary || '完成决策', data.uncertainty || data.nextAction || ''];
    if (event.type === 'forecast') return ['预测', `发布 ${versionText(data.version)} · ${(data.sites || []).length} 个点位`, data.source?.label || (typeof data.source === 'string' ? data.source : '')];
    if (event.type === 'alert') return ['警报', `${data.name || data.targetId || '地理分发'} · ${versionText(data.version)}`, data.message || data.kind || '进入模拟分发。'];
    if (event.type === 'delivery') return [deliveryState(data.status), `${data.name || data.targetId || '终端'} · ${versionText(data.version)}`, windowText(data.earliest, data.latest)];
    if (event.type.startsWith('tool.')) {
      const kind = event.type === 'tool.failed' ? '工具失败' : event.type === 'tool.started' ? '工具调用' : '工具返回';
      const tool = data.tool || data.toolName || data.name || data.operation || '工具';
      const summary = data.error?.message || data.message || data.summary || data.resultSummary || data.inputSummary || data.outputSummary
        || (typeof data.error === 'string' ? data.error : '') || toolResult(data.result);
      const elapsed = data.elapsedMs ?? data.durationMs;
      const detail = [summary, finite(elapsed) ? `${elapsed} 毫秒` : ''].filter(Boolean).join(' · ');
      return [kind, tool, detail];
    }
    return [event.type, data.message || '运行状态更新', ''];
  }

  function setJournalTab(tab) {
    state.tab = tab;
    state.traceLimit = 32;
    renderJournal();
  }

  function showEvidence(id) {
    const event = state.observations.get(String(id));
    if (!event) return;
    const disclosure = get('technical-trace');
    if (disclosure) disclosure.open = true;
    state.tab = 'trace';
    state.traceLimit = state.events.length;
    get('trace-search').value = '';
    renderJournal();
    const target = document.getElementById(`journal-${event.seq ?? state.events.indexOf(event)}`);
    if (target?.closest('details')) target.closest('details').open = true;
    target?.focus({ preventScroll: true });
    target?.scrollIntoView({ block: 'nearest' });
  }

  const toolLabels = {
    extract_claim: '提取灾情主张', classify_text: '本地模型判读', match_location: '匹配地名',
    check_independence: '核对独立来源', revise_forecast: '重算影响范围与到达窗口',
    propose_alert: '计算分发对象', query_position: '计算所选位置的风险与路线',
  };

  function traceRounds(events) {
    const rounds = [];
    let round;
    for (const event of events) {
      const type = event.type;
      const query = type === 'tool.started' && event.data.name === 'query_position';
      if (!round || type === 'observation' || query || round.time !== event.time) {
        round = { id: event.seq, time: event.time, events: [], calls: [] };
        rounds.push(round);
      }
      round.events.push(event);
      if (type === 'tool.started') round.calls.push({ start: event });
      if (type === 'tool.succeeded' || type === 'tool.failed') {
        const call = round.calls.findLast(item => !item.end && item.start.data.name === event.data.name);
        if (call) call.end = event;
      }
    }
    return rounds;
  }

  function callDetail(call) {
    const { start, end } = call;
    const detail = node('details', undefined, 'trace-call');
    detail.dataset.detailKey = `call-${start.seq}`;
    const summary = node('summary');
    const status = end?.type === 'tool.failed' ? '失败' : end ? '完成' : '运行中';
    summary.append(node('span', toolLabels[start.data.name] || start.data.name),
      node('small', `${status}${finite(end?.data.elapsedMs) ? ` · ${end.data.elapsedMs} ms` : ''}`));
    detail.append(summary, node('code', start.data.name));
    for (const id of start.data.evidenceIds || []) {
      const source = node('button', id, 'quiet-button');
      source.type = 'button';
      source.addEventListener('click', () => showEvidence(id));
      detail.append(source);
    }
    if (start.data.input) detail.append(node('pre', JSON.stringify(start.data.input, null, 2)));
    if (end) detail.append(node('pre', JSON.stringify(end.data.result ?? end.data.message, null, 2)));
    return detail;
  }

  function roundTitle(round) {
    const head = round.events[0];
    const result = round.events.findLast(event => ['decision', 'forecast', 'delivery'].includes(event.type));
    const title = head.type === 'observation' ? eventDescription(head)[1]
      : round.calls.length ? toolLabels[round.calls[0].start.data.name] : eventDescription(head)[1];
    return { title, outcome: result ? eventDescription(result)[1] : '' };
  }

  function renderTrace() {
    const journal = get('journal');
    const focused = journal.contains(document.activeElement) ? document.activeElement.closest('[data-detail-key]') : null;
    const focusKey = focused?.dataset.detailKey;
    const focusedButton = document.activeElement?.tagName === 'BUTTON' ? document.activeElement.textContent : null;
    const open = new Set([...journal.querySelectorAll('details[open]')].map(item => item.dataset.detailKey));
    const atBottom = journal.scrollHeight - journal.clientHeight - journal.scrollTop < 32;
    const scrollTop = journal.scrollTop;
    const rounds = traceRounds(state.events);
    const search = get('trace-search').value.trim().toLowerCase();
    const matching = search ? rounds.filter(round => round.events.some(event => {
      const description = eventDescription(event).join(' ');
      const tool = toolLabels[event.data?.name] ?? '';
      const { presentation, map, ...payload } = event.data ?? {};
      return `${description} ${tool} ${JSON.stringify(payload)}`.toLowerCase().includes(search);
    })) : rounds;
    const visible = matching.slice(-state.traceLimit);
    const summaries = visible.map(round => {
      const { title, outcome } = roundTitle(round);
      const item = node('details', undefined, 'trace-round');
      item.id = `journal-${round.id}`;
      item.dataset.detailKey = `round-${round.id}`;
      item.dataset.firstSeq = round.events[0].seq;
      item.dataset.lastSeq = round.events.at(-1).seq;
      item.open = open.has(item.dataset.detailKey);
      const summary = node('summary');
      const heading = node('span', undefined, 'trace-heading');
      heading.append(node('strong', title || '工具执行'), node('time', clock(round.time)));
      summary.append(heading);
      if (outcome && outcome !== title) summary.append(node('p', outcome));
      const body = node('div', undefined, 'trace-body');
      const head = round.events[0];
      if (head.type === 'observation') body.append(node('p', eventDescription(head)[2]));
      for (const call of round.calls) {
        const detail = callDetail(call);
        detail.open = open.has(detail.dataset.detailKey);
        body.append(detail);
      }
      for (const event of round.events.filter(entry => ['forecast', 'alert', 'delivery'].includes(entry.type))) {
        const [kind, headline, text] = eventDescription(event);
        body.append(node('p', [kind, headline, text].filter(Boolean).join(' · '), 'trace-output'));
      }
      item.append(summary, body);
      return item;
    });
    journal.replaceChildren(...(summaries.length ? summaries : [node('p', '等待符合条件的轨迹。', 'live-empty')]));
    journal.scrollTop = atBottom && !search && !focusKey ? journal.scrollHeight : scrollTop;
    if (focusKey) {
      const detail = [...journal.querySelectorAll('[data-detail-key]')].find(item => item.dataset.detailKey === focusKey);
      const button = focusedButton && [...(detail?.querySelectorAll('button') || [])].find(item => item.textContent === focusedButton);
      (button || detail?.querySelector('summary'))?.focus({ preventScroll: true });
    }
    const markers = get('trace-overview');
    const duration = state.run?.duration || 1;
    const milestones = matching.filter(round => round.events.some(event => ['forecast', 'delivery'].includes(event.type)));
    markers.replaceChildren(...milestones.map(round => {
      const marker = node('button');
      marker.type = 'button';
      marker.style.left = `${Math.min(99, round.time / duration * 100)}%`;
      marker.title = `${clock(round.time)} · ${roundTitle(round).outcome}`;
      marker.setAttribute('aria-label', marker.title);
      marker.addEventListener('click', () => {
        let item = get(`journal-${round.id}`);
        if (!item) {
          state.traceLimit = matching.length;
          renderTrace();
          item = get(`journal-${round.id}`);
        }
        if (!item) return;
        item.open = true;
        item.scrollIntoView({ block: 'nearest' });
      });
      return marker;
    }));
    const current = state.events.findLast(event => event.type === 'forecast' ||
      (event.type === 'delivery' && event.data.status === 'delivered'));
    const label = current ? eventDescription(current).slice(0, 2).join(' · ') : '正在接收并筛选回放观测';
    const currentNode = get('trace-current');
    if (currentNode.textContent !== label) currentNode.textContent = label;
    get('journal-count').textContent = `${rounds.length} 轮 · ${rounds.reduce((count, round) => count + round.calls.length, 0)} 次调用`;
    get('older-events').hidden = matching.length <= visible.length;
    get('older-events').textContent = `显示更早的 ${matching.length - visible.length} 轮`;
  }

  function renderJournal() {
    const trace = state.tab === 'trace';
    get('rationale-tab').setAttribute('aria-pressed', String(!trace));
    get('trace-tab').setAttribute('aria-pressed', String(trace));
    get('trace-workspace').hidden = !trace;
    if (trace) { renderTrace(); return; }
    const source = state.events.filter(event => event.type === 'decision' || event.type === 'forecast');
    const rows = source.slice(-state.traceLimit).reverse().map((event) => {
      const [kind, title, detail] = eventDescription(event);
      const item = node('article', undefined, 'journal-item');
      item.dataset.kind = event.type;
      item.id = `journal-${event.seq ?? state.events.indexOf(event)}`;
      item.tabIndex = -1;
      const meta = node('div', undefined, 'journal-meta');
      meta.append(node('span', kind), node('time', clock(event.time)));
      item.append(meta, node('h3', title));
      if (detail) item.append(node('p', typeof detail === 'string' ? detail : '结构化结果已记录。'));
      const ids = event.data?.evidenceIds;
      if (Array.isArray(ids) && ids.length) {
        const basis = node('div', undefined, 'journal-basis');
        for (const id of ids) {
          const chip = node('button', String(id));
          chip.type = 'button';
          chip.disabled = !state.observations.has(String(id));
          chip.addEventListener('click', () => showEvidence(id));
          basis.append(chip);
        }
        item.append(basis);
      }
      return item;
    });
    const empty = !state.run ? '正在准备演练。' : '等待第一条决策或预测。可在轨迹里查看输入。';
    get('journal').replaceChildren(...(rows.length ? rows : [node('p', empty, 'live-empty')]));
    get('journal-count').textContent = `${state.events.length} 条事件`;
    get('older-events').hidden = source.length <= state.traceLimit;
    get('older-events').textContent = `显示更早的 ${source.length - state.traceLimit} 条`;
  }

  function renderDeliveries() {
    const receiptTime = (event) => event.data?.receivedAt ?? event.time;
    const targets = [...state.deliveries.values()].sort((a, b) => receiptTime(a) - receiptTime(b) || (a.seq ?? 0) - (b.seq ?? 0));
    const limit = 4;
    const rows = (state.expanded ? targets : targets.slice(0, limit)).map((event) => {
      const data = event.data;
      const card = node('article', undefined, 'terminal-card');
      const canceled = /retract|cancel/i.test(data.kind);
      card.dataset.tone = canceled ? 'other' : 'impact';
      if (receiptPulse(data.targetId, card)) card.classList.add('receipt-pulse');
      const meta = node('div', undefined, 'terminal-meta');
      const kind = /update|revise/i.test(data.kind) ? '更新已送达' : canceled ? '撤回已送达' : '已模拟送达';
      meta.append(node('span', kind), node('time', clock(receiptTime(event))));
      card.append(meta, node('h3', data.name || data.targetId || '模拟终端'), node('p', `${versionText(data.version)} · ${canceled ? '旧版已撤回' : '预计受影响'}`));
      if (finite(data.earliest) || finite(data.latest)) card.append(node('p', `到达窗口 ${windowText(data.earliest, data.latest)}`));
      if (finite(data.margin)) {
        card.append(node('p', data.margin <= 0 ? `送达时预计来不及撤离 · 差 ${duration(data.margin)}`
          : `送达时预计还有 ${duration(data.margin)} 撤离余量`));
      }
      if (data.instruction) card.append(node('p', data.instruction));
      const site = state.forecast?.data?.sites?.find((entry) => String(entry.id) === String(data.targetId));
      const { lon, lat } = coordinates(data.lon === undefined ? site : data);
      if (finite(lon) && finite(lat)) {
        const button = node('button', '定位此处', 'live-control');
        button.type = 'button';
        button.addEventListener('click', () => { pickPoint(lon, lat, data.name, true); });
        card.append(button);
      }
      return card;
    });
    get('deliveries').replaceChildren(...(rows.length ? rows : [node('p', '等待运行日志记录首条终端送达。', 'live-empty')]));
    get('delivery-count').textContent = `${targets.length} 个终端`;
    get('delivery-overflow').hidden = targets.length <= limit;
    get('delivery-overflow').textContent = state.expanded ? '收起更多终端' : `显示其余 ${targets.length - limit} 个终端`;
    const missed = state.events.filter((event) => event.type === 'delivery' && ['expired', 'superseded'].includes(event.data?.status));
    get('undelivered').hidden = !missed.length;
    get('undelivered-count').textContent = `未送达记录 · ${missed.length} 条`;
    get('undelivered-list').replaceChildren(...missed.slice().reverse().map(({ time, data }) =>
      node('li', `${clock(time)} · ${data.name || data.targetId} · ${versionText(data.version)} · ${deliveryState(data.status)}`)));
  }

  function deliveryState(status) {
    if (status === 'expired') return '送达前过期';
    if (status === 'superseded') return '队列中被替换';
    return status === 'delivered' ? '模拟送达' : '终端状态';
  }

  function metricsRows(items) {
    return items.map(([name, value]) => {
      const row = node('div');
      row.append(node('dt', name), node('dd', String(value)));
      return row;
    });
  }

  function renderMethodRun() {
    const caption = get('method-run');
    const stats = get('method-metrics');
    if (!state.run) {
      caption.textContent = '建立一场运行后查看统计。';
      stats.replaceChildren();
      return;
    }
    const label = state.run.mode === 'text-model' ? '本地文本模型' : '规则执行';
    caption.textContent = `${scenarioOfRun()?.title || state.run.scenarioId} · ${label} · 运行 ${state.run.id}`;
    const versions = new Set(state.events.filter((event) => event.type === 'forecast').map((event) => event.data?.version ?? event.seq));
    stats.replaceChildren(...metricsRows([
      ['已记录观测', state.events.filter((event) => event.type === 'observation').length],
      ['已发布预测版本', versions.size],
      ['已模拟送达终端', state.deliveries.size],
      ['工具失败事件', state.events.filter((event) => event.type === 'tool.failed').length],
    ]));
  }

  function safeLink(value) {
    try { const url = new URL(value); return ['http:', 'https:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
  }

  function renderMethodSources() {
    get('method-sources').replaceChildren(...state.scenarios.map((scenario, index) => {
      const details = node('details');
      details.open = index === 0;
      details.append(node('summary', `${scenario.id} · ${scenario.title}`));
      if (scenario.basin) details.append(node('p', scenario.basin));
      const sources = (scenario.sources || []).map(sourceInfo);
      const list = node('ul');
      for (const source of sources) {
        const item = node('li');
        const url = safeLink(source.url || source.href);
        if (url) {
          const link = node('a', source.name || source.id || '来源');
          link.href = url;
          link.target = '_blank';
          link.rel = 'noopener noreferrer';
          item.append(link);
        } else item.textContent = source.name || source.id || '场景输入';
        const role = source.provenance?.label || source.provenance?.kind || source.role || source.kind || source.type;
        if (typeof role === 'string') item.append(node('span', `· ${role}`, 'source-role'));
        if (source.description) item.append(node('p', source.description));
        list.append(item);
      }
      details.append(sources.length ? list : node('p', '来源信息随场景版本提供。'));
      return details;
    }));
  }

  async function loadMethod() {
    try {
      const { textModel, replayAblation } = await request('/api/method');
      if (!textModel) throw new Error('等待评估记录。');
      const percent = (value) => finite(value) ? `${(value * 100).toFixed(1).replace(/\.0$/, '')}%` : '—';
      get('method-filter').textContent = `本地文本筛选器 ${textModel.modelId || ''}。以下为独立保留的少量合成贴文结果，适用范围限于这组样本。`;
      get('method-filter-metrics').replaceChildren(...metricsRows([
        ['保留测试样本', textModel.test ?? '—'], ['训练样本', textModel.training ?? '—'],
        ['精确率', percent(textModel.precision)], ['召回率', percent(textModel.recall)],
        ['正确识别 / 误报', `${textModel.tp ?? '—'} / ${textModel.fp ?? '—'}`],
        ['漏报 / 正确排除', `${textModel.fn ?? '—'} / ${textModel.tn ?? '—'}`],
      ]));
      if (replayAblation?.full && replayAblation?.disabled) {
        const { full, disabled, scope } = replayAblation;
        const stamp = value => finite(value) ? `T+${Math.floor(value / 60)}:${String(value % 60).padStart(2, '0')}` : '—';
        const firstReceipts = new Map(full.receipts.map(item => [item.id, item]));
        const laterReceipts = new Map(disabled.receipts.map(item => [item.id, item]));
        const rows = [
          ['首次预测', stamp(full.firstForecast), stamp(disabled.firstForecast)],
          ['预测版本数', full.forecastCount, disabled.forecastCount],
        ];
        for (const id of new Set([...firstReceipts.keys(), ...laterReceipts.keys()])) {
          const first = firstReceipts.get(id);
          const later = laterReceipts.get(id);
          rows.push([first?.name ?? later.name, stamp(first?.time), stamp(later?.time)]);
        }
        get('ablation-scope').textContent = scope;
        get('ablation-rows').replaceChildren(...rows.map(([label, first, later]) => {
          const tr = node('tr');
          const th = node('th', label);
          th.scope = 'row';
          tr.append(th, node('td', String(first)), node('td', String(later)));
          return tr;
        }));
        get('method-ablation').hidden = false;
      }

    } catch {
      get('method-filter').textContent = '评估记录暂未加载。';
    }
  }

  function displaySite(name) {
    return name?.split(' / ')[0].replace('河岸演练点', '河岸') || '下游点位';
  }

  function evidenceLabel(event) {
    const observation = event?.data;
    if (!observation) return '新观测';
    const labels = { waveform: '上游台站波形', camera: '河道相机', gauge: '下游水位站' };
    return `${observation.synthetic ? '模拟' : ''}${labels[observation.kind] ?? '观测'}`;
  }

  function recordBeat(event) {
    const data = event.data;
    let beat;
    if (event.type === 'forecast' && data.source) {
      const trigger = state.events.findLast(row => row.type === 'observation' && row.time === event.time);
      const label = evidenceLabel(trigger);
      const previous = state.forecast?.data;
      const changes = (data.sites || []).flatMap(site => {
        const old = previous?.sites.find(item => item.id === site.id);
        if (!old || (old.status === site.status && old.earliest === site.earliest && old.latest === site.latest)) return [];
        return [{ site, old, delta: Math.abs((site.earliest ?? 0) - (old.earliest ?? 0)) + Math.abs((site.latest ?? 0) - (old.latest ?? 0)) }];
      }).sort((a, b) => b.delta - a.delta);
      const change = changes[0];
      const affected = data.sites.filter(site => site.status === 'affected');
      const before = change && (change.old.status === 'affected' ? windowText(change.old.earliest, change.old.latest) : '未判为受影响');
      const after = change && (change.site.status === 'affected' ? windowText(change.site.earliest, change.site.latest) : '改判为未确认受影响');
      const newSource = previous && data.sources.length > previous.sources.length;
      beat = {
        stage: data.version === 1 ? '首次预测' : '预测修订',
        title: data.version === 1 ? `${label}触发初报` : newSource ? '发现新的源区，重算下游影响' : `${label}到达，更新下游预测`,
        detail: change ? `${displaySite(change.site.name)} · ${before} → ${after}`
          : affected.length ? `${affected.map(site => displaySite(site.name)).join('、')}预计受影响。`
            : '当前输入支持建立预测，登记的终端暂无明确影响判断。',
        action: '查看预测依据',
      };
    }
    if (event.type === 'observation' && ['sensor_outage', 'bridge_closure'].includes(data?.role)) {
      beat = data.role === 'bridge_closure'
        ? { stage: '路线变化', title: '收到桥梁关闭信息', detail: '后续查询将把这处封闭纳入路线计算。', action: '查看原始记录' }
        : { stage: '观测中断', title: '上游信号中断', detail: '等待其他来源提供可定位的证据。', action: '查看原始记录' };
    }
    if (event.type === 'delivery' && ['delivered', 'expired'].includes(data.status)) {
      const canceled = data.kind === 'Cancel';
      const margin = data.margin;
      const previous = state.deliveries.get(String(data.targetId))?.data;
      const reversed = finite(previous?.margin) && previous.margin > 0 && finite(margin) && margin <= 0;
      beat = {
        stage: data.status === 'expired' ? '预警过期' : '手机收到通知',
        title: `${displaySite(data.name)}${data.status === 'expired' ? '的通知过期' : canceled ? '收到撤回' : data.kind === 'Update' ? '收到修订' : '收到预警'}`,
        detail: data.status === 'expired' ? '通知在到达终端前已超过本版的预计到达窗口。'
          : canceled ? '上一版区域判断已撤回。'
            : reversed ? `原有 ${duration(previous.margin)} 撤离余量，更新后预计来不及（差 ${duration(margin)}）。`
              : finite(margin) ? (margin > 0 ? `按演练路径估计，仍有 ${duration(margin)} 撤离余量。` : `按演练路径估计，撤离时间不足 ${duration(margin)}。`)
                : `预计到达 ${windowText(data.earliest, data.latest)}，撤离余量待判断。`,
        action: '查看这条送达',
      };
    }
    if (event.type === 'decision' && !state.beats.some(beat => beat.stage === '信源筛选') && /排除|暂缓/.test(data.message)) {
      beat = { stage: '信源筛选', title: 'Agent 正在筛选现场线索', detail: data.message, action: '查看筛选过程' };
    }
    if (!beat) return;
    const entry = { ...beat, time: event.time, seq: event.seq };
    state.beats.push(entry);
    if (beat.stage !== '手机收到通知' || !state.streamReady || document.hidden) state.liveBeat = entry;
  }

  function openBeat(beat) {
    const disclosure = get('technical-trace');
    if (disclosure) disclosure.open = true;
    state.tab = 'trace';
    state.traceLimit = state.events.length;
    get('trace-search').value = '';
    renderJournal();
    const round = [...get('journal').querySelectorAll('[data-first-seq]')].find(item =>
      Number(item.dataset.firstSeq) <= beat.seq && beat.seq <= Number(item.dataset.lastSeq));
    if (round) {
      round.open = true;
      round.querySelector('summary')?.focus({ preventScroll: true });
      round.scrollIntoView({ block: 'nearest' });
    }
  }

  function renderStory() {
    const title = get('story-title');
    if (!title) return;
    const latest = state.liveBeat;
    const beat = state.inspectedBeat || latest;
    const stage = get('story-stage');
    const detail = get('story-detail');
    const time = get('story-time');
    const action = get('story-action');
    title.textContent = beat?.title || '等待第一条现场线索';
    stage.textContent = beat?.stage || '演练开始';
    detail.textContent = beat?.detail || 'Agent 将随演练时钟接收观测。首份预测出来后，地图和终端会同步更新。';
    time.textContent = beat ? clock(beat.time) : 'T+00:00';
    action.hidden = !beat;
    if (beat) {
      action.textContent = beat.action;
      action.onclick = () => openBeat(beat);
    }
    const history = get('story-history');
    if (!history) return;
    const key = `${state.beats.length}:${beat?.seq ?? ''}:${Boolean(state.inspectedBeat)}`;
    if (history.dataset.key === key) return;
    history.dataset.key = key;
    const focusId = history.contains(document.activeElement) ? document.activeElement.dataset.beat : null;
    const notable = state.beats.filter(entry => entry.stage !== '手机收到通知').slice(-4);
    const received = state.beats.filter(entry => entry.stage === '手机收到通知').slice(-3);
    const shown = [...new Set([...notable, ...received, ...(beat ? [beat] : [])])].sort((a, b) => a.seq - b.seq);
    history.replaceChildren(...shown.map(entry => {
      const row = node(history.tagName === 'OL' ? 'li' : 'div');
      const button = node('button');
      button.type = 'button';
      button.dataset.beat = String(entry.seq);
      button.setAttribute('aria-pressed', String(beat === entry));
      button.append(node('time', clock(entry.time)), node('span', entry.title));
      button.addEventListener('click', () => { state.inspectedBeat = entry; renderStory(); });
      row.append(button);
      return row;
    }));
    if (state.inspectedBeat) {
      const row = node(history.tagName === 'OL' ? 'li' : 'div');
      const follow = node('button', '跟随当前演练');
      follow.type = 'button';
      follow.addEventListener('click', () => { state.inspectedBeat = null; renderStory(); });
      row.append(follow);
      history.append(row);
    }
    if (focusId) history.querySelector(`[data-beat="${focusId}"]`)?.focus({ preventScroll: true });
  }

  function scheduleRender() {
    if (pendingRender) return;
    pendingRender = requestAnimationFrame(() => {
      pendingRender = 0;
      renderStory();
      renderJournal();
      renderDeliveries();
      renderMap();
      renderMethodRun();
    });
  }

  function acceptEvent(event) {
    if (!event || typeof event.type !== 'string' || !state.run) return;
    if (event.type === 'clock') {
      const next = event.data?.run || event.data || {};
      state.run = { ...state.run, ...next, time: next.time ?? event.time ?? state.run.time };
      state.streamReady = true;
      updateControls();
      updateScene();
      return;
    }
    const key = event.seq === undefined || event.seq === null ? null : String(event.seq);
    if (key !== null && state.seen.has(key)) return;
    if (key !== null) state.seen.add(key);
    state.events.push(event);
    if (event.type === 'observation') {
      const obs = observationOf(event);
      const id = obs.id ?? obs.observationId ?? obs.evidenceId ?? event.data?.evidenceId;
      if (id !== undefined) state.observations.set(String(id), event);
    }
    recordBeat(event);
    if (event.type === 'forecast') {
      state.forecast = event;
      if (state.watchPoint) get('query-form').requestSubmit();
    }
    if (event.type === 'delivery') {
      const id = event.data?.targetId ?? event.data?.siteId ?? event.data?.name;
      if (id !== undefined && event.data.status === 'delivered') {
        state.deliveries.set(String(id), event);
        if (state.streamReady) {
          state.receiptPulses.set(String(id), performance.now());
          scene.receipt(event);
        }
      }
    }
    if (finite(event.time) && event.time > state.run.time) { state.run.time = event.time; updateControls(); }
    scheduleRender();
  }

  function openStream() {
    state.stream?.close();
    const stream = window.RunoutPagesReplay?.openStream(state.run.id) ?? new EventSource(runPath('/events'));
    state.stream = stream;
    state.streamReady = false;
    streamState('连接事件流');
    stream.onopen = () => { if (state.stream === stream) streamState(window.RunoutPagesReplay ? '浏览器回放' : '事件流已连接', 'live'); };
    stream.onerror = () => {
      if (state.stream !== stream) return;
      state.streamReady = false;
      streamState('事件流重连中', 'warn');
    };
    const read = (message) => {
      if (state.stream !== stream) return;
      try {
        const event = JSON.parse(message.data);
        acceptEvent(event.type ? event : { ...event, type: message.type });
      } catch { streamState('收到无法解析的事件', 'warn'); }
    };
    stream.onmessage = read;
    for (const type of knownEvents) stream.addEventListener(type, read);
  }

  async function createRun() {
    const scenario = selectedScenario();
    if (state.busy || !scenario) return;
    state.busy = true;
    showError();
    updateControls();
    try {
      if (isPlaying()) {
        const previous = await request(runPath('/control'), { action: 'pause' });
        if (previous.run) state.run = previous.run;
      }
      const disabledSources = [...get('source-checks').querySelectorAll('input:checked')].map((input) => input.value);
      const { run } = await request('/api/runs', { scenarioId: scenario.id, disabledSources, mode: get('agent-mode').value });
      if (!run?.id) throw new Error('运行服务尚未提供有效编号。');
      state.run = run;
      state.events = [];
      state.seen.clear();
      state.observations.clear();
      state.deliveries.clear();
      state.beats = [];
      state.inspectedBeat = null;
      state.liveBeat = null;
      state.pointName = null;
      renderStory();
      state.receiptPulses.clear();
      state.watchPoint = false;
      state.point = null;
      state.forecast = null;
      state.result = null;
      state.expanded = false;
      state.traceLimit = 32;
      queryRequest += 1;
      delete get('query-result').dataset.key;
      get('query-result').textContent = '点选地图或下方地点，查询该位置的到达时间与演练路线。';
      delete get('query-result').dataset.tone;
      get('inject-state').textContent = '';
      get('source-options').open = false;
      drawTerrain(scenario);
      scheduleRender();
      openStream();
      const started = await request(runPath('/control'), { action: 'play', speed: Number(get('speed').value) });
      if (started.run) state.run = { ...started.run, time: Math.max(state.run.time, started.run.time) };
      updateScene();
    } catch (error) { showError(error.message); }
    finally { state.busy = false; updateControls(); updateScene(); }
  }

  async function control(action) {
    if (!state.run || state.busy || isFinished()) return;
    state.busy = true;
    showError();
    updateControls();
    try {
      const body = { action, speed: Number(get('speed').value) };
      if (action === 'step') body.seconds = 60;
      const { run } = await request(runPath('/control'), body);
      if (run) state.run = run;
    } catch (error) { showError(error.message); }
    finally { state.busy = false; updateControls(); updateScene(); }
  }

  function formPoint() {
    const lonValue = get('lon').value;
    const latValue = get('lat').value;
    const accuracyValue = get('accuracy').value;
    const lon = Number(lonValue);
    const lat = Number(latValue);
    const accuracy = Number(accuracyValue);
    return lonValue && latValue && accuracyValue && finite(lon) && Math.abs(lon) <= 180
      && finite(lat) && Math.abs(lat) <= 90 && finite(accuracy) && accuracy >= 0 ? { lon, lat, accuracy } : null;
  }

  function effectivePointResult() {
    const result = state.result;
    if (!result) return null;
    const elapsed = Math.max(0, (state.run?.time ?? 0) - result.checkedAt);
    if (result.status !== 'affected' || !finite(result.earliest)) return result;
    const now = state.run?.time ?? 0;
    const phase = now > result.latest ? 'past-modeled-window'
      : now >= result.earliest ? 'within-modeled-window' : 'before-modeled-window';
    const margin = finite(result.margin) ? Math.floor(result.margin - elapsed) : null;
    const timely = phase === 'before-modeled-window' && (margin === null || margin > 0);
    return {
      ...result, phase, margin, route: timely ? result.route : [],
      targetElevation: timely ? result.targetElevation : null, walkSeconds: timely ? result.walkSeconds : null,
    };
  }

  function positionVerdict(result) {
    if (result.reason === 'outside-dem-coverage' || result.reason === 'terrain-edge') return ['超出演练覆盖', 'unknown'];
    if (result.status !== 'affected') return hazardStatus(result.status);
    if (result.phase === 'past-modeled-window') return ['预计影响时段已过，尚未解除', 'impact'];
    if (result.phase === 'within-modeled-window') return ['已进入预计影响时段', 'impact'];
    if (finite(result.margin) && result.margin <= 0) return ['演练路线已来不及', 'impact'];
    if (result.route?.length > 1) return ['预计受影响，找到候选路线', 'impact'];
    return ['预计受影响，路线未确认', 'impact'];
  }

  const queryReasons = {
    'outside-dem-coverage': '该坐标在本场地形覆盖外，无法判断是否受影响。',
    'terrain-edge': '位置或定位误差接近地形边界，无法给出可靠判断。',
    'impact-boundary-or-disagreeing-hypotheses': '位置靠近影响边界，当前模型结果有分歧。',
    'invalid-or-imprecise-location': '定位精度不足，无法判断该点。',
    'no-geolocated-physical-evidence': '还没有可用于计算的源区观测。',
    'outside-current-modeled-footprint': '本版模型未覆盖此处，判断可能随新证据更新。',
  };

  function renderQuery(result, point) {
    const root = get('query-result');
    const [label, tone] = positionVerdict(result);
    const key = JSON.stringify([label, result.version, result.earliest, result.latest, result.margin, result.reason,
      point.lon, point.lat, state.pointName]);
    if (root.dataset.key === key) return;
    root.dataset.key = key;
    root.dataset.tone = tone;
    const rows = [node('strong', label)];
    if (state.pointName) rows.push(node('p', state.pointName));
    if (finite(result.earliest)) rows.push(node('p', `预计到达 ${windowText(result.earliest, result.latest)}`));
    if (finite(result.margin)) rows.push(node('p', `当前演练撤离余量 ${signed(result.margin)}`));
    if (finite(result.walkSeconds) && finite(result.targetElevation)) {
      rows.push(node('p', `地图已标出待核验路线，估算步行 ${duration(result.walkSeconds)}，终点海拔 ${Math.round(result.targetElevation)} 米。`));
    } else if (result.status === 'affected') {
      rows.push(node('p', '当前无可展示的及时候选路线。实际行动请以当地正式指引为准。'));
    }
    if (queryReasons[result.reason]) rows.push(node('p', queryReasons[result.reason]));
    const forecast = state.forecast?.data;
    if (result.status === 'affected' && forecast?.version === result.version) {
      const source = forecast.sources.find(item => item.id === result.waves?.[0]?.sourceId) ?? forecast.sources[0];
      if (finite(source?.lat) && finite(source?.lon)) {
        rows.push(node('p', `候选源区 ${Math.abs(source.lat).toFixed(3)}°${source.lat < 0 ? 'S' : 'N'}，${Math.abs(source.lon).toFixed(3)}°${source.lon < 0 ? 'W' : 'E'}`));
      }
    }
    const info = [`${point.lat.toFixed(5)}°, ${point.lon.toFixed(5)}°`];
    if (result.version != null) info.push(`预测 ${versionText(result.version)}`);
    rows.push(node('small', info.join(' · ')));
    root.replaceChildren(...rows);
  }

  async function query(event) {
    event.preventDefault();
    if (!state.run) return;
    const point = formPoint();
    if (!point) { get('query-result').textContent = '请填写有效的经纬度与定位精度。'; return; }
    const serial = ++queryRequest;
    state.watchPoint = true;
    if (state.point && (Math.abs(state.point.lon - point.lon) > 0.000001 || Math.abs(state.point.lat - point.lat) > 0.000001)) state.pointName = null;
    state.point = point;
    state.result = null;
    const requestedAt = state.run.time;
    delete get('query-result').dataset.key;
    get('query-result').textContent = '正在计算这个位置…';
    delete get('query-result').dataset.tone;
    renderMap();
    try {
      const { result } = await request(`${runPath('/query')}?${new URLSearchParams(point)}`);
      if (serial !== queryRequest) return;
      if (!result) throw new Error('当前位置暂无判读结果。');
      state.result = { ...result, checkedAt: result.asOf ?? requestedAt };
      renderMap();
    } catch (error) { if (serial === queryRequest) get('query-result').textContent = error.message; }
  }

  async function inject(event) {
    event.preventDefault();
    if (!state.run || isFinished()) return;
    const target = state.run.id;
    const kind = get('inject-kind').value;
    const point = formPoint();
    const text = get('inject-text').value.trim();
    const output = get('inject-state');
    if (kind === 'post' ? !text : !point) { output.textContent = kind === 'post' ? '请填写演练文本。' : '请先填写上方的经纬度。'; return; }
    const payload = kind === 'post' ? { kind, text } : { kind, lon: point.lon, lat: point.lat };
    get('inject-button').disabled = true;
    output.textContent = '提交演练输入…';
    try {
      await request(runPath('/inject'), payload);
      if (state.run.id === target) output.textContent = '已提交。运行轨迹会记录后续处理。';
    } catch (error) { if (state.run.id === target) output.textContent = error.message; }
    finally { updateControls(); }
  }

  function setView() {
    const method = location.hash === '#method';
    get('live-view').hidden = method;
    get('method-view').hidden = !method;
    get('live-link').toggleAttribute('aria-current', !method);
    get('method-link').toggleAttribute('aria-current', method);
    if (method) get('method-link').setAttribute('aria-current', 'page');
    else {
      get('live-link').setAttribute('aria-current', 'page');
      if (!state.run && state.scenarios.length) createRun();
      else updateScene();
    }
  }

  async function initialize() {
    setView();
    renderJournal();
    renderDeliveries();
    updateControls();
    if (location.protocol === 'file:') {
      showError('请通过 RUNOUT 本地运行服务打开 Agent Live。预录演出可直接打开。');
      drawTerrain(null);
      return;
    }
    loadMethod();
    try {
      const { scenarios } = await request('/api/scenarios');
      state.scenarios = Array.isArray(scenarios) ? scenarios : [];
      const select = get('scenario');
      select.replaceChildren(...state.scenarios.map((scenario) => {
        const option = node('option', `${scenario.id} · ${scenario.title}`);
        option.value = scenario.id;
        return option;
      }));
      const desired = new URLSearchParams(location.search).get('scenario');
      if (state.scenarios.some((scenario) => scenario.id === desired)) select.value = desired;
      updateSourceOptions();
      renderMethodSources();
      drawTerrain(selectedScenario());
      renderMap();
      updateControls();
      if (!scenarios?.length) showError('运行服务尚未提供可回放场景。');
      else if (location.hash !== '#method') await createRun();
    } catch (error) { showError(error.message); streamState('运行服务不可用', 'warn'); }
  }

  get('scenario').addEventListener('change', () => {
    updateSourceOptions();
    createRun();
  });
  get('source-checks').addEventListener('change', updateSourceCount);
  get('new-run').addEventListener('click', createRun);
  get('toggle-run').addEventListener('click', () => control(isPlaying() ? 'pause' : 'play'));
  get('step-run').addEventListener('click', () => control('step'));
  get('speed').addEventListener('change', () => { if (isPlaying()) control('play'); });
  get('rationale-tab').addEventListener('click', () => setJournalTab('rationale'));
  get('trace-tab').addEventListener('click', () => setJournalTab('trace'));
  document.addEventListener('click', event => {
    const settings = get('advanced-options');
    if (settings.open && !settings.contains(event.target)) settings.open = false;
  });
  get('trace-search').addEventListener('input', () => { state.traceLimit = state.events.length; renderJournal(); });
  get('trace-latest').addEventListener('click', () => {
    get('trace-search').value = '';
    state.traceLimit = 32;
    renderJournal();
    get('journal').scrollTop = get('journal').scrollHeight;
  });
  get('older-events').addEventListener('click', () => { state.traceLimit = state.events.length; renderJournal(); });
  get('delivery-overflow').addEventListener('click', () => { state.expanded = !state.expanded; renderDeliveries(); });
  get('query-form').addEventListener('submit', query);
  get('inject-form').addEventListener('submit', inject);
  get('inject-kind').addEventListener('change', () => {
    const post = get('inject-kind').value === 'post';
    get('inject-text-label').hidden = !post;
    get('inject-position-note').hidden = post;
  });
  get('map-geo').addEventListener('click', (event) => {
    const map = get('map-geo');
    const matrix = map.getScreenCTM();
    if (!state.grid || !matrix) return;
    const pointer = map.createSVGPoint();
    pointer.x = event.clientX;
    pointer.y = event.clientY;
    const point = pointer.matrixTransform(matrix.inverse());
    if (!inMap(point)) return;
    const { bounds: [west, south, east, north], cols, rows } = state.grid;
    pickPoint(west + point.x / cols * (east - west), north - point.y / rows * (north - south));
  });
  window.addEventListener('hashchange', setView);
  window.addEventListener('pagehide', () => { state.stream?.close(); });
  for (const button of modeButtons) button.addEventListener('click', () => sceneView(button.dataset.sceneMode));
  sceneView('film');
  initialize();
})();
