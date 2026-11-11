(function () {
  'use strict';

  const openingSeconds = 38;
  const receiptHoldMs = 2850;

  function createAtlas(container) {
    if (!window.RunoutAtlas) return null;
    const stage = document.createElement('div');
    stage.className = 'atlas-opening';
    stage.hidden = true;
    stage.setAttribute('aria-hidden', 'true');
    stage.innerHTML = '<canvas></canvas><div data-atlas-pin class="atlas-pin"><span>演练流域</span></div>' +
      '<div class="atlas-caption"><p data-atlas-en class="eyebrow"></p><p data-atlas-title></p></div>' +
      '<div class="atlas-credit">NASA EARTHDATA · BLUE MARBLE</div>';
    container.append(stage);
    return { stage, ...window.RunoutAtlas.create(stage) };
  }

  function create(container, notice, { onSelect, onReceiptShown, clock, windowText, signed }) {
    const cache = new WeakMap();
    const queue = [];
    const [arc, ring, label] = notice.querySelector('svg').children;
    const [stamp, title, eta, margin] = notice.querySelector('aside').children;
    let renderer;
    let grid;
    let runId;
    let snapshot;
    let sites = [];
    let arrival;
    let active;
    let raf;
    let view = 'film';
    let frame;
    let shownSeconds = 0;
    let clockTransition;
    let atlas;
    const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
    const shot = document.createElement('div');
    shot.className = 'scene-shot-label';
    shot.style.cssText = 'position:absolute;right:.75rem;top:.7rem;z-index:1;padding:.33rem .55rem;' +
      'background:#131b1adf;color:#f2f2e6;border:1px solid #ddd8;border-radius:.3rem;pointer-events:none;font-size:.76rem';
    container.append(shot);
    const mapLabels = document.createElement('div');
    mapLabels.style.cssText = 'position:absolute;inset:0;z-index:1;overflow:hidden;pointer-events:none';
    mapLabels.setAttribute('aria-hidden', 'true');
    container.append(mapLabels);
    const siteLabels = new Map();

    function sceneGrid(raw) {
      if (!cache.has(raw)) {
        const binary = atob(raw.encoded);
        const heights = new Int16Array(raw.cols * raw.rows);
        for (let i = 0; i < heights.length; i++) {
          heights[i] = binary.charCodeAt(i * 2) | binary.charCodeAt(i * 2 + 1) << 8;
        }
        cache.set(raw, { ...raw, heights });
      }
      return cache.get(raw);
    }

    function locate({ lon, lat }, terrain = grid) {
      const [west, south, east, north] = terrain.bounds;
      const x = (lon - west) / (east - west) * terrain.cols;
      const y = (north - lat) / (north - south) * terrain.rows;
      return x >= 0 && x < terrain.cols && y >= 0 && y < terrain.rows ? { x, y } : null;
    }

    function init() {
      if (renderer) return;
      renderer = window.RunoutRenderer.create(container, { onSelect: ({ x, y, siteId }) => {
        if (!grid) return;
        const [west, south, east, north] = grid.bounds;
        onSelect(west + x / grid.cols * (east - west), north - y / grid.rows * (north - south), siteId);
      } });
      atlas = createAtlas(container);
      new ResizeObserver(() => {
        if (!container.hidden) { renderer.resize(); schedule(); }
      }).observe(container);
    }

    function rebuild(input) {
      const preserveView = grid === input.grid && runId === input.run?.id;
      if (!preserveView) {
        siteLabels.clear();
        mapLabels.replaceChildren();
      }
      grid = input.grid;
      runId = input.run?.id;
      snapshot = input.forecast;
      sites = (snapshot?.sites || []).flatMap(site => {
        const position = locate(site);
        return position ? [{ ...site, ...position }] : [];
      });
      const model = snapshot?.presentation;
      arrival = model ? new Float32Array(grid.rows * grid.cols).fill(Infinity) : undefined;
      for (let i = 0; i < (model?.wet.length || 0); i += 2) {
        arrival[model.wet[i]] = model.wet[i + 1] / 60;
      }
      renderer.load({
        grid: sceneGrid(grid), sceneId: runId, forecastOnly: true,
        waves: model?.waves || [], sites, arrival,
      }, preserveView);
      if (atlas) {
        const [west, south, east, north] = grid.bounds;
        const center = locate({ lon: (west + east) / 2, lat: (south + north) / 2 });
        atlas.set({ grid, sceneId: input.run?.scenarioId, waves: [{ path: [center] }] });
      }
    }

    function flatProjection(data) {
      const map = container.parentElement.querySelector('#map-geo');
      const point = locate(data, frame.grid);
      const matrix = map?.getScreenCTM();
      if (!point || !matrix) return null;
      const projected = new DOMPoint(point.x, point.y).matrixTransform(matrix);
      const rect = container.parentElement.getBoundingClientRect();
      const x = projected.x - rect.left;
      const y = projected.y - rect.top;
      return { x, y, visible: x >= 0 && x <= rect.width && y >= 0 && y <= rect.height };
    }

    function showDelivery(now, point) {
      const { data, time } = active.event;
      const progress = reducedMotion.matches ? 1 : Math.min(1, (now - active.start) / 530);
      const origin = { x: 25, y: 47 };
      const destination = point?.visible ? point : origin;
      const controlX = (origin.x + destination.x) / 2;
      const controlY = Math.max(8, Math.min(origin.y, destination.y) - 38);
      arc.setAttribute('d', `M${origin.x},${origin.y} Q${controlX},${controlY} ${destination.x},${destination.y}`);
      arc.setAttribute('pathLength', '1');
      arc.style.visibility = point?.visible ? 'visible' : 'hidden';
      arc.style.strokeDashoffset = String(1 - progress);
      ring.hidden = !point?.visible;
      ring.style.visibility = point?.visible && progress === 1 ? 'visible' : 'hidden';
      ring.setAttribute('cx', destination.x);
      ring.setAttribute('cy', destination.y);
      ring.setAttribute('r', reducedMotion.matches ? 12 : 8 + ((now - active.start) % 550) / 35);
      label.setAttribute('x', origin.x - 6);
      label.setAttribute('y', origin.y - 12);
      label.textContent = point?.visible ? '模拟分发' : '';
      notice.hidden = false;
      if (progress === 1 && !active.shown) {
        active.shown = true;
        stamp.textContent = `${clock(data.receivedAt ?? time)} · ${data.kind === 'Cancel' ? '撤回' : data.kind === 'Update' ? '修订' : '预警'}送达 · 第 ${data.version} 版`;
        title.textContent = data.name || data.targetId;
        const lead = data.earliest - (data.receivedAt ?? time);
        eta.textContent = data.kind === 'Cancel' ? '上一版预警已撤回'
          : Number.isFinite(data.earliest) && lead > 0 ? `送达时距最早到达 ${signed(lead).slice(1)}`
            : `预计到达 ${windowText(data.earliest, data.latest)}`;
        margin.textContent = Number.isFinite(data.margin)
          ? data.margin <= 0 ? `按演练路线，撤离时间不足 · ${signed(data.margin)}` : `按演练路线，撤离余量 ${signed(data.margin)}`
          : data.kind === 'Cancel' ? '' : '撤离余量待判定';
        onReceiptShown?.(active.event);
      }
      notice.dataset.received = String(progress === 1);
    }

    function labelSites(activeSite) {
      const placed = [];
      const activeId = activeSite && String(activeSite.id);
      const ordered = activeSite ? [activeSite, ...sites.filter(site => site !== activeSite)] : sites;
      for (const site of ordered) {
        const { x, y, visible } = renderer.project(site);
        const id = String(site.id);
        if (!visible || x < 42 || x > container.clientWidth - 42 || y < 63 || y > container.clientHeight - 32 ||
          placed.some(other => Math.abs(other.x - x) < 110 && Math.abs(other.y - y) < 30)) continue;
        const item = siteLabels.get(id) || document.createElement('span');
        if (!siteLabels.has(id)) {
          item.style.cssText = 'position:absolute;transform:translate(-50%,-100%);white-space:nowrap;' +
            'max-width:9rem;overflow:hidden;text-overflow:ellipsis;padding:.18rem .35rem;font-size:.7rem;border-radius:.25rem';
          item.textContent = site.name;
          siteLabels.set(id, item);
          mapLabels.append(item);
        }
        item.hidden = false;
        item.style.left = `${x}px`;
        item.style.top = `${y - 10}px`;
        item.style.background = id === activeId ? '#a6392c' : '#142120df';
        item.style.color = '#fff5ea';
        placed.push({ id, x, y });
      }
      const shown = new Set(placed.map(point => point.id));
      for (const [id, item] of siteLabels) if (!shown.has(id)) item.hidden = true;
    }

    function draw(now) {
      raf = undefined;
      if (!frame?.grid || container.parentElement.clientHeight === 0) return;
      if (view !== 'map' && (grid !== frame.grid || runId !== frame.run?.id || snapshot !== frame.forecast)) rebuild(frame);
      if (active && now - active.start > receiptHoldMs) active = null;
      if (!active && queue.length) active = { event: queue.shift(), start: now };
      const dispatch = active && view === 'film';
      const fraction = clockTransition ? Math.min(1, Math.max(0, (now - clockTransition.start) / 190)) : 1;
      shownSeconds = clockTransition
        ? clockTransition.from + (clockTransition.to - clockTransition.from) * fraction : frame.run?.time ?? 0;
      if (fraction === 1) clockTransition = null;
      if (view === 'map') {
        if (active) showDelivery(now, flatProjection(active.event.data));
        else notice.hidden = true;
        if (active || queue.length) schedule();
        return;
      }
      const minute = shownSeconds / 60;
      const opening = atlas && view === 'film' && frame.run && !snapshot && !active && !reducedMotion.matches && shownSeconds < openingSeconds;
      const waves = snapshot?.presentation?.waves || [];
      const hasWave = waves.length > 0;
      const camera = dispatch ? 'dispatch' : hasWave ? 'helicopter' : 'overview';
      if (atlas && (opening || !atlas.stage.hidden)) atlas.render(opening ? shownSeconds / openingSeconds : undefined);
      shot.textContent = view === 'explore' ? '自由视角 · 点击地形查询' : dispatch ? '下游终端 · 模拟送达'
        : hasWave ? '高空跟拍 · 模拟波前' : '流域全景 · 等待首报';
      shot.hidden = Boolean(opening);
      const probe = frame.point && locate(frame.point);
      const route = frame.result?.version === snapshot?.version && Array.isArray(frame.result?.route)
        ? frame.result.route.map(point => locate(point)).filter(Boolean) : [];
      const events = Object.fromEntries(sites.map(site => {
        const receipt = frame.deliveries.get(String(site.id));
        const notified = receipt?.data?.status === 'delivered' && receipt.data.kind !== 'Cancel';
        const modeledArrival = arrival?.[Math.floor(site.y) * grid.cols + Math.floor(site.x)];
        return [site.id, { notified, notifiedAt: notified ? receipt.time / 60 : undefined,
          passed: Number.isFinite(modeledArrival) && minute >= modeledArrival, passedAt: modeledArrival }];
      }));
      renderer.render({
        minute, mode: view, camera,
        activeSiteId: active?.event.data.targetId, events, probe: probe ? { ...probe, route } : null,
      });
      const site = active && sites.find(site => String(site.id) === String(active.event.data.targetId));
      mapLabels.hidden = !dispatch;
      if (dispatch) labelSites(site);
      if (active) showDelivery(now, view === 'film' && site ? renderer.project(site) : null);
      else notice.hidden = true;
      if (active || queue.length || clockTransition) schedule();
    }

    function schedule() {
      if (!raf) raf = requestAnimationFrame(draw);
    }

    return {
      setView(next) {
        if (next !== 'map') init();
        view = next;
        container.hidden = view === 'map';
        container.parentElement.dataset.view = view;
        schedule();
      },
      update(input) {
        if (input.run?.id !== frame?.run?.id) {
          clockTransition = null;
          active = null;
          queue.length = 0;
        } else if (input.run?.status !== 'playing') clockTransition = null;
        else if (input.run.time !== frame.run.time) {
          clockTransition = { from: Math.min(shownSeconds, input.run.time), to: input.run.time, start: performance.now() };
        }
        frame = input;
        schedule();
      },
      receipt(event) { queue.push(event); schedule(); },
    };
  }

  window.RunoutAgentScene = { create };
})();
