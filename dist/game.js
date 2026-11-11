(function () {
  "use strict";

  const get = id => document.getElementById(id);
  const worldLibrary = globalThis.RunoutWorld;
  const timeline = globalThis.RunoutTimeline;
  const stage = get("stage");
  if (location.protocol === "http:" && !location.pathname.endsWith("/film.html")) get("agent-live-link").href = "/agent.html";
  const slider = get("scrub");
  const dialog = get("scene-menu");
  const filmButton = get("mode-film");
  const exploreButton = get("mode-explore");
  const play = get("play");
  const rewind = get("restart");
  let renderer;
  let overlays;
  let atlas;
  let state;
  let animationId = 0;
  let lastFrame = 0;
  const pauseIcon = "M7.5 5.5v9m5-9v9";
  const playIcon = "M7 4.7 15 10l-8 5.3Z";

  function openWorld(id) {
    stop();
    const world = worldLibrary.create(id);
    state = {
      world, film: timeline.buildFilm(world), mode: state?.mode ?? "film",
      minute: 0, filmSecond: 0, selectedSite: null, probePoint: null, probe: null, probeMinute: -Infinity, playing: false
    };
    renderer.load(world);
    atlas.set(world);
    overlays.reset(world);
    const entry = worldLibrary.catalog.find(scene => scene.id === id);
    get("case-index").textContent = entry?.example ? "EXAMPLE / ANDES" : id + " / HIMALAYA";
    get("case-title").textContent = world.title;
    get("end-time").textContent = timeline.formatTime(world.duration);
    get("case-notes").open = false;
    renderSources(world);
    for (const button of get("scenario-list").querySelectorAll("button")) {
      button.setAttribute("aria-current", String(button.dataset.scene === id));
    }
    refresh();
  }

  function renderSources(world) {
    const body = get("case-sources");
    const notes = document.createElement("p");
    const text = [world.description, typeof world.notes === "string" ? world.notes : ""]
      .filter(Boolean).join(" ");
    notes.textContent = text || "地形驱动的离线演练。到达时间、手机送达和撤离行为随情景设定。";
    const status = document.createElement("p");
    status.textContent = "模拟证据、手机送达及撤离均属演练。选点路线根据地形推算，需由当地核验。";
    const refs = document.createElement("p");
    refs.className = "case-links";
    const context = [
      { name: "NASA Blue Marble", url: "https://nasa-gibs.github.io/gibs-api-docs/access-basics/" },
      { name: "COP31 · Early Warnings for All", url: "https://unfccc.int/cop31/high-level" },
      { name: "IPCC · 高山亚洲", url: "https://www.ipcc.ch/report/ar6/wg1/chapter/chapter-12/" },
      { name: "WMO · ENSO", url: "https://wmo.int/themes/el-nino-la-nina-phenomena" }
    ];
    if (["01", "09"].includes(world.sceneId)) {
      context.unshift({ name: "吉隆口岸监控 · 视觉参照", url: "https://commons.wikimedia.org/wiki/File:Mudslide_at_Gyirong_Port_1.webm" });
    }
    for (const source of [...(world.sources ?? []), ...context]) {
      const anchor = document.createElement("a");
      anchor.href = source.url;
      anchor.textContent = source.name;
      anchor.target = "_blank";
      anchor.rel = "noopener";
      refs.append(anchor);
    }
    body.replaceChildren(notes, status, refs);
  }

  function makeMenu() {
    const items = get("scenario-list");
    for (const scene of worldLibrary.catalog) {
      if (scene.example) {
        const label = document.createElement("p");
        label.className = "example-heading eyebrow";
        label.textContent = "ANDES EXAMPLE";
        items.append(label);
      }
      const button = document.createElement("button");
      button.type = "button";
      button.className = "scenario-row";
      button.dataset.scene = scene.id;
      const number = document.createElement("span");
      number.className = "number";
      number.textContent = scene.example ? "EX" : scene.id;
      const title = document.createElement("strong");
      title.textContent = scene.title;
      const type = document.createElement("small");
      type.textContent = scene.category;
      button.append(number, title, type);
      button.addEventListener("click", () => {
        dialog.close();
        openWorld(scene.id);
      });
      items.append(button);
    }
  }

  function selectedNotice(world, siteId, minute) {
    const site = world.sites.find(candidate => candidate.id === siteId);
    if (!site || !Number.isFinite(site.notify) || minute < site.notify) return null;
    const update = (site.updates ?? []).filter(item => item.minute <= minute).at(-1);
    return { siteId, phoneNotice: timeline.phoneNotice(site, update) };
  }

  function activeNotice(world, minute, mode, clip) {
    if (mode === "explore" && state.probe) return null;
    if (mode === "explore" && state.selectedSite) return selectedNotice(world, state.selectedSite, minute);
    const window = Math.max(1.05, world.duration / state.film.live * 3.8);
    let latest;
    for (const site of world.sites) {
      const notices = [site.notify, ...(site.updates ?? []).map(update => update.minute)];
      for (const time of notices) {
        if (typeof time !== "number" || minute < time || minute - time >= window) continue;
        if (!latest || time > latest.time || time === latest.time && site.id === clip?.siteId) {
          latest = { siteId: site.id, time };
        }
      }
    }
    return latest ? selectedNotice(world, latest.siteId, minute) : null;
  }

  function dispatchFrame(world, minute, events, frame) {
    if (frame.camera !== "dispatch" || frame.phase !== "live" || !renderer.project) return null;
    const pulseWindow = Math.max(0.65, world.duration / state.film.live * 2.4);
    const targets = [];
    for (const site of world.sites) {
      if (!Number.isFinite(site.notify) || !Number.isFinite(site.arrival)) continue;
      const update = (site.updates ?? []).find(value => Math.abs(value.minute - minute) <= pulseWindow);
      const notify = update?.minute ?? site.notify;
      if (minute < notify - pulseWindow) continue;
      const projected = renderer.project(site, 0.8);
      const action = timeline.evacuation(site);
      const finish = action?.end ?? Infinity;
      const margin = Number.isFinite(finish) ? site.arrival - finish : null;
      targets.push({
        ...projected, id: site.id, name: site.name,
        arrival: update?.arrival ?? site.arrival, notify, margin,
        canEvacuate: margin !== null && margin > 0, passed: events[site.id].passed
      });
    }
    const anchor = world.waves[0]?.path[0];
    const projected = anchor && renderer.project(anchor, 1.1);
    const from = projected?.visible ? projected : {
      x: get("viewport").clientWidth * 0.16,
      y: get("viewport").clientHeight * 0.50,
      visible: true
    };
    return { active: targets.length > 0, from, targets };
  }

  function updateProbe(minute) {
    if (!state.probePoint) return;
    state.probe = { ...state.probePoint, ...worldLibrary.probe(state.world, state.probePoint, minute) };
    state.probeMinute = minute;
  }

  function refresh() {
    const { world, mode, film, filmSecond, playing } = state;
    const filmFrame = mode === "film" ? timeline.filmFrame(film, filmSecond) : null;
    const clip = filmFrame?.clip;
    if (filmFrame) state.minute = filmFrame.minute;
    const minute = state.minute;
    if (mode === "explore" && state.probePoint && Math.abs(minute - state.probeMinute) >= 0.75) updateProbe(minute);
    const phase = filmFrame?.phase ?? "live";
    const events = timeline.eventsAt(world, minute);
    const notice = phase === "live" ? activeNotice(world, minute, mode, clip) : null;
    const activeSiteId = clip?.siteId ?? (state.probe ? undefined : state.selectedSite) ?? notice?.siteId;
    const frame = {
      minute, mode, phase, camera: clip?.camera ?? "overview", focus: clip?.focus, waveIndex: clip?.waveIndex,
      clip, events, activeSiteId, probe: mode === "explore" ? state.probe : null,
      phoneSiteId: notice?.siteId ?? null, phoneNotice: notice?.phoneNotice,
      signals: mode === "film" && phase === "live" ? film.signals : [],
      summary: filmFrame?.summary ?? null
    };
    atlas.render(filmFrame?.opening);
    if (phase !== "intro") renderer.render(frame);
    frame.dispatch = dispatchFrame(world, minute, events, frame);
    overlays.render(frame);

    const ended = mode === "film" ? filmSecond >= film.duration : minute >= world.duration;
    play.querySelector("span").textContent = playing ? "暂停" : ended ? "重播" : "播放";
    const icon = play.querySelector("path");
    icon.setAttribute("d", playing ? pauseIcon : playIcon);
    icon.setAttribute("fill", playing ? "none" : "currentColor");
    icon.setAttribute("stroke", playing ? "currentColor" : "none");
    icon.setAttribute("stroke-width", "1.7");
    icon.setAttribute("stroke-linecap", "round");

    get("clock").textContent = phase === "intro" ? "定位" : timeline.formatTime(minute);
    slider.value = Math.round(minute / world.duration * Number(slider.max));
    slider.setAttribute("aria-valuetext", timeline.formatTime(minute));
    stage.dataset.mode = mode;
    stage.dataset.phase = phase;
    get("explore-tip").hidden = mode !== "explore";
    filmButton.setAttribute("aria-pressed", String(mode === "film"));
    exploreButton.setAttribute("aria-pressed", String(mode === "explore"));
  }

  function stop() {
    if (animationId) cancelAnimationFrame(animationId);
    animationId = 0;
    lastFrame = 0;
    if (state) state.playing = false;
  }

  function animate(now) {
    if (!state.playing) return;
    const delta = lastFrame ? Math.min(0.12, (now - lastFrame) / 1000) : 0;
    lastFrame = now;
    if (state.mode === "film") {
      state.filmSecond = Math.min(state.film.duration, state.filmSecond + delta);
      if (state.filmSecond >= state.film.duration) stop();
    } else {
      const { duration } = state.world;
      state.minute = Math.min(duration, state.minute + delta * duration / 48);
      if (state.minute >= duration) stop();
    }
    refresh();
    if (state.playing) animationId = requestAnimationFrame(animate);
  }

  function seek(minute) {
    state.minute = minute;
    if (state.mode === "explore") updateProbe(minute);
    state.filmSecond = timeline.seekFilm(state.film, minute);
    refresh();
  }

  function resetPlayback() {
    state.minute = 0;
    state.filmSecond = 0;
    state.selectedSite = null;
    state.probePoint = null;
    state.probe = null;
    refresh();
  }

  function togglePlay() {
    if (state.playing) {
      stop();
      refresh();
      return;
    }
    const ended = state.mode === "film" ? state.filmSecond >= state.film.duration : state.minute >= state.world.duration;
    if (ended) resetPlayback();
    state.playing = true;
    animationId = requestAnimationFrame(animate);
    refresh();
  }

  function setMode(mode) {
    if (mode === state.mode) return;
    stop();
    state.mode = mode;
    if (mode === "film") {
      state.selectedSite = null;
      state.filmSecond = timeline.seekFilm(state.film, state.minute);
    }
    refresh();
  }

  function startupError(message) {
    get("scene-error").hidden = false;
    get("scene-error").textContent = message;
    for (const control of [play, rewind, slider, filmButton, exploreButton, get("choose-scene")]) {
      control.disabled = true;
    }
  }

  try {
    renderer = globalThis.RunoutRenderer.create(get("viewport"), {
      onSelect: point => {
        if (!state || state.mode !== "explore") return;
        state.selectedSite = point?.siteId ?? null;
        state.probePoint = point && Number.isFinite(point.x) && Number.isFinite(point.y) ? point : null;
        state.probe = null;
        updateProbe(state.minute);
        refresh();
      }
    });
    atlas = globalThis.RunoutAtlas.create(get("atlas-opening"));
    overlays = globalThis.RunoutOverlays.create(get("story-overlay"));
    makeMenu();
    openWorld(worldLibrary.catalog[0].id);
    new ResizeObserver(() => {
      renderer.resize();
      if (state.mode === "film" && state.filmSecond < state.film.intro) refresh();
    }).observe(get("viewport"));
  } catch (error) {
    console.error(error);
    startupError("三维场景载入失败。请检查浏览器的 WebGL 支持，再重新打开 RUNOUT。");
    return;
  }

  get("choose-scene").addEventListener("click", () => {
    stop();
    refresh();
    dialog.showModal();
  });
  get("close-scene-menu").addEventListener("click", () => dialog.close());
  dialog.addEventListener("click", event => { if (event.target === dialog) dialog.close(); });
  filmButton.addEventListener("click", () => setMode("film"));
  exploreButton.addEventListener("click", () => setMode("explore"));
  play.addEventListener("click", togglePlay);
  rewind.addEventListener("click", () => { stop(); resetPlayback(); });
  slider.addEventListener("input", () => {
    stop();
    seek(Number(slider.value) / Number(slider.max) * state.world.duration);
  });
  window.addEventListener("keydown", event => {
    if (event.code !== "Space" || event.repeat || dialog.open || event.target !== document.body) return;
    event.preventDefault();
    togglePlay();
  });
})();
