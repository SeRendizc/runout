(function (root) {
  "use strict";

  const base = root.ValleyModel || (typeof module !== "undefined" && module.exports
    ? require("./terrain-model.js") : null);
  const reports = {
    gfz: { name: "GFZ · 2026 吉隆事件", url: "https://www.gfz.de/en/section/geomorphology/overview/details-section-news/extreme-sturzflut-in-china-und-nepal" },
    gyirong: { name: "2026 吉隆动力学复盘", url: "https://jms.imde.ac.cn/en/article/doi/10.1007/s11629-026-1482-y?viewType=HTML" },
    purepu: { name: "尼泊尔灾害管理局 · 2025 报告", url: "https://ndrrma.gov.np/mediafiles/publications/Rasuwagadhi_Flood_Sitrep1_08072025_.pdf" },
    purepuSource: { name: "HiRisk · Purepu 源区和路径", url: "https://hirisk.org/wp-content/uploads/2025/07/RHA_CN1_PurepuGLOF-2.pdf" },
    andes: { name: "Villa Santa Lucía 现场调查", url: "https://nhess.copernicus.org/articles/20/2319/2020/" },
    terrain: { name: "Copernicus GLO-30 地形", url: "https://registry.opendata.aws/copernicus-dem/" }
  };
  const positions = {
    ice: [85.52723, 28.2877],
    lake: [85.646705, 28.402561],
    north: [85.370, 28.414],
    west: [85.410, 28.409],
    east: [85.450, 28.369],
    east2: [85.507, 28.312],
    nepal: [85.420, 28.165],
    bridge: [85.395, 28.240],
    port: [85.37770, 28.2774],
    timure: [85.36667, 28.25285],
    syapru: [85.34273, 28.16588]
  };
  const primarySites = [
    { id: "port", name: "吉隆口岸", ll: positions.port, walk: 4.2, snap: 2 },
    { id: "timure", name: "Timure 河谷", ll: positions.timure, walk: 4.4, snap: 3 },
    { id: "syapru", name: "Syapru Besi", ll: positions.syapru, walk: 5.1, snap: 2 }
  ];
  const specs = [
    {
      id: "01", title: "吉隆冰岩崩", subtitle: "2026 · 单源分流", category: "历史约束",
      description: "冰岩崩沿 Lhende 河谷下行。到达口岸汇入口后，一股向上游回冲，主波继续进入尼泊尔下游。",
      notes: "公开报道将首波冲击置于振动后约 7 分钟。口岸时刻用于校准。演练设定中，口岸收到通知时已不足以走完整条路线；下游仍有撤离时间。通知和撤离并非史实。",
      roots: [{ source: "ice", model: "ice", label: "冰岩崩源", cap: 40000, portTime: 7.35 }],
      returnAtPort: true, sites: primarySites.map((site, index) => ({
        ...site, notify: [4.1, 4.3, 4.6][index]
      })), dispatch: 4.1, sources: [reports.gfz, reports.gyirong]
    },
    {
      id: "02", title: "Purepu 冰面湖溃决", subtitle: "2025 · 从中国侧到下游", category: "历史约束",
      description: "冰面湖快速排水。波头沿河网向吉隆口岸和尼泊尔下游推进。",
      notes: "源区和传播方向来自公开资料。时钟为场景估计，未用实测到达时间校准。",
      roots: [{ source: "lake", model: "lake", label: "Purepu 湖", cap: 54200 }],
      sites: primarySites, dispatch: 7.2, sources: [reports.purepu, reports.purepuSource]
    },
    {
      id: "03", title: "北坡支沟", subtitle: "中国侧 · 境内衰减", category: "假设场景",
      description: "较短程的北侧支沟波头在到达口岸之前停止。仅沟谷内的演练点收到通知。",
      roots: [{ source: "north", model: "small", label: "北坡源", cap: 11200 }],
      sites: [{ id: "north-gully", name: "中国侧沟口", at: [0, 5700], walk: 3.3 }, primarySites[0]], dispatch: 1.5
    },
    {
      id: "04", title: "南坡支谷", subtitle: "尼泊尔侧 · 局部扩散", category: "假设场景",
      description: "尼泊尔侧支谷发生泥石流，波头向 Syapru Besi 推进。口岸位于源区上游。",
      roots: [{ source: "nepal", model: "small", label: "南坡源", cap: 10800 }],
      sites: [{ id: "nepal-gully", name: "尼泊尔侧沟口", at: [0, 5150], walk: 3.2 }, primarySites[2], primarySites[0]], dispatch: 1.2
    },
    {
      id: "05", title: "一脊之隔", subtitle: "邻近点位 · 不同暴露", category: "假设场景",
      description: "相邻的两个演练点离源区相近。山脊把波头留在其中一条谷地。",
      roots: [{ source: "east", model: "small", label: "东侧支沟源", cap: 9200 }],
      sites: [{ id: "east-gully", name: "谷底演练点", at: [0, 4400], walk: 2.4 },
        { id: "ridge-control", name: "隔脊演练点", control: [0, 4400], walk: 0 }], dispatch: 1.1
    },
    {
      id: "06", title: "双源汇合", subtitle: "同时启动 · 同一干流", category: "双源场景",
      description: "两条支谷同一时刻启动。固定镜头转到口岸汇入口，观察两股波头进入同一干流。",
      roots: [
        { source: "north", model: "large", label: "北支 A", cap: 36200, portTime: 13.6 },
        { source: "east", model: "large", label: "东支 B", cap: 30500, portTime: 13.7 }
      ],
      merge: true, sites: primarySites, dispatch: 5.4
    },
    {
      id: "07", title: "第二波", subtitle: "错时启动 · 预警更新", category: "双源场景",
      description: "第二源在首波之后启动。终端送达更新，提示后续波次和继续避险。",
      roots: [
        { source: "west", model: "large", label: "首波 A", cap: 40700 },
        { source: "east2", model: "small", label: "第二波 B", cap: 32400, start: 9.2 }
      ],
      merge: true, sites: primarySites, dispatch: 5, update: 10.7
    },
    {
      id: "08", title: "并发两谷", subtitle: "同时启动 · 两个通知范围", category: "双源场景",
      description: "北坡与南坡各有一个独立的波头。两条短程路径没有交会，两地终端分别收到通知。",
      roots: [
        { source: "north", model: "small", label: "北谷 A", cap: 11000 },
        { source: "nepal", model: "small", label: "南谷 B", cap: 10500 }
      ],
      sites: [{ id: "north-gully", name: "中国侧沟口", at: [0, 5700], walk: 3.4, notify: 1.4 },
        { id: "south-gully", name: "尼泊尔侧沟口", at: [1, 6000], walk: 3.2, notify: 2.3 }], dispatch: 1.4
    },
    {
      id: "09", title: "信号中断", subtitle: "同一路径 · 延迟送达", category: "预警压力测试",
      description: "波头与场景 01 相同。上游信号中断后，下游监测更晚识别，近端已经过流。",
      roots: [{ source: "ice", model: "ice", label: "冰岩崩源", cap: 40000, portTime: 7.35 }],
      returnAtPort: true, sites: primarySites, dispatch: 10.65, sources: [reports.gfz, reports.gyirong]
    },
    {
      id: "10", title: "桥先失效", subtitle: "撤离路线 · 先于聚落过流", category: "预警压力测试",
      description: "同一支谷的两个点收到告警。主路所经演练桥已失效，一处可改走短程坡路，另一处来不及。",
      roots: [{ source: "bridge", model: "small", label: "尼泊尔支谷源", cap: 13800 }],
      sites: [
        { id: "bridge-near", name: "谷口演练点", at: [0, 6220], walk: 4.9, bridgeAt: [0, 5000], notify: 4.0 },
        { id: "bridge-far", name: "下游演练点", at: [0, 12800], walk: 6.6, bridgeAt: [0, 8900], backupWalk: 3.2 }
      ],
      dispatch: 8.35
    },
    {
      id: "andes", title: "Villa Santa Lucía", subtitle: "安第斯 · 对照 Example", category: "对照案例", example: true,
      description: "从 Río Burritos 峡谷到冲积扇。浏览现场描线与模拟扩张的差别。",
      notes: "智利的现场调查用于检验峡谷约束与冲积扇扩展，预警和撤离为演练。",
      roots: [{ source: "andes", model: "andes", label: "Río Burritos 源", cap: 12700 }],
      sites: [{ id: "canyon", name: "Burritos 峡谷", old: 0, walk: 3.4, snap: 1 },
        { id: "villa", name: "Villa Santa Lucía", old: 1, walk: 4.7, snap: 2 },
        { id: "fan", name: "冲积扇南缘", old: 2, walk: 3.3 }], dispatch: 2.5,
      sources: [reports.andes]
    }
  ];
  const profiles = {
    ice: { slope: 49, base: 25, max: 62, channel: 19, confinement: 26, radius: 5, decay: 0.22 },
    lake: { slope: 35, base: 15, max: 48, channel: 11, confinement: 25, radius: 5, decay: 0.20 },
    large: { slope: 37, base: 17, max: 49, channel: 13, confinement: 25, radius: 5, decay: 0.23 },
    small: { slope: 28, base: 9, max: 29, channel: 7.5, confinement: 14, radius: 4, decay: 0.36 },
    andes: { slope: 39, base: 13, max: 36, channel: 12, confinement: 19, radius: 8, decay: 0.14 }
  };
  const terrainCache = new Map();
  const worldCache = new Map();
  const directions = [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [-1, 1], [1, -1], [1, 1]];

  function position(grid, [lon, lat]) {
    const [west, south, east, north] = grid.bounds;
    return { x: (lon - west) * grid.cols / (east - west), y: (north - lat) * grid.rows / (north - south) };
  }

  function cell(grid, x, y) {
    const xx = Math.floor(x), yy = Math.floor(y);
    if (xx < 0 || yy < 0 || xx >= grid.cols || yy >= grid.rows) return -1;
    return yy * grid.cols + xx;
  }

  function readTerrain(key) {
    if (terrainCache.has(key)) return terrainCache.get(key);
    const fixture = key === "andes" ? root.ValleyTerrain.andes : root.RunoutTerrain;
    const binary = atob(fixture.encoded);
    const heights = new Int16Array(binary.length / 2);
    for (let i = 0; i < heights.length; i++) {
      heights[i] = binary.charCodeAt(2 * i) | binary.charCodeAt(2 * i + 1) << 8;
    }
    const { cols, rows, bounds, cell: size } = fixture;
    const grid = { cols, rows, bounds, cell: size, heights };
    const drainage = base.prepare(grid);
    const prepared = { grid, drainage, port: position(grid, positions.port) };
    terrainCache.set(key, prepared);
    return prepared;
  }

  function closest(path, x, y) {
    let best = path[0];
    let gap = Infinity;
    for (const p of path) {
      const d = (p.x - x) ** 2 + (p.y - y) ** 2;
      if (d < gap) { best = p; gap = d; }
    }
    return { point: best, distance: Math.sqrt(gap) };
  }

  function rawPath(terrain, coords) {
    const { grid, drainage } = terrain;
    return base.route(grid, drainage, base.lonLatToCell(grid, ...coords));
  }

  function routedWave(terrain, config) {
    const { grid, port } = terrain;
    const coords = config.source === "andes" ? root.ValleyScenes.andes.source : positions[config.source];
    const raw = rawPath(terrain, coords).filter(p => p.distance <= config.cap);
    const portMatch = closest(raw, port.x, port.y);
    const portDistance = portMatch.distance < 2 ? portMatch.point.distance : Infinity;
    const profile = profiles[config.model];
    let elapsed = 0;
    let slope = raw[0].slope;
    const path = raw.map((p, i) => {
      if (i > 0) {
        slope = 0.83 * slope + 0.17 * raw[i - 1].slope;
        const downstream = p.distance > portDistance;
        const baseSpeed = downstream ? profile.channel : profile.base;
        const tail = (1 - profile.decay * (p.distance / config.cap) ** 3);
        const speed = Math.max(4, Math.min(profile.max, baseSpeed + profile.slope * Math.sqrt(slope)) * tail);
        elapsed += (p.distance - raw[i - 1].distance) / (60 * speed);
      }
      return { ...p, slope, minute: elapsed };
    });
    if (config.portTime && Number.isFinite(portDistance)) {
      const atPort = closest(path, port.x, port.y).point.minute;
      const factor = config.portTime / atPort;
      for (const p of path) {
        p.minute = p.distance <= portDistance ? p.minute * factor : p.minute - atPort + config.portTime;
      }
    }
    return {
      path, start: config.start || 0, label: config.label, kind: "source", profile: config.model,
      width: profile.radius * grid.cell, depositLimit: config.cap,
      portDistance
    };
  }

  function returnWave(terrain, first) {
    const { grid, port } = terrain;
    const entry = closest(first.path, port.x, port.y).point;
    const north = rawPath(terrain, positions.north);
    const pivot = closest(north, entry.x, entry.y).point;
    const index = north.findIndex(p => p.id === pivot.id);
    const path = north.slice(0, index + 1).reverse().filter(p => pivot.distance - p.distance < 2860)
      .map(p => ({ ...p, distance: pivot.distance - p.distance,
        minute: (pivot.distance - p.distance) / 850 }));
    return {
      path, start: first.start + entry.minute, label: "汇入口回冲", kind: "return",
      profile: "small", width: 2 * grid.cell, depositLimit: 2900
    };
  }

  function bendAt(path, index) {
    const p = path[index];
    const before = path[Math.max(0, index - 4)];
    const after = path[Math.min(path.length - 1, index + 4)];
    const ax = p.x - before.x, ay = p.y - before.y;
    const bx = after.x - p.x, by = after.y - p.y;
    const turn = (ax * by - ay * bx) / (Math.hypot(ax, ay) * Math.hypot(bx, by) || 1);
    const span = Math.hypot(after.x - before.x, after.y - before.y) || 1;
    return { turn, dx: (after.x - before.x) / span, dy: (after.y - before.y) / span };
  }

  function reachShape(grid, wave, index) {
    const p = wave.path[index], profile = profiles[wave.profile];
    const steepness = Math.min(1, p.slope / 0.20);
    const tail = Math.max(0.66, 1 - 0.28 * (p.distance / wave.depositLimit));
    const bend = bendAt(wave.path, index);
    const isFan = wave.profile === "andes" && p.distance > 7900;
    const bed = grid.heights[p.id];
    const flank = Math.min(...[-1, 1].map(sign => {
      const id = cell(grid, p.x - bend.dy * 3 * sign, p.y + bend.dx * 3 * sign);
      return id < 0 ? 160 : Math.max(0, grid.heights[id] - bed);
    }));
    const openFloor = Math.max(0, 1 - flank / 105) * (1 - 0.66 * steepness);
    const radius = wave.kind === "return" ? 2.25 : isFan ? 8.7 :
      (profile.radius * (1 - 0.50 * steepness) + 1.35 * openFloor) * tail;
    const rise = (isFan ? 29 : profile.confinement + 9 * openFloor) * (1 - 0.33 * steepness) * tail;
    return { ...bend, radius, rise, isFan, lateralSpeed: isFan ? 360 : 510 };
  }

  function spreadReach(grid, field, visit, token, seed, shape, time, tail) {
    const bed = grid.heights[seed.id];
    const queue = [[seed.id, 0]];
    let width = 0;
    visit[seed.id] = token;
    for (let index = 0; index < queue.length; index++) {
      const [id, distance] = queue[index];
      const t = time + distance * grid.cell / shape.lateralSpeed;
      field.arrival[id] = Math.min(field.arrival[id], t);
      field.clearance[id] = Math.max(field.clearance[id], t + tail);
      const xx = id % grid.cols, yy = Math.floor(id / grid.cols);
      const px = xx + 0.5 - seed.x, py = yy + 0.5 - seed.y;
      width = Math.max(width, Math.abs(shape.dx * py - shape.dy * px));
      for (const [dx, dy] of directions) {
        const n = cell(grid, xx + dx, yy + dy);
        if (n < 0 || visit[n] === token) continue;
        const rx = px + dx, ry = py + dy;
        const side = shape.dx * ry - shape.dy * rx;
        // The outside bank of a turn may see limited run-up; all cells
        // still need a connected low-elevation path from the channel.
        const outer = Math.max(0, -Math.sign(side) * shape.turn);
        const radius = shape.radius + 0.95 * outer;
        const ceiling = bed + shape.rise + 9 * outer;
        const step = dx && dy ? Math.SQRT2 : 1;
        if (distance + step > radius || grid.heights[n] > ceiling) continue;
        if (dx && dy) {
          const a = cell(grid, xx + dx, yy), b = cell(grid, xx, yy + dy);
          if (grid.heights[a] > ceiling || grid.heights[b] > ceiling) continue;
        }
        visit[n] = token;
        queue.push([n, distance + step]);
      }
    }
    return width;
  }

  function hazardGrid(grid, waves, interaction, renderShape = false) {
    const field = {
      arrival: new Float32Array(grid.heights.length).fill(Infinity),
      clearance: new Float32Array(grid.heights.length).fill(-Infinity)
    };
    const visit = new Int32Array(field.arrival.length);
    let token = 0;
    for (const wave of waves) {
      const duration = wave.kind === "return" ? 2.2 : {
        ice: 3.5, lake: 5.0, large: 3.1, small: 1.9, andes: 3.2
      }[wave.profile];
      wave.path.forEach((p, index) => {
        const shape = reachShape(grid, wave, index);
        const time = p.minute + wave.start;
        const tail = duration * (1 - 0.28 * p.distance / wave.depositLimit);
        let width = spreadReach(grid, field, visit, ++token, p, shape, time, tail);
        let localBoost = 0;
        if (interaction && wave.kind === "source") {
          const distance = p.distance - interaction.distance.get(wave);
          const simultaneous = interaction.kind === "reinforcement";
          // Limit the incoming backwater lobe to tributary cells still
          // below the small, temporary head rise at the shared junction.
          const upstream = simultaneous && distance < 0;
          const reach = upstream ? 640 : simultaneous ? 2500 : 1700;
          const fade = Math.max(0, 1 - Math.abs(distance) / reach);
          const lowEnough = !upstream || grid.heights[p.id] <= interaction.bed + 15 * interaction.strength;
          if (lowEnough && fade > 0) {
            localBoost = interaction.strength * fade * (upstream ? 0.48 : 1);
            const broadened = {
              ...shape,
              radius: shape.radius + 3.4 * localBoost,
              rise: shape.rise + 36 * localBoost
            };
            const pulseStart = Math.max(time, interaction.minute + Math.abs(distance) / 1250);
            width = Math.max(width, spreadReach(
              grid, field, visit, ++token, p, broadened, pulseStart, tail + 2.7 * localBoost
            ));
          }
        }
        if (renderShape) {
          p.width = Math.min(width, 3.2);
          p.depth = Math.min(18, 2.4 + shape.rise * 0.22 + localBoost * 12);
        }
      });
    }
    for (let id = 0; id < field.arrival.length; id++) {
      if (!Number.isFinite(field.arrival[id])) field.clearance[id] = Infinity;
    }
    return field;
  }

  function nearDistance(waves, [index, meters]) {
    const path = waves[index].path;
    return path.find(p => p.distance >= meters) || path.at(-1);
  }

  function nearbyCovered(grid, arrival, origin, distance, secondary) {
    let choice = origin;
    let min = Infinity;
    const xx = Math.floor(origin.x), yy = Math.floor(origin.y);
    for (let y = yy - distance; y <= yy + distance; y++) {
      for (let x = xx - distance; x <= xx + distance; x++) {
        const id = cell(grid, x, y);
        const d = Math.hypot(x + 0.5 - origin.x, y + 0.5 - origin.y);
        if (d > distance || d >= min || !Number.isFinite(arrival[id]) ||
          (secondary && !Number.isFinite(secondary[id]))) continue;
        min = d;
        choice = { x: x + 0.5, y: y + 0.5 };
      }
    }
    return choice;
  }

  function controlPoint(grid, arrival, origin) {
    const z = grid.heights[cell(grid, origin.x, origin.y)];
    let best = origin, score = -Infinity;
    for (let y = -15; y <= 15; y++) {
      for (let x = -15; x <= 15; x++) {
        const d = Math.hypot(x, y);
        const id = cell(grid, origin.x + x, origin.y + y);
        if (id < 0 || d < 6 || d > 15 || Number.isFinite(arrival[id])) continue;
        const targetHeight = grid.heights[id];
        const ridge = Math.max(...[0.25, 0.4, 0.55, 0.7, 0.8].map(fraction =>
          grid.heights[cell(grid, origin.x + x * fraction, origin.y + y * fraction)]));
        const separation = ridge - Math.max(z, targetHeight);
        if (separation < 25) continue;
        const rating = separation - d * 2 - Math.max(0, targetHeight - z) * 0.35;
        if (rating > score) { best = { x: origin.x + x, y: origin.y + y }; score = rating; }
      }
    }
    return best;
  }

  function evacuationRoute(grid, arrival, site, direction = 1) {
    const z = grid.heights[cell(grid, site.x, site.y)];
    let best = { x: site.x, y: site.y + direction };
    let bestScore = -Infinity;
    for (const radius of [2, 3, 4, 6, 8, 10, 12]) {
      for (let i = 0; i < 16; i++) {
        const angle = i * Math.PI / 8;
        const x = Math.cos(angle) * radius, y = Math.sin(angle) * radius;
        const end = cell(grid, site.x + x, site.y + y);
        const middle = cell(grid, site.x + x / 2, site.y + y / 2);
        if (end < 0 || middle < 0) continue;
        const climb = grid.heights[end] - z;
        const middleClimb = grid.heights[middle] - z;
        const cover = Number.isFinite(arrival[end]) ? 230 : 0;
        const heightScore = Math.min(climb, 75) + Math.min(middleClimb, 40) / 2;
        const cliffPenalty = Math.max(0, climb - 0.38 * radius * grid.cell);
        const score = heightScore - cover - cliffPenalty - radius * 10 + direction * x * 2;
        if (score > bestScore) { bestScore = score; best = { x: site.x + x, y: site.y + y }; }
      }
    }
    return [
      { x: site.x, y: site.y },
      { x: site.x + (best.x - site.x) * 0.35, y: site.y + (best.y - site.y) * 0.35 },
      { x: site.x + (best.x - site.x) * 0.68, y: site.y + (best.y - site.y) * 0.68 },
      best
    ];
  }

  function routeDistance(route) {
    return route.slice(1).reduce((sum, p, i) =>
      sum + Math.hypot(p.x - route[i].x, p.y - route[i].y), 0);
  }

  function bridgeFor(wave, point, siteId) {
    const index = wave.path.indexOf(point);
    const before = wave.path[Math.max(index - 2, 0)];
    const after = wave.path[Math.min(index + 2, wave.path.length - 1)];
    return {
      id: siteId + "-bridge", x: point.x, y: point.y,
      heading: Math.atan2(after.y - before.y, after.x - before.x) + Math.PI / 2,
      length: 2.2, closedAt: point.minute + wave.start
    };
  }

  function makeSite(spec, config, grid, arrival, waves, secondArrival) {
    const locale = config.old === undefined ? config.ll : root.ValleyScenes.andes.sites[config.old].coordinate;
    const raw = config.at ? nearDistance(waves, config.at)
      : config.control ? controlPoint(grid, arrival, nearDistance(waves, config.control))
        : position(grid, locale);
    const both = config.snap && secondArrival ? nearbyCovered(grid, arrival, raw, config.snap, secondArrival) : raw;
    const location = both !== raw ? both : config.snap ? nearbyCovered(grid, arrival, raw, config.snap) : raw;
    const t = arrival[cell(grid, location.x, location.y)];
    const impact = Number.isFinite(t) ? t : null;
    const notify = impact === null ? null : (config.notify ?? spec.dispatch);
    const site = {
      id: config.id, name: config.name, x: location.x, y: location.y,
      arrival: impact, notify, walk: config.walk,
      message: "请沿演练标示路线前往高处集合点。",
      route: evacuationRoute(grid, arrival, location)
    };
    if (config.bridgeAt) {
      const b = nearDistance(waves, config.bridgeAt);
      const bridge = bridgeFor(waves[config.bridgeAt[0]], b, site.id);
      site.bridge = bridge;
      site.closure = bridge.closedAt;
      const uphill = evacuationRoute(grid, arrival, bridge, -1);
      const first = site.route[0];
      site.route = [first, bridge, ...uphill.slice(1)];
      const toBridge = Math.hypot(first.x - bridge.x, first.y - bridge.y);
      const total = routeDistance(site.route);
      site.bridgeFraction = toBridge / total;
      site.walk = Math.max(site.walk, total * grid.cell / 72);
      site.message = "演练桥已关闭。请遵循现场指示，沿可用坡路撤离。";
      if (config.backupWalk) {
        site.backup = evacuationRoute(grid, arrival, location, 1);
        site.backupWalk = Math.max(config.backupWalk, routeDistance(site.backup) * grid.cell / 72);
      }
    }
    if (spec.update && notify !== null) {
      const second = secondArrival[cell(grid, site.x, site.y)];
      site.updates = [{
        minute: spec.update,
        arrival: Number.isFinite(second) ? second : undefined,
        message: Number.isFinite(second) ? "预计还有第二股泥石流经过。请继续在演练集合点避险。"
          : "上游出现第二股泥石流。请继续留在演练集合点。"
      }];
    }
    return site;
  }

  function confluence(terrain, spec, waves) {
    if (spec.returnAtPort) {
      const port = closest(waves[0].path, terrain.port.x, terrain.port.y).point;
      return { point: port, time: port.minute + waves[0].start };
    }
    if (!spec.merge || waves.length < 2) return {};
    const other = new Map(waves[1].path.map(p => [p.id, p]));
    const first = waves[0].path.find(p => other.has(p.id));
    if (!first) return {};
    return { point: first, time: Math.max(first.minute + waves[0].start,
      other.get(first.id).minute + waves[1].start) };
  }

  function interactionFor(spec, waves, joint, terrain) {
    if (spec.returnAtPort || spec.id === "02") {
      const main = waves[0], port = closest(main.path, terrain.port.x, terrain.port.y).point;
      return {
        kind: "junction", x: port.x, y: port.y, minute: port.minute + main.start,
        strength: spec.returnAtPort ? 0.74 : 0.49, distance: new Map([[main, port.distance]])
      };
    }
    if (!spec.merge || !joint.point) return null;
    const pair = waves.map(wave => wave.path.find(p => p.id === joint.point.id));
    const times = pair.map((p, index) => p.minute + waves[index].start);
    const gap = Math.abs(times[0] - times[1]);
    const synchrony = Math.max(0, 1 - gap / 1.8);
    if (synchrony === 0) return null;
    return {
      kind: "reinforcement", x: joint.point.x, y: joint.point.y, minute: Math.max(...times),
      strength: 0.62 * synchrony, bed: terrain.grid.heights[joint.point.id],
      distance: new Map(waves.map((wave, i) => [wave, pair[i].distance]))
    };
  }

  function create(id) {
    if (worldCache.has(id)) return worldCache.get(id);
    const spec = specs.find(value => value.id === id);
    if (!spec) throw new RangeError("Unknown RUNOUT scene: " + id);
    const terrain = readTerrain(id === "andes" ? "andes" : "himalaya");
    const { grid } = terrain;
    const waves = spec.roots.map(config => routedWave(terrain, config));
    if (spec.returnAtPort) waves.push(returnWave(terrain, waves[0]));
    const joint = confluence(terrain, spec, waves);
    const interaction = interactionFor(spec, waves, joint, terrain);
    const { arrival, clearance } = hazardGrid(grid, waves, interaction, true);
    const secondArrival = spec.update ? hazardGrid(grid, [waves[1]]).arrival : null;
    const sites = spec.sites.map(config => makeSite(spec, config, grid, arrival, waves, secondArrival));
    const sources = [...(spec.sources || []), reports.terrain];
    const last = Math.max(...waves.map(wave => wave.start + wave.path.at(-1).minute),
      ...sites.map(site => {
        if (site.notify === null) return 0;
        const walk = site.closure <= site.notify ? (site.backupWalk || 0) : site.walk;
        return Math.max(site.notify, Math.min(site.notify + walk, site.arrival));
      }));
    let lastTail = last;
    for (const tail of clearance) if (Number.isFinite(tail)) lastTail = Math.max(lastTail, tail);
    const duration = Math.ceil(lastTail + 0.8);
    const observed = id === "andes" ? root.ValleyScenes.andes.observed.map(ll => position(grid, ll)) : undefined;
    const metrics = observed ? base.compare(grid, arrival, observed.map(p => [p.x, p.y])) : undefined;
    const world = {
      sceneId: id, title: spec.title, subtitle: spec.subtitle, category: spec.category,
      description: spec.description,
      notes: (spec.notes || "基于真实地形的假设演练。流速、通知和撤离均为场景设定。") +
        " 影响范围和波尾为简化估计，110 米或 60 米高程网格无法核实道路和安全点。",
      grid, waves, sites, arrival, clearance, duration, confluence: joint.point,
      interactions: interaction ? [{
        kind: interaction.kind, x: interaction.x, y: interaction.y,
        minute: interaction.minute, strength: interaction.strength
      }] : [],
      confluenceTime: joint.time, bridges: sites.flatMap(site => site.bridge ? [site.bridge] : []),
      sources, observed, metrics
    };
    worldCache.set(id, world);
    return world;
  }

  function dryBuffer(grid, arrival, id) {
    const x = id % grid.cols, y = Math.floor(id / grid.cols);
    return !Number.isFinite(arrival[id]) && directions.every(([dx, dy]) => {
      const n = cell(grid, x + dx, y + dy);
      return n >= 0 && !Number.isFinite(arrival[n]);
    });
  }

  function candidateRoute(world, origin, start, minute) {
    const { grid, arrival } = world;
    const startHeight = grid.heights[start];
    const startX = start % grid.cols, startY = Math.floor(start / grid.cols);
    const reaction = 0.55;
    const clearanceMargin = 0.25;
    const departure = minute + reaction;
    const closed = new Map((world.bridges || []).map(bridge =>
      [cell(grid, bridge.x, bridge.y), bridge.closedAt]));
    const cutoff = (id, t) => arrival[id] <= t + clearanceMargin || (closed.get(id) ?? Infinity) <= t;
    if (cutoff(start, departure)) return null;
    const searchRadius = Math.ceil(850 / grid.cell);
    const highestTravel = 13;
    const originCell = { x: startX + 0.5, y: startY + 0.5 };
    const initialWalk = Math.hypot(origin.x - originCell.x, origin.y - originCell.y) * grid.cell / 68;
    if (cutoff(start, departure + initialWalk)) return null;
    const best = new Map([[start, initialWalk]]);
    const previous = new Map();
    const todo = [[start, initialWalk]];
    while (todo.length) {
      todo.sort((a, b) => b[1] - a[1]);
      const [id, elapsed] = todo.pop();
      if (elapsed !== best.get(id)) continue;
      const x = id % grid.cols, y = Math.floor(id / grid.cols);
      const minRise = Math.max(15, 0.13 * grid.cell);
      if (grid.heights[id] >= startHeight + minRise && dryBuffer(grid, arrival, id)) {
        const ids = [id];
        while (ids[ids.length - 1] !== start) ids.push(previous.get(ids[ids.length - 1]));
        const route = ids.reverse().map(point => ({
          x: point % grid.cols + 0.5, y: Math.floor(point / grid.cols) + 0.5
        }));
        if (initialWalk > 0.0001) route.unshift({ x: origin.x, y: origin.y });
        return { route, targetElevation: grid.heights[id], walk: elapsed };
      }
      for (const [dx, dy] of directions) {
        if (Math.hypot(x + dx - startX, y + dy - startY) > searchRadius) continue;
        const next = cell(grid, x + dx, y + dy);
        if (next < 0) continue;
        const distance = Math.hypot(dx, dy) * grid.cell;
        const slope = (grid.heights[next] - grid.heights[id]) / distance;
        if (Math.abs(slope) > 0.48) continue;
        const step = distance / 68 * (1 + Math.max(0, slope) * 3.3 + Math.max(0, -slope - 0.16) * 2.4);
        const travel = elapsed + step;
        const mid = departure + elapsed + step * 0.5, end = departure + travel;
        if (travel > highestTravel || travel >= (best.get(next) ?? Infinity) ||
          cutoff(id, mid) || cutoff(next, end)) continue;
        if (dx && dy) {
          const a = cell(grid, x + dx, y), b = cell(grid, x, y + dy);
          if (cutoff(a, mid) || cutoff(b, mid) ||
            Math.abs(grid.heights[a] - grid.heights[id]) > 0.48 * grid.cell ||
            Math.abs(grid.heights[b] - grid.heights[id]) > 0.48 * grid.cell) continue;
        }
        best.set(next, travel);
        previous.set(next, id);
        todo.push([next, travel]);
      }
    }
    return null;
  }

  function probe(world, point, minute = 0) {
    const result = {
      status: "insufficient", arrival: null, clear: null, elevation: null,
      route: [], targetElevation: null, walk: null
    };
    if (!world || !Number.isFinite(point?.x) || !Number.isFinite(point?.y) || !Number.isFinite(minute)) {
      return { ...result, reason: "缺少有效位置、时间或地形。" };
    }
    const { grid, arrival, clearance } = world;
    const id = cell(grid, point.x, point.y);
    if (id < 0) return { ...result, reason: "这个点超出当前地形覆盖。" };
    result.elevation = grid.heights[id];
    const first = arrival[id];
    if (!Number.isFinite(first)) {
      if (!dryBuffer(grid, arrival, id)) {
        return { ...result, reason: "靠近模拟边界或地形边缘，网格不足以判断是否会过流。" };
      }
      return { ...result, status: "outside", reason: "当前演练的模拟波前未到达这个网格。" };
    }
    result.status = "affected";
    result.arrival = first;
    result.clear = Number.isFinite(clearance?.[id]) ? clearance[id] : null;
    if (minute >= first) {
      return { ...result, reason: "第一波已到达。波尾时刻是模拟估计，不代表解除预警。" };
    }
    const route = candidateRoute(world, point, id, Math.max(0, minute));
    if (!route) return { ...result, reason: "在当前时间和地形分辨率下，未找到及时、可达的高处候选。" };
    return {
      ...result, ...route,
      reason: "基于高程和波前时刻估算的演练路线，未核验道路和集合点。"
    };
  }

  const catalog = specs.map(({ id, title, subtitle, category, example }) => ({ id, title, subtitle, category, example }));
  const api = { catalog, create, probe };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  root.RunoutWorld = api;
})(globalThis);
