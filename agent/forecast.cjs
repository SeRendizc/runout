"use strict";

const dem = require("../dist/terrain-model.js");
require("../dist/runout-terrain.js");
require("../dist/terrain-data.js");

const fixtures = Object.freeze({ himalaya: globalThis.RunoutTerrain, andes: globalThis.ValleyTerrain.andes });
const terrains = new Map();
const states = new WeakMap();
const RESPONSE_SECONDS = 30;
const ROUTE_CLEARANCE_SECONDS = 20;
const AFFECTED_SUPPORT = 0.67;
const VELOCITIES = [
  { base: 5, grade: 44, cap: 43, prior: 0.12 },
  { base: 9, grade: 53, cap: 55, prior: 0.22 },
  { base: 14, grade: 63, cap: 66, prior: 0.32 },
  { base: 20, grade: 71, cap: 78, prior: 0.22 },
  { base: 30, grade: 88, cap: 90, prior: 0.12 }
];
const WIDTHS = [[14, 2, 0.25], [24, 3, 0.50], [38, 5, 0.25]];
const DIRECTIONS = [[1, 0], [0, 1], [-1, 0], [0, -1], [1, 1], [-1, 1], [1, -1], [-1, -1]];

const finite = Number.isFinite;
const clamp = (value, low, high) => Math.max(low, Math.min(high, value));

function terrain(basin) {
  if (!Object.hasOwn(fixtures, basin)) return null;
  if (terrains.has(basin)) return terrains.get(basin);
  const { encoded, ...shape } = fixtures[basin];
  const bytes = Uint8Array.from(atob(encoded), char => char.charCodeAt(0));
  const view = new DataView(bytes.buffer);
  const heights = Int16Array.from({ length: bytes.length / 2 }, (_, index) => view.getInt16(index * 2, true));
  const grid = { ...shape, heights };
  const value = { grid, drainage: dem.prepare(grid), paths: new Map() };
  terrains.set(basin, value);
  return value;
}

function cell(grid, x, y) {
  if (x < 0 || y < 0 || x >= grid.cols || y >= grid.rows) return -1;
  return y * grid.cols + x;
}

function position(grid, lon, lat) {
  const [west, south, east, north] = grid.bounds;
  return {
    x: (lon - west) * grid.cols / (east - west),
    y: (north - lat) * grid.rows / (north - south)
  };
}

function coordinates(grid, id) {
  const [west, south, east, north] = grid.bounds;
  const point = dem.cellCenter(grid, id);
  return { lon: west + point.x / grid.cols * (east - west), lat: north - point.y / grid.rows * (north - south) };
}

function routeFor(prepared, origin) {
  if (!prepared.paths.has(origin)) {
    if (prepared.paths.size >= 128) prepared.paths.delete(prepared.paths.keys().next().value);
    prepared.paths.set(origin, dem.route(prepared.grid, prepared.drainage, origin));
  }
  return prepared.paths.get(origin);
}

function frontPath(prepared, front) {
  const path = routeFor(prepared, front.origin);
  return finite(front.capMeters) ? path.filter(point => point.distance <= front.capMeters) : path;
}

function visibleEvidence(rows, asOf) {
  const seen = new Set();
  return (Array.isArray(rows) ? rows : []).filter(row =>
    row && typeof row.id === "string" && row.id.length > 0 &&
    finite(row.observedAt) && row.observedAt >= 0 &&
    finite(row.availableAt) && row.availableAt >= row.observedAt && row.availableAt <= asOf
  ).sort((a, b) => a.availableAt - b.availableAt || a.observedAt - b.observedAt || a.id.localeCompare(b.id))
    .filter(row => {
      if (seen.has(row.id)) return false;
      seen.add(row.id);
      return true;
    });
}

function geolocated(row, grid) {
  return finite(row.lon) && finite(row.lat) && dem.lonLatToCell(grid, row.lon, row.lat) >= 0;
}

function timingUncertainty(row, fallback) {
  const explicit = row.timeUncertaintySeconds ?? row.timingUncertaintySeconds;
  if (finite(explicit) && explicit >= 0) return clamp(explicit, 5, 240);
  const window = row.releaseWindow;
  if (Array.isArray(window) && window.length === 2 && window.every(finite) &&
    window[0] <= window[1] && window[1] <= row.observedAt) {
    return clamp((window[1] - window[0]) / 2, 5, 240);
  }
  return fallback;
}

function sourceCandidate(row) {
  const identified = ["release_candidate", "source", "source_candidate"].includes(row.role);
  return row.kind === "waveform" && (row.role == null || identified) || row.kind === "camera" && identified;
}

function constraintCandidate(row) {
  const arrival = ["downstream_constraint", "arrival", "passage", "front_passage"].includes(row.role);
  return (row.kind === "gauge" || row.kind === "camera") && (row.role == null || arrival);
}

function routeClosures(rows, grid) {
  return rows.filter(row => row.role === "bridge_closure" && geolocated(row, grid) && finite(row.closureAt) &&
    row.closureAt >= 0 && row.closureAt <= row.observedAt).map(row => ({
    evidenceId: row.id, lon: row.lon, lat: row.lat, closureAt: row.closureAt
  }));
}

function releaseOf(row) {
  return finite(row.releaseAt) && row.releaseAt >= 0 && row.releaseAt <= row.observedAt ? row.releaseAt : row.observedAt;
}

function releaseKey(row) {
  const id = row.releaseId ?? row.frontId ?? row.waveId;
  return typeof id === "string" && id ? id : null;
}

function seedFronts(prepared, rows) {
  const { grid } = prepared;
  const canRoute = row => geolocated(row, grid) &&
    routeFor(prepared, dem.lonLatToCell(grid, row.lon, row.lat)).length > 1;
  const initial = rows.filter(row => sourceCandidate(row) && canRoute(row));
  const fallback = initial.length === 0 ? rows.find(row => constraintCandidate(row) && canRoute(row)) : null;
  const chosen = new Map();
  for (const row of fallback ? [fallback] : initial) {
    const key = releaseKey(row) ?? "primary";
    if (chosen.has(key)) continue;
    const origin = dem.lonLatToCell(grid, row.lon, row.lat);
    const capMeters = finite(row.capMeters) && row.capMeters >= grid.cell && row.capMeters <= 100000 ? row.capMeters : null;
    if (frontPath(prepared, { origin, capMeters }).length < 2) continue;
    chosen.set(key, {
      key, origin, capMeters, lon: row.lon, lat: row.lat, basis: row.locationBasis ?? (fallback ? "first-downstream-observation" : "geolocated-candidate"),
      sourceEvidenceId: row.id, observedAt: row.observedAt,
      anchors: [{ index: 0, time: fallback ? row.observedAt : releaseOf(row), sigma: timingUncertainty(row, fallback ? 20 : 35), id: row.id }]
    });
    if (chosen.size === 4) break;
  }
  return [...chosen.values()];
}

function nearestAnchor(grid, path, row) {
  const point = position(grid, row.lon, row.lat);
  let distance = Infinity;
  let index = -1;
  for (let cursor = 1; cursor < path.length; cursor++) {
    const gap = Math.hypot(path[cursor].x - point.x, path[cursor].y - point.y) * grid.cell;
    if (gap < distance) { distance = gap; index = cursor; }
  }
  const accuracy = finite(row.accuracyMeters) ? clamp(row.accuracyMeters, 0, grid.cell * 2) : 0;
  if (index < 0 || distance > grid.cell * 1.65 + accuracy) return null;
  return { index, distance, time: row.observedAt, sigma: timingUncertainty(row, row.kind === "camera" ? 24 : 30), id: row.id };
}

function compatible(path, anchors, candidate) {
  for (const point of anchors) {
    if (point.index === candidate.index) return false;
    const distance = path[candidate.index].distance - path[point.index].distance;
    const time = candidate.time - point.time;
    if (distance * time <= 0) return false;
    const slack = point.sigma + candidate.sigma;
    if (Math.abs(time) + slack < Math.abs(distance) / 105 || Math.abs(time) - slack > Math.abs(distance) / 2.5) {
      return false;
    }
  }
  return true;
}

function addConstraints(prepared, fronts, rows) {
  const used = new Set(fronts.map(front => front.sourceEvidenceId));
  const constraints = rows.filter(row => constraintCandidate(row) && !used.has(row.id) && geolocated(row, prepared.grid));
  for (const row of constraints) {
    const matches = [];
    const release = releaseKey(row);
    for (const front of fronts) {
      if (release && release !== front.key && release !== front.sourceEvidenceId) continue;
      const path = frontPath(prepared, front);
      const anchor = nearestAnchor(prepared.grid, path, row);
      if (!anchor || !compatible(path, front.anchors, anchor)) continue;
      matches.push({ front, anchor });
    }
    matches.sort((a, b) => a.anchor.distance - b.anchor.distance);
    if (!matches.length) continue;
    // A shared reach cannot identify a wave when the source identifier is absent.
    if (!release && matches.length > 1 && matches[1].anchor.distance - matches[0].anchor.distance < prepared.grid.cell * 0.75) continue;
    const { front, anchor } = matches[0];
    front.anchors.push(anchor);
    front.anchors.sort((a, b) => a.index - b.index);
    used.add(row.id);
  }
  return used;
}

function travelCurve(path, velocity) {
  const elapsed = new Float64Array(path.length);
  for (let index = 1; index < path.length; index++) {
    const before = path[index - 1];
    const distance = path[index].distance - before.distance;
    const speed = Math.min(velocity.cap, velocity.base + velocity.grade * Math.sqrt(before.slope));
    elapsed[index] = elapsed[index - 1] + distance / speed;
  }
  return elapsed;
}

function fittedCurve(elapsed, anchors, profileIndex) {
  const time = new Float64Array(elapsed.length);
  const last = anchors.at(-1);
  let loss = 0;
  let multiplierTotal = 0;
  let constraintWeight = 0;
  for (let index = 1; index < anchors.length; index++) {
    const a = anchors[index - 1];
    const b = anchors[index];
    const assumed = elapsed[b.index] - elapsed[a.index];
    const measured = b.time - a.time;
    const sigma = Math.max(22, Math.hypot(a.sigma, b.sigma), assumed * 0.21);
    const residual = Math.abs(assumed - measured) / sigma;
    // Heavy tails prevent one imperfect measurement from deleting prior alternatives.
    loss += Math.log1p(residual * residual) * 1.32;
    const weight = Math.min(3, measured / sigma);
    multiplierTotal += clamp(measured / assumed, 0.40, 2.50) * weight;
    constraintWeight += weight;
  }
  const pace = clamp((1.65 + multiplierTotal) / (1.65 + constraintWeight), 0.54, 1.90);
  const shift = (2 - profileIndex) * 0.43;
  let bracket = 1;
  for (let index = 0; index < time.length; index++) {
    while (bracket < anchors.length && index > anchors[bracket].index) bracket++;
    if (bracket < anchors.length) {
      const a = anchors[bracket - 1];
      const b = anchors[bracket];
      const f = (elapsed[index] - elapsed[a.index]) / (elapsed[b.index] - elapsed[a.index]);
      const base = a.time + f * (b.time - a.time);
      const uncertainty = a.sigma + f * (b.sigma - a.sigma);
      time[index] = Math.max(0, base + shift * uncertainty);
    } else {
      time[index] = Math.max(0, last.time + shift * last.sigma + (elapsed[index] - elapsed[last.index]) * pace);
    }
    if (index > 0) time[index] = Math.max(time[index], time[index - 1] + 0.01);
  }
  return { time, weight: Math.exp(-Math.min(60, loss)) };
}

function makeState(prepared, fronts) {
  const { grid } = prepared;
  return {
    grid,
    fronts: fronts.map(front => {
      const path = frontPath(prepared, front);
      const hypotheses = VELOCITIES.map((velocity, index) => {
        const fitted = fittedCurve(travelCurve(path, velocity), front.anchors, index);
        return {
          weight: velocity.prior * fitted.weight,
          path: path.map((point, position) => ({ ...point, minute: fitted.time[position] / 60 }))
        };
      });
      const total = hypotheses.reduce((sum, member) => sum + member.weight, 0);
      const members = hypotheses.flatMap(hypothesis => WIDTHS.map(([rise, radius, prior]) => ({
        weight: hypothesis.weight * prior / total,
        arrival: dem.envelope(grid, hypothesis.path, rise, radius)
      })));
      const representative = hypotheses.reduce((best, candidate) => candidate.weight > best.weight ? candidate : best);
      return { key: front.key, members, path: representative.path };
    })
  };
}

function quantile(values, q, totalWeight) {
  const sorted = values.sort((a, b) => a.seconds - b.seconds);
  let cumulative = 0;
  for (const value of sorted) {
    cumulative += value.weight;
    if (cumulative >= q * totalWeight) return value.seconds;
  }
  return sorted.at(-1).seconds;
}

function cellForecast(state, id, asOf) {
  let maxSupport = 0;
  const waves = [];
  for (const front of state.fronts) {
    const values = [];
    let support = 0;
    for (const member of front.members) {
      const arrival = member.arrival[id];
      if (!finite(arrival)) continue;
      support += member.weight;
      values.push({ seconds: arrival * 60, weight: member.weight });
    }
    maxSupport = Math.max(maxSupport, support);
    if (support < AFFECTED_SUPPORT) continue;
    const lower = quantile(values, 0.1, support);
    const upper = quantile(values, 0.9, support);
    const spread = Math.max(15, (upper - lower) * 0.11);
    const low = Math.max(0, Math.floor(lower - spread));
    const high = Math.ceil(upper + spread);
    waves.push({ sourceId: front.key, earliest: low, latest: high, support: Math.round(support * 1000) / 1000 });
  }
  waves.sort((a, b) => a.earliest - b.earliest || a.sourceId.localeCompare(b.sourceId));
  const current = waves.filter(wave => wave.latest >= asOf);
  const earliest = current.length ? current[0].earliest : (waves.at(-1)?.earliest ?? Infinity);
  const latest = current.length ? Math.min(...current.map(wave => wave.latest)) : (waves.at(-1)?.latest ?? Infinity);
  return { earliest, latest, support: maxSupport, waves };
}

function anyModeledImpact(state, id) {
  return id >= 0 && state.fronts.some(front => front.members.some(member => finite(member.arrival[id])));
}

function uncertain(reason, support = 0) {
  return { status: "insufficient", earliest: null, latest: null, support, reason, waves: [] };
}

function impactAt(state, lon, lat, accuracyMeters, asOf) {
  if (!state || !state.fronts.length) return uncertain("no-geolocated-physical-evidence");
  if (!finite(lon) || !finite(lat) || !finite(accuracyMeters) || accuracyMeters < 0 || accuracyMeters > 5000) {
    return uncertain("invalid-or-imprecise-location");
  }
  const { grid } = state;
  const point = position(grid, lon, lat);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  const id = cell(grid, x, y);
  if (id < 0) return uncertain("outside-dem-coverage");
  const extent = accuracyMeters / grid.cell;
  const padding = Math.max(extent, 1);
  if (point.x < padding || point.y < padding || point.x > grid.cols - padding || point.y > grid.rows - padding) {
    return uncertain("terrain-edge");
  }
  const sample = cellForecast(state, id, asOf);
  let earliest = sample.earliest;
  let latest = sample.latest;
  let adjacentImpact = false;
  let incomplete = false;
  const radius = Math.max(1, Math.ceil(extent + 0.5));
  for (let dy = -radius; dy <= radius; dy++) {
    for (let dx = -radius; dx <= radius; dx++) {
      if (dx === 0 && dy === 0) continue;
      const neighbor = cell(grid, x + dx, y + dy);
      if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1 && anyModeledImpact(state, neighbor)) adjacentImpact = true;
      if (extent === 0) continue;
      const left = x + dx;
      const top = y + dy;
      const gap = Math.hypot(Math.max(left - point.x, 0, point.x - left - 1),
        Math.max(top - point.y, 0, point.y - top - 1));
      if (gap > extent) continue;
      const candidate = cellForecast(state, neighbor, asOf);
      if (!finite(candidate.earliest)) incomplete = true;
      if (candidate.support > 0) adjacentImpact = true;
      earliest = Math.min(earliest, candidate.earliest);
      if (finite(candidate.latest)) latest = Math.max(finite(latest) ? latest : candidate.latest, candidate.latest);
    }
  }
  const support = Math.round(sample.support * 1000) / 1000;
  if (finite(sample.earliest) && !incomplete) {
    return { status: "affected", earliest, latest, support, reason: "conditional-modeled-impact", waves: sample.waves };
  }
  if (sample.support > 0 || adjacentImpact) return uncertain("impact-boundary-or-disagreeing-hypotheses", support);
  return { status: "outside", earliest: null, latest: null, support: 0, reason: "outside-current-modeled-footprint", waves: [] };
}

function reconstruct(prepared, snapshot) {
  if (states.has(snapshot)) return states.get(snapshot);
  const fronts = (Array.isArray(snapshot.fronts) ? snapshot.fronts : []).slice(0, 4).filter(front => {
    if (!Number.isInteger(front.origin) || front.origin < 0 || front.origin >= prepared.grid.heights.length ||
      !Array.isArray(front.anchors) || front.anchors.length === 0) return false;
    const path = frontPath(prepared, front);
    if (path.length < 2) return false;
    return front.anchors.every((anchor, index) => Number.isInteger(anchor.index) && anchor.index >= 0 &&
      anchor.index < path.length && finite(anchor.time) && finite(anchor.sigma) && anchor.sigma > 0 &&
      (index === 0 ? anchor.index === 0 : anchor.index > front.anchors[index - 1].index && anchor.time > front.anchors[index - 1].time));
  });
  const state = makeState(prepared, fronts);
  state.closures = new Map();
  for (const closure of snapshot.closures ?? []) {
    if (!closure || !geolocated(closure, prepared.grid) || !finite(closure.closureAt)) continue;
    const id = dem.lonLatToCell(prepared.grid, closure.lon, closure.lat);
    state.closures.set(id, Math.min(state.closures.get(id) ?? Infinity, closure.closureAt));
  }
  states.set(snapshot, state);
  return state;
}

function earliestPlausible(state, id) {
  let earliest = Infinity;
  for (const front of state.fronts) {
    for (const member of front.members) earliest = Math.min(earliest, member.arrival[id] * 60);
  }
  return earliest;
}

function exerciseRoute(state, lon, lat, asOf) {
  const { grid } = state;
  const point = position(grid, lon, lat);
  const x = Math.floor(point.x);
  const y = Math.floor(point.y);
  const start = cell(grid, x, y);
  const departure = asOf + RESPONSE_SECONDS;
  const radius = Math.ceil(820 / grid.cell);
  const initial = Math.hypot(point.x - x - 0.5, point.y - y - 0.5) * grid.cell / 1.12;
  const open = [[start, initial]];
  const best = new Map(open);
  const previous = new Map();
  const unsafe = (id, time) => id < 0 || (state.closures.get(id) ?? Infinity) <= time ||
    earliestPlausible(state, id) <= time + ROUTE_CLEARANCE_SECONDS;
  if (unsafe(start, departure + initial)) return null;
  while (open.length) {
    open.sort((a, b) => b[1] - a[1]);
    const [id, elapsed] = open.pop();
    if (best.get(id) !== elapsed) continue;
    const xx = id % grid.cols;
    const yy = Math.floor(id / grid.cols);
    const above = grid.heights[id] - grid.heights[start] >= 15;
    const buffered = above && !anyModeledImpact(state, id) && DIRECTIONS.every(([dx, dy]) => {
      const neighbor = cell(grid, xx + dx, yy + dy);
      return neighbor >= 0 && !anyModeledImpact(state, neighbor);
    });
    if (buffered) {
      const ids = [id];
      while (ids.at(-1) !== start) ids.push(previous.get(ids.at(-1)));
      const walkSeconds = Math.ceil(elapsed);
      return {
        route: [{ lon, lat }, ...ids.reverse().map(value => coordinates(grid, value))],
        targetElevation: grid.heights[id], walkSeconds, routeStatus: "unverified-dem-exercise-candidate"
      };
    }
    for (const [dx, dy] of DIRECTIONS) {
      if (Math.hypot(xx + dx - x, yy + dy - y) > radius) continue;
      const target = cell(grid, xx + dx, yy + dy);
      if (target < 0) continue;
      const distance = Math.hypot(dx, dy) * grid.cell;
      const slope = (grid.heights[target] - grid.heights[id]) / distance;
      if (Math.abs(slope) > 0.44) continue;
      const step = distance / 1.12 * (1 + Math.max(0, slope) * 3.3 + Math.max(0, -slope - 0.16) * 2.4);
      const nextTime = elapsed + step;
      const midpoint = departure + elapsed + step * 0.5;
      if (nextTime > 780 || nextTime >= (best.get(target) ?? Infinity) || unsafe(id, midpoint) ||
        unsafe(target, departure + nextTime)) continue;
      if (dx && dy && (unsafe(cell(grid, xx + dx, yy), midpoint) || unsafe(cell(grid, xx, yy + dy), midpoint))) continue;
      best.set(target, nextTime);
      previous.set(target, id);
      open.push([target, nextTime]);
    }
  }
  return null;
}

function impactMask(state) {
  const mask = new Uint8Array(state.grid.heights.length);
  for (const front of state.fronts) {
    const support = new Float64Array(mask.length);
    for (const member of front.members) {
      for (let id = 0; id < support.length; id++) {
        if (finite(member.arrival[id])) support[id] += member.weight;
      }
    }
    for (let id = 0; id < support.length; id++) {
      if (support[id] >= AFFECTED_SUPPORT) mask[id] = 1;
    }
  }
  return mask;
}

function coarsen(mask, cols, rows, step) {
  if (step === 1) return { mask, cols, rows };
  const width = Math.floor(cols / step);
  const height = Math.floor(rows / step);
  const reduced = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let covered = true;
      for (let dy = 0; dy < step && covered; dy++) {
        for (let dx = 0; dx < step; dx++) {
          if (mask[(y * step + dy) * cols + x * step + dx]) continue;
          covered = false;
          break;
        }
      }
      if (covered) reduced[y * width + x] = 1;
    }
  }
  return { mask: reduced, cols: width, rows: height };
}

function contains(ring, x, y) {
  let inside = false;
  for (let i = 1; i < ring.length; i++) {
    const [ax, ay] = ring[i - 1];
    const [bx, by] = ring[i];
    if ((ay > y) !== (by > y) && x < ax + (bx - ax) * (y - ay) / (by - ay)) inside = !inside;
  }
  return inside;
}

function outline(mask, cols, rows) {
  const stride = cols + 1;
  const edges = [];
  const outgoing = new Map();
  const covered = (x, y) => x >= 0 && y >= 0 && x < cols && y < rows && mask[y * cols + x];
  const add = (from, to, direction) => {
    const edge = { from, to, direction, used: false };
    edges.push(edge);
    if (!outgoing.has(from)) outgoing.set(from, new Map());
    outgoing.get(from).set(direction, edge);
  };
  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      if (!covered(x, y)) continue;
      const corner = y * stride + x;
      if (!covered(x, y - 1)) add(corner + 1, corner, 2);
      if (!covered(x + 1, y)) add(corner + stride + 1, corner + 1, 3);
      if (!covered(x, y + 1)) add(corner + stride, corner + stride + 1, 0);
      if (!covered(x - 1, y)) add(corner, corner + stride, 1);
    }
  }
  const shells = [];
  const holes = [];
  const point = node => [node % stride, Math.floor(node / stride)];
  for (const origin of edges) {
    if (origin.used) continue;
    const ring = [point(origin.from)];
    let edge = origin;
    while (edge && !edge.used) {
      edge.used = true;
      if (edge.to === origin.from) {
        ring.push(ring[0]);
        break;
      }
      const choices = outgoing.get(edge.to);
      const next = [3, 0, 1, 2].map(turn => choices?.get((edge.direction + turn) % 4))
        .find(candidate => candidate && !candidate.used);
      if (next?.direction !== edge.direction) ring.push(point(edge.to));
      edge = next;
    }
    if (ring.length < 4 || ring.at(-1) !== ring[0]) continue;
    const area = ring.slice(1).reduce((sum, [x, y], index) => sum + ring[index][0] * y - x * ring[index][1], 0);
    if (area < 0) shells.push({ area: -area, polygon: [ring] });
    else if (area > 0) holes.push(ring);
  }
  for (const ring of holes) {
    const [x, y] = ring[0];
    const [xx, yy] = ring[1];
    const containing = shells.filter(shell => contains(shell.polygon[0], (x + xx) / 2, (y + yy) / 2))
      .sort((a, b) => a.area - b.area)[0];
    if (containing) containing.polygon.push(ring);
  }
  return shells.map(shell => shell.polygon);
}

function forecastMap(prepared, state, fronts) {
  const { grid } = prepared;
  const [west, south, east, north] = grid.bounds;
  const round = value => Math.round(value * 1e6) / 1e6;
  const location = (x, y) => [round(west + x / grid.cols * (east - west)),
    round(north - y / grid.rows * (north - south))];
  const features = [];
  if (fronts.length) {
    const mask = impactMask(state);
    for (const step of [1, 2, 3, 4, 6, 8]) {
      const reduced = coarsen(mask, grid.cols, grid.rows, step);
      const polygons = outline(reduced.mask, reduced.cols, reduced.rows);
      const vertexCount = polygons.reduce((sum, polygon) => sum + polygon.reduce((n, ring) => n + ring.length, 0), 0);
      if (vertexCount > 1700) continue;
      if (polygons.length) features.push({
        type: "Feature",
        properties: { role: "modeled-impact", exercise: true, minimumSupport: AFFECTED_SUPPORT,
          cellMeters: grid.cell * step, reduced: step > 1 },
        geometry: { type: "MultiPolygon", coordinates: polygons.map(polygon =>
          polygon.map(ring => ring.map(([x, y]) => location(x * step, y * step)))) }
      });
      break;
    }
  }
  for (const front of fronts) {
    const path = frontPath(prepared, front);
    const stride = Math.max(1, Math.ceil(path.length / 170));
    const points = path.filter((point, index) => index % stride === 0 || index === path.length - 1);
    if (points.length < 2) continue;
    features.push({
      type: "Feature", properties: { role: "modeled-path", sourceId: front.key, exercise: true },
      geometry: { type: "LineString", coordinates: points.map(point => location(point.x, point.y)) }
    });
  }
  return { type: "FeatureCollection", bbox: [...grid.bounds], features };
}

function presentation(state) {
  const waves = state.fronts.map(front => ({ path: front.path.map(({ id, x, y, minute, distance, slope }) =>
    ({ id, x, y, minute, distance, slope })) }));
  const wet = [];
  const mask = impactMask(state);
  for (let id = 0; id < mask.length; id++) {
    if (!mask[id]) continue;
    let earliest = Infinity;
    for (const front of state.fronts) {
      const arrivals = front.members.filter(member => finite(member.arrival[id]));
      const weight = arrivals.reduce((total, member) => total + member.weight, 0);
      if (weight < AFFECTED_SUPPORT) continue;
      const median = quantile(arrivals.map(member => ({ seconds: member.arrival[id] * 60, weight: member.weight })), 0.5, weight);
      earliest = Math.min(earliest, median);
    }
    if (finite(earliest)) wet.push(id, Math.round(earliest));
  }
  return { waves, wet };
}

function forecast(scenario, evidence, asOfSeconds, version) {
  if (!finite(asOfSeconds) || asOfSeconds < 0) throw new RangeError("Forecast time must be nonnegative finite seconds.");
  const prepared = terrain(scenario?.basin);
  if (!prepared) throw new RangeError("Unsupported forecast basin.");
  const rows = visibleEvidence(evidence, asOfSeconds);
  const fronts = seedFronts(prepared, rows);
  const used = addConstraints(prepared, fronts, rows);
  const closures = routeClosures(rows, prepared.grid);
  const closureIds = closures.map(closure => closure.evidenceId);
  const sources = fronts.map(front => ({
    id: front.key, lon: front.lon, lat: front.lat, evidenceId: front.sourceEvidenceId,
    basis: front.basis, releaseAt: front.anchors[0].time, observedAt: front.observedAt,
    assumedRunoutCapMeters: front.capMeters
  }));
  const snapshot = {
    version: version ?? null, asOf: asOfSeconds, scenarioId: scenario.id ?? null, basin: scenario.basin,
    model: "dem-velocity-ensemble-v1", validation: "unvalidated-exercise-estimate",
    supportMeaning: "ensemble-weight-not-calibrated-probability",
    responseSeconds: RESPONSE_SECONDS,
    source: sources.length ? { lon: sources[0].lon, lat: sources[0].lat } : null,
    sources, fronts, closures, routeEvidenceIds: closureIds,
    evidenceIds: rows.filter(row => used.has(row.id)).map(row => row.id),
    advisoryIds: rows.filter(row => row.kind === "post").map(row => row.id),
    rejectedEvidenceIds: rows.filter(row => row.kind !== "post" && !used.has(row.id) && !closureIds.includes(row.id)).map(row => row.id),
    sites: []
  };
  const state = reconstruct(prepared, snapshot);
  snapshot.map = forecastMap(prepared, state, fronts);
  snapshot.presentation = presentation(state);
  snapshot.sites = (Array.isArray(scenario.terminals) ? scenario.terminals : []).map(site => {
    const result = impactAt(state, site.lon, site.lat, site.accuracyMeters ?? 0, asOfSeconds);
    const walkSeconds = finite(site.walkSeconds) && site.walkSeconds >= 0 ? site.walkSeconds : null;
    const margin = result.status === "affected" && walkSeconds !== null
      ? Math.round(result.earliest - asOfSeconds - RESPONSE_SECONDS - walkSeconds) : null;
    return {
      id: site.id, name: site.name, lon: finite(site.lon) ? site.lon : null, lat: finite(site.lat) ? site.lat : null,
      ...result, walkSeconds, margin, phase: result.status === "affected" ? phase(result, asOfSeconds) : null
    };
  });
  return snapshot;
}

function phase(result, asOf) {
  if (asOf > result.latest) return "past-modeled-window";
  return asOf >= result.earliest ? "within-modeled-window" : "before-modeled-window";
}

function query(scenario, snapshot, lon, lat, accuracyMeters = 0, asOfSeconds = snapshot?.asOf) {
  const prepared = terrain(scenario?.basin);
  const empty = { route: [], targetElevation: null, walkSeconds: null, margin: null, phase: null };
  if (!prepared || !snapshot || snapshot.basin !== scenario.basin || snapshot.scenarioId !== (scenario.id ?? null) ||
    !finite(asOfSeconds) || !finite(snapshot.asOf) || asOfSeconds < snapshot.asOf) {
    return { ...empty, ...uncertain("invalid-forecast-version-or-query-time") };
  }
  const state = reconstruct(prepared, snapshot);
  const result = impactAt(state, lon, lat, accuracyMeters, asOfSeconds);
  if (result.status !== "affected") return { ...empty, ...result };
  const currentPhase = phase(result, asOfSeconds);
  const plan = accuracyMeters <= prepared.grid.cell / 2 && currentPhase === "before-modeled-window"
    ? exerciseRoute(state, lon, lat, asOfSeconds) : null;
  const margin = plan ? Math.round(result.earliest - asOfSeconds - RESPONSE_SECONDS - plan.walkSeconds) : null;
  return { ...empty, ...result, phase: currentPhase,
    ...(plan && margin >= 0 ? { ...plan, margin } : { routeStatus: "no-timely-exercise-candidate" }) };
}

module.exports = { forecast, query };
