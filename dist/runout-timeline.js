(function (root) {
  "use strict";

  const finite = value => typeof value === "number" && Number.isFinite(value);
  const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

  function formatTime(minute) {
    if (!finite(minute)) return "—";
    const seconds = Math.round(Math.max(0, minute) * 60);
    return "T+" + String(Math.floor(seconds / 60)).padStart(2, "0") + ":" + String(seconds % 60).padStart(2, "0");
  }

  function evacuation(site) {
    if (!finite(site.notify)) return null;
    const departure = site.notify + (site.reaction ?? 0.55);
    const walk = Math.max(0.01, site.walk);
    const bridgeFraction = clamp(site.bridgeFraction ?? 0.45, 0.1, 0.9);
    const crossing = departure + walk * bridgeFraction;
    const closure = finite(site.closure) && site.closure <= crossing;
    if (closure && site.backup?.length > 1 && site.closure <= departure) {
      const duration = site.backupWalk ?? walk * 1.45;
      return { departure, duration, end: departure + duration, routeChanged: true };
    }
    if (closure) {
      const blockedAt = site.closure <= departure ? departure : crossing;
      return { departure, duration: walk, blockedAt, end: null };
    }
    return { departure, duration: walk, end: departure + walk };
  }

  function eventsAt(world, minute) {
    const events = {};
    for (const site of world.sites) {
      const action = evacuation(site);
      const passed = finite(site.arrival) && minute >= site.arrival;
      const notified = finite(site.notify) && minute >= site.notify;
      const started = action && minute >= action.departure;
      const canFinish = action && finite(action.end) && (!finite(site.arrival) || action.end < site.arrival);
      const evacuated = Boolean(canFinish && minute >= action.end);
      const blocked = action && finite(action.blockedAt) && minute >= action.blockedAt;
      let progress = 0;
      if (started) {
        const stop = Math.min(minute, site.arrival ?? Infinity, action.blockedAt ?? Infinity);
        progress = clamp((stop - action.departure) / action.duration, 0, 1);
      }
      let status = "pending";
      if (evacuated) status = "evacuated";
      else if (passed) status = notified ? "overrun" : "passed";
      else if (blocked) status = "blocked";
      else if (started) status = "enroute";
      else if (notified) status = "notified";
      events[site.id] = {
        passed, notified, evacuated, progress, status,
        arrival: site.arrival, notify: site.notify, end: canFinish ? action.end : null,
        passedAt: site.arrival, notifiedAt: site.notify, evacuatedAt: canFinish ? action.end : null,
        blockedAt: action?.blockedAt,
        routeChanged: Boolean(action?.routeChanged && started)
      };
    }
    return events;
  }

  function phoneNotice(site, update) {
    const time = update?.minute ?? site.notify;
    const arrival = update ? update.arrival : site.arrival;
    const window = finite(arrival) && arrival > time ? Math.max(0.55, (arrival - time) * 0.12) : null;
    return {
      time, arrival, message: update?.message ?? site.message,
      title: update ? "泥石流预警更新" : undefined,
      earliest: window === null ? undefined : Math.max(time, arrival - window),
      latest: window === null ? undefined : arrival + window,
      hideArrival: update && !finite(arrival)
    };
  }

  function signalsFor(world) {
    const notices = world.sites.map(site => site.notify).filter(finite);
    if (!notices.length) return [];
    const first = Math.min(...notices);
    const delayed = world.sceneId === "09";
    const caseLake = world.sceneId === "02";
    const entries = delayed
      ? [
        { id: "lost", minute: 0.35, kind: "offline", source: "上游遥测", message: "连接中断，等待独立观测。" },
        { id: "gauge", minute: Math.max(0, first - 0.85), kind: "sensor", source: "下游水位站", message: "检测到快速涨水，回传河段位置。" }
      ]
      : [
        { id: "sensor", minute: Math.max(0.12, first - 2.5), kind: "sensor",
          source: caseLake ? "上游湖面监测" : "上游振动测站",
          message: caseLake ? "湖面出现快速变化，已请求下游核验。" : "检测到突发强振动，定位到候选源区。" },
        { id: "post", minute: Math.max(0.28, first - 1.55), kind: "post", source: "居民贴文 · 地点待核验",
          message: "“上游传来巨响，河道里的水很快变浑了。”" },
        { id: "fusion", minute: Math.max(0.44, first - 0.45), kind: "agent", source: "RUNOUT Agent",
          message: "对齐观测时间和河段，划定候选影响区并交给分发端。" }
      ];
    if (world.sceneId === "07") {
      const update = world.sites.flatMap(site => site.updates ?? []).sort((a, b) => a.minute - b.minute)[0];
      if (update) entries.push({ id: "second", minute: update.minute - 0.35, kind: "sensor", source: "第二源监测", message: "发现另一股波前，下游预警窗口更新。" });
    }
    return entries;
  }

  function summaryFor(world) {
    const minutesLater = 6;
    const baseline = {
      ...world,
      sites: world.sites.map(site => ({
        ...site,
        notify: finite(site.notify) ? site.notify + minutesLater : null
      }))
    };
    const results = eventsAt(world, world.duration);
    const comparison = eventsAt(baseline, world.duration + minutesLater + 15);
    const sites = world.sites.filter(site => finite(site.arrival)).map(site => {
      const lead = Math.max(0, site.arrival - (site.notify ?? Infinity));
      return {
        name: site.name, lead,
        agentComplete: results[site.id].evacuated,
        baselineComplete: comparison[site.id].evacuated,
        gained: Math.min(minutesLater, lead)
      };
    });
    return {
      sites,
      gained: Math.max(0, ...sites.map(site => site.gained)),
      gainLabel: "最长多获提前量",
      completed: sites.filter(site => site.agentComplete).length,
      baselineCompleted: sites.filter(site => site.baselineComplete).length,
      scope: "同一灾害、同一路线和步速。基线假设送达再晚 6 分钟。结果以演练点位计。"
    };
  }

  function buildFilm(world) {
    const intro = 6.7;
    const live = 64;
    const outro = 10;
    const perSecond = world.duration / live;
    const shots = [];
    const window = (minute, before, after, priority, camera, details = {}) => {
      if (!finite(minute)) return;
      shots.push({
        start: Math.max(0, minute - before * perSecond),
        end: Math.min(world.duration, minute + after * perSecond),
        priority, camera, ...details
      });
    };

    const source = world.waves[0]?.path[0];
    window(0, 0, 2.8, 3, "source", { title: "上游源区", focus: source });
    for (const [waveIndex, wave] of world.waves.entries()) {
      if (waveIndex === 0 || wave.kind === "return") continue;
      if (wave.start > 0) window(wave.start, 0.2, 3.4, 6, "source",
        { title: wave.label ?? "第二源启动", focus: wave.path[0], waveIndex });
    }
    const dispatches = new Set(world.sites.flatMap(site =>
      [site.notify, ...(site.updates ?? []).map(update => update.minute)].filter(finite)));
    for (const minute of dispatches) window(minute, 1.7, 4.8, 7, "dispatch", { title: "河谷预警分发" });
    if (world.confluence) {
      const returning = world.waves.some(wave => wave.kind === "return");
      const port = returning ? world.sites.find(site => site.id === "port") : null;
      window(world.confluenceTime, 1.25, 3.8, 9, "confluence", {
        title: returning ? "汇入口 · 下泄与回冲" : "汇流口",
        subtitle: !returning && world.interactions?.length ? "两股波前近同时抵达，低处影响范围扩大。" : undefined,
        focus: world.confluence, siteId: port?.id
      });
      if (port && finite(port.arrival)) {
        window(port.arrival + 0.46, 0, 2.7, 10, "town", {
          title: "吉隆口岸 · 越岸冲击", siteId: port.id, focus: port
        });
      }
    }

    const exposed = world.sites.filter(site => finite(site.arrival)).sort((a, b) => a.arrival - b.arrival);
    for (const [index, site] of exposed.entries()) {
      const focus = { x: site.x, y: site.y };
      const action = evacuation(site);
      window(site.arrival, 0.75, 2.9, index === 0 ? 8 : 5, "town", {
        siteId: site.id, focus, title: site.name + " · 波前到达"
      });
      window(site.closure, 0.9, 3.3, 10, "evacuation", {
        siteId: site.id, focus: site.bridge ?? focus, title: "通道失效"
      });
      if (action && action.departure < site.arrival) {
        const actionEnd = Math.min(action.end ?? action.blockedAt ?? site.arrival, site.arrival);
        if (actionEnd > action.departure) {
          const moment = (action.departure + actionEnd) / 2;
          window(moment, 2.2, 2.3, index ? 6 : 4, "evacuation", { siteId: site.id, focus });
        }
        if (finite(action.end) && action.end < site.arrival) {
          window(action.end, 1.0, 2.8, 6, "evacuation", { siteId: site.id, focus });
        }
      }
    }

    const ridge = world.sceneId === "05" && world.sites.find(site => site.arrival === null);
    if (ridge && exposed.length) window(exposed[0].arrival + 1.2 * perSecond, 0.1, 2.0, 6, "town",
      { siteId: ridge.id, focus: ridge, title: "山脊另一侧" });

    return {
      intro, live, outro, duration: intro + live + outro, minutes: world.duration,
      shots: shots.sort((a, b) => b.priority - a.priority),
      signals: signalsFor(world), summary: summaryFor(world)
    };
  }

  function filmFrame(film, seconds) {
    if (seconds < film.intro) {
      return { minute: 0, phase: "intro", opening: clamp(seconds / film.intro, 0, 1), clip: { camera: "overview" } };
    }
    if (seconds >= film.intro + film.live) {
      return { minute: film.minutes, phase: "summary", clip: { camera: "dispatch" }, summary: film.summary };
    }
    const minute = (seconds - film.intro) / film.live * film.minutes;
    const clip = film.shots.find(shot => minute >= shot.start && minute < shot.end)
      ?? { camera: "helicopter" };
    return { minute, phase: "live", clip };
  }

  function seekFilm(film, minute) {
    return film.intro + clamp(minute / film.minutes, 0, 1) * film.live;
  }

  const api = { formatTime, eventsAt, evacuation, phoneNotice, buildFilm, filmFrame, seekFilm };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.RunoutTimeline = api;
})(globalThis);
