(function (root) {
  "use strict";
  const directions = [
    [-1, 0], [1, 0], [0, -1], [0, 1],
    [-1, -1], [1, -1], [-1, 1], [1, 1]
  ];

  class MinHeap {
    constructor() { this.items = []; }
    push(id, priority) {
      const items = this.items;
      let index = items.length;
      while (index > 0) {
        const parent = (index - 1) >> 1;
        if (items[parent][1] <= priority) break;
        items[index] = items[parent];
        index = parent;
      }
      items[index] = [id, priority];
    }
    pop() {
      const items = this.items;
      const first = items[0];
      const last = items.pop();
      if (!items.length) return first;
      let index = 0;
      while (2 * index + 1 < items.length) {
        let child = 2 * index + 1;
        if (child + 1 < items.length && items[child + 1][1] < items[child][1]) child++;
        if (items[child][1] >= last[1]) break;
        items[index] = items[child];
        index = child;
      }
      items[index] = last;
      return first;
    }
  }

  function eachNeighbor(grid, id, visit) {
    const x = id % grid.cols;
    const y = Math.floor(id / grid.cols);
    for (const [dx, dy] of directions) {
      const xx = x + dx;
      const yy = y + dy;
      if (xx < 0 || yy < 0 || xx >= grid.cols || yy >= grid.rows) continue;
      visit(yy * grid.cols + xx, dx && dy ? Math.SQRT2 * grid.cell : grid.cell);
    }
  }

  function prepare(grid) {
    const surface = Float64Array.from(grid.heights);
    const parent = new Int32Array(surface.length).fill(-1);
    const visited = new Uint8Array(surface.length);
    const frontier = new MinHeap();
    // Treat raster edges as open outlets and fill local depressions for routing.
    for (let id = 0; id < surface.length; id++) {
      const x = id % grid.cols;
      const y = Math.floor(id / grid.cols);
      if (x && y && x < grid.cols - 1 && y < grid.rows - 1) continue;
      visited[id] = 1;
      frontier.push(id, surface[id]);
    }
    while (frontier.items.length) {
      const [id, elevation] = frontier.pop();
      eachNeighbor(grid, id, neighbor => {
        if (visited[neighbor]) return;
        visited[neighbor] = 1;
        parent[neighbor] = id;
        surface[neighbor] = Math.max(surface[neighbor], elevation + 0.001);
        frontier.push(neighbor, surface[neighbor]);
      });
    }
    return { surface, parent };
  }

  function nextCell(grid, drainage, id) {
    let best = drainage.parent[id];
    let steepest = 0;
    eachNeighbor(grid, id, (neighbor, meters) => {
      const grade = (drainage.surface[id] - drainage.surface[neighbor]) / meters;
      if (grade <= steepest) return;
      best = neighbor;
      steepest = grade;
    });
    return best;
  }

  function lonLatToCell(grid, lon, lat) {
    const [west, south, east, north] = grid.bounds;
    const x = Math.floor((lon - west) / (east - west) * grid.cols);
    const y = Math.floor((north - lat) / (north - south) * grid.rows);
    return x >= 0 && y >= 0 && x < grid.cols && y < grid.rows ? y * grid.cols + x : -1;
  }

  function cellCenter(grid, id) {
    return { x: id % grid.cols + 0.5, y: Math.floor(id / grid.cols) + 0.5 };
  }

  function route(grid, drainage, source) {
    if (!Number.isInteger(source) || source < 0 || source >= grid.heights.length) {
      throw new RangeError("Source is outside the terrain grid.");
    }
    const path = [];
    let id = source;
    let minute = 0;
    let distance = 0;
    for (;;) {
      const { x, y } = cellCenter(grid, id);
      const edge = x < 1 || y < 1 || x > grid.cols - 1 || y > grid.rows - 1;
      const next = edge ? -1 : nextCell(grid, drainage, id);
      const nextPoint = next < 0 ? { x, y } : cellCenter(grid, next);
      const length = Math.hypot(x - nextPoint.x, y - nextPoint.y) * grid.cell;
      const slope = length > 0 ? Math.max(0, (grid.heights[id] - grid.heights[next]) / length) : 0;
      path.push({ id, x, y, minute, distance, slope });
      if (next < 0) break;
      // Common exercise heuristic in m/s, independent of historical arrival times.
      const speed = Math.min(58, 8 + 67 * Math.sqrt(slope));
      minute += length / speed / 60;
      distance += length;
      id = next;
    }
    return path;
  }

  function envelope(grid, path, maxRise = 16, lateralCells = 4) {
    const arrival = new Float32Array(grid.heights.length).fill(Infinity);
    for (const point of path) {
      arrival[point.id] = Math.min(arrival[point.id], point.minute);
      const waterline = grid.heights[point.id] + maxRise;
      const depth = new Map([[point.id, 0]]);
      const queue = [point.id];
      const radius = point.slope > 0.13 ? Math.min(lateralCells, 2) : lateralCells;
      for (let index = 0; index < queue.length; index++) {
        const id = queue[index];
        const steps = depth.get(id);
        if (steps >= radius) continue;
        eachNeighbor(grid, id, neighbor => {
          if (depth.has(neighbor) || grid.heights[neighbor] > waterline) return;
          depth.set(neighbor, steps + 1);
          queue.push(neighbor);
          arrival[neighbor] = Math.min(arrival[neighbor], point.minute + (steps + 1) * grid.cell / 240);
        });
      }
    }
    return arrival;
  }

  function insidePolygon(x, y, points) {
    let inside = false;
    for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
      const [ax, ay] = points[i];
      const [bx, by] = points[j];
      if ((ay > y) !== (by > y) && x < (bx - ax) * (y - ay) / (by - ay) + ax) {
        inside = !inside;
      }
    }
    return inside;
  }

  function compare(grid, arrival, polygon) {
    let observed = 0;
    let simulated = 0;
    let overlap = 0;
    for (let id = 0; id < arrival.length; id++) {
      const { x, y } = cellCenter(grid, id);
      const mapped = insidePolygon(x, y, polygon);
      const reached = Number.isFinite(arrival[id]);
      observed += Number(mapped);
      simulated += Number(reached);
      overlap += Number(mapped && reached);
    }
    return {
      observed,
      simulated,
      overlap,
      coverage: observed ? overlap / observed : null,
      iou: observed + simulated ? overlap / (observed + simulated - overlap) : null
    };
  }

  function nearest(grid, path, targetId) {
    if (targetId < 0) return null;
    const target = cellCenter(grid, targetId);
    let nearestPoint = path[0];
    let meters = Infinity;
    for (const point of path) {
      const distance = Math.hypot(target.x - point.x, target.y - point.y) * grid.cell;
      if (distance >= meters) continue;
      nearestPoint = point;
      meters = distance;
    }
    return { meters, distance: nearestPoint.distance, minute: nearestPoint.minute };
  }

  const api = { prepare, route, envelope, lonLatToCell, cellCenter, compare, nearest };
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.ValleyModel = api;
})(globalThis);
