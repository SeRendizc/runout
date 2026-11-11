import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";

const { clamp, lerp, smoothstep } = THREE.MathUtils;
const TAU = Math.PI * 2;
const MUD = [0x352821, 0x684d3a, 0x9c7958, 0xd0b99b].map(hex => new THREE.Color(hex));
const WATER = [0x1d4048, 0x456b70, 0x9ab4b2].map(hex => new THREE.Color(hex));

function gridHeight(grid, x, y) {
  const a = clamp(x - 0.5, 0, grid.cols - 1);
  const b = clamp(y - 0.5, 0, grid.rows - 1);
  const i = Math.floor(a);
  const j = Math.floor(b);
  const dx = a - i;
  const dy = b - j;
  const index = j * grid.cols + i;
  const top = grid.heights[index];
  const right = grid.heights[j * grid.cols + Math.min(grid.cols - 1, i + 1)];
  const bottom = grid.heights[Math.min(grid.rows - 1, j + 1) * grid.cols + i];
  const diagonal = grid.heights[Math.min(grid.rows - 1, j + 1) * grid.cols + Math.min(grid.cols - 1, i + 1)];
  return dx + dy <= 1
    ? top + (right - top) * dx + (bottom - top) * dy
    : diagonal + (bottom - diagonal) * (1 - dx) + (right - diagonal) * (1 - dy);
}

function makeFrame(grid) {
  let min = Infinity;
  let max = -Infinity;
  for (const height of grid.heights) {
    min = Math.min(min, height);
    max = Math.max(max, height);
  }
  const height = (x, y) => (gridHeight(grid, x, y) - min) / grid.cell;
  const point = (x, y, lift = 0) => new THREE.Vector3(
    x - grid.cols / 2, height(x, y) + lift, y - grid.rows / 2
  );
  return { min, max, height, point, span: Math.max(grid.rows, grid.cols) };
}

function terrainMesh(grid, frame) {
  const count = grid.cols * grid.rows;
  const vertices = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const faces = [];
  const palette = [
    [0, 0x344c40], [0.17, 0x4a5b46], [0.35, 0x55615b],
    [0.58, 0x686967], [0.75, 0x9b9b91], [0.94, 0xe1e4df], [1, 0xf2f4ee]
  ].map(([elevation, hex]) => [elevation, new THREE.Color(hex)]);
  const tint = new THREE.Color();

  for (let y = 0; y < grid.rows; y++) {
    for (let x = 0; x < grid.cols; x++) {
      const id = y * grid.cols + x;
      const xx = x + 0.5;
      const yy = y + 0.5;
      frame.point(xx, yy).toArray(vertices, id * 3);
      const elevation = (grid.heights[id] - frame.min) / Math.max(1, frame.max - frame.min);
      const dx = (gridHeight(grid, xx + 1, yy) - gridHeight(grid, xx - 1, yy)) / (2 * grid.cell);
      const dy = (gridHeight(grid, xx, yy + 1) - gridHeight(grid, xx, yy - 1)) / (2 * grid.cell);
      const slope = Math.hypot(dx, dy);
      const mottle = 0.023 * Math.sin(x * 0.39 + Math.cos(y * 0.26)) * Math.cos(y * 0.47);
      const grade = clamp(elevation + mottle - smoothstep(slope, 0.45, 1.45) * 0.12, 0, 1);
      const index = palette.findIndex(([limit]) => limit >= grade);
      const [low, from] = palette[Math.max(0, index - 1)];
      const [high, to] = palette[index];
      tint.copy(from).lerp(to, low === high ? 0 : (grade - low) / (high - low));
      tint.multiplyScalar(0.88 + 0.12 * Math.cos(slope) + mottle);
      tint.toArray(colors, id * 3);
      if (x + 1 < grid.cols && y + 1 < grid.rows) {
        faces.push(id, id + grid.cols, id + 1, id + 1, id + grid.cols, id + grid.cols + 1);
      }
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(vertices, 3));
  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.setIndex(faces);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.92 });
  material.onBeforeCompile = shader => {
    shader.vertexShader = "varying vec3 vRock;\n" + shader.vertexShader.replace(
      "#include <begin_vertex>", "#include <begin_vertex>\nvRock = position;"
    );
    shader.fragmentShader = `
      varying vec3 vRock;
      float grainHash(vec2 point) {
        vec3 p3 = fract(vec3(point.xyx) * 0.1031);
        p3 += dot(p3, p3.yzx + 33.33);
        return fract((p3.x + p3.y) * p3.z);
      }
      float groundGrain(vec2 point) {
        vec2 i = floor(point);
        vec2 f = fract(point);
        f = f * f * (3.0 - 2.0 * f);
        return mix(mix(grainHash(i), grainHash(i + vec2(1.0, 0.0)), f.x),
          mix(grainHash(i + vec2(0.0, 1.0)), grainHash(i + vec2(1.0, 1.0)), f.x), f.y);
      }
    ` + shader.fragmentShader.replace("#include <color_fragment>", `#include <color_fragment>
      vec2 rough = vRock.xz + vec2(vRock.y * 0.8, -vRock.y * 0.35);
      float grain = 0.72 * groundGrain(rough * 3.2) + 0.28 * groundGrain(rough * 11.5);
      diffuseColor.rgb *= 0.88 + 0.21 * grain;`);
  };
  return new THREE.Mesh(geometry, material);
}

function terrainSides(grid, frame) {
  const rim = [];
  for (let x = 0; x < grid.cols; x++) rim.push([x + 0.5, 0.5]);
  for (let y = 1; y < grid.rows; y++) rim.push([grid.cols - 0.5, y + 0.5]);
  for (let x = grid.cols - 2; x >= 0; x--) rim.push([x + 0.5, grid.rows - 0.5]);
  for (let y = grid.rows - 2; y > 0; y--) rim.push([0.5, y + 0.5]);
  rim.push(rim[0]);
  const positions = [];
  const indices = [];
  rim.forEach(([x, y], index) => {
    const top = frame.point(x, y);
    positions.push(top.x, top.y, top.z, top.x, -3, top.z);
    const a = index * 2;
    if (index + 1 < rim.length) indices.push(a, a + 2, a + 1, a + 1, a + 2, a + 3);
  });
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({ color: 0x222d31, roughness: 0.93, side: THREE.DoubleSide });
  return new THREE.Mesh(geometry, material);
}

function atmosphere(span) {
  const material = new THREE.ShaderMaterial({
    uniforms: {
      uZenith: { value: new THREE.Color(0x2e4758) },
      uHorizon: { value: new THREE.Color(0xb7c0b7) },
      uBase: { value: new THREE.Color(0x202c31) }
    },
    vertexShader: `
      varying vec3 vDirection;
      void main() {
        vDirection = normalize(position);
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uBase;
      varying vec3 vDirection;
      void main() {
        vec3 direction = normalize(vDirection);
        vec3 upper = mix(uHorizon, uZenith, smoothstep(0.0, 0.65, direction.y));
        vec3 color = mix(uBase, upper, smoothstep(-0.34, 0.035, direction.y));
        gl_FragColor = vec4(color, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
      }`,
    side: THREE.BackSide,
    depthWrite: false
  });
  const dome = new THREE.Mesh(new THREE.SphereGeometry(span * 3, 32, 16), material);
  dome.renderOrder = -100;
  return dome;
}

function smoothPath(path) {
  if (!path?.length) return [];
  if (path.length === 1) return [{ width: 0, depth: 0, ...path[0], dx: 1, dy: 0 }];
  const control = path.map(point => new THREE.Vector3(point.x, 0, point.y));
  const curve = new THREE.CatmullRomCurve3(control, false, "centripetal");
  const samples = [];
  const count = (path.length - 1) * 3;
  for (let index = 0; index <= count; index++) {
    const t = index / count;
    const step = Math.min(Math.floor(index / 3), path.length - 2);
    const weight = index / 3 - step;
    const center = curve.getPoint(t);
    samples.push({
      x: center.x, y: center.z,
      minute: lerp(path[step].minute, path[step + 1].minute, weight),
      distance: lerp(path[step].distance || 0, path[step + 1].distance || 0, weight),
      slope: lerp(path[step].slope || 0, path[step + 1].slope || 0, weight),
      width: lerp(path[step].width ?? 0, path[step + 1].width ?? 0, weight),
      depth: lerp(path[step].depth ?? 0, path[step + 1].depth ?? 0, weight)
    });
  }
  samples.forEach((point, index) => {
    const previous = samples[Math.max(0, index - 4)];
    const next = samples[Math.min(count, index + 4)];
    const span = Math.hypot(next.x - previous.x, next.y - previous.y) || 1;
    point.dx = (next.x - previous.x) / span;
    point.dy = (next.y - previous.y) / span;
  });
  return samples;
}

function pathPoint(points, value, key = "minute") {
  if (!points.length) return null;
  let lo = 0;
  let hi = points.length - 1;
  if (value <= points[lo][key]) return points[lo];
  if (value >= points[hi][key]) return points[hi];
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (points[mid][key] <= value) lo = mid;
    else hi = mid;
  }
  const a = points[lo];
  const b = points[hi];
  const weight = (value - a[key]) / Math.max(1e-6, b[key] - a[key]);
  return {
    x: lerp(a.x, b.x, weight), y: lerp(a.y, b.y, weight),
    dx: lerp(a.dx, b.dx, weight), dy: lerp(a.dy, b.dy, weight),
    minute: lerp(a.minute, b.minute, weight), distance: lerp(a.distance, b.distance, weight),
    slope: lerp(a.slope, b.slope, weight), width: lerp(a.width, b.width, weight),
    depth: lerp(a.depth, b.depth, weight)
  };
}

function flightPose(wave, minute, frame) {
  const front = pathPoint(wave.samples, minute - wave.start);
  const end = wave.samples.at(-1).distance;
  const at = (distance) => pathPoint(wave.samples, distance, "distance");
  const center = (distance) => {
    const sum = new THREE.Vector3();
    let total = 0;
    for (const [delta, weight] of [[-1300, 1], [-630, 2], [0, 4], [630, 2], [1300, 1]]) {
      const point = at(distance + delta);
      sum.addScaledVector(frame.point(point.x, point.y), weight);
      total += weight;
    }
    return sum.multiplyScalar(1 / total);
  };
  const before = center(front.distance - 3300);
  const after = center(front.distance + 3300);
  const lane = after.clone().sub(before).setY(0);
  if (lane.lengthSq() < 1e-6) lane.set(front.dx || 0.01, 0, front.dy || 0);
  lane.normalize();
  const length = frame.grid.cell;
  const target = center(front.distance + 280);
  target.y += 1.8;
  const beside = new THREE.Vector3(-lane.z, 0, lane.x);
  const laneHeight = 3200 / length;
  const back = Math.min(end * 0.3, 2200) / length;
  const position = target.clone().addScaledVector(lane, -back).addScaledVector(beside, 880 / length);
  const ground = frame.height(position.x + frame.grid.cols / 2, position.z + frame.grid.rows / 2);
  position.y = Math.max(target.y + laneHeight, ground + 1450 / length);
  return { target, position, fov: 49 };
}

function ribbon(samples, frame, muddy, wave, world) {
  if (samples.length < 2) return null;
  const across = muddy ? 13 : 7;
  const sections = samples.length + (muddy ? 1 : 0);
  const geometry = new THREE.BufferGeometry();
  const vertices = new THREE.BufferAttribute(new Float32Array(sections * across * 3), 3);
  const colors = new THREE.BufferAttribute(new Float32Array(sections * across * 3), 3);
  const normals = new THREE.BufferAttribute(new Float32Array(sections * across * 3), 3);
  vertices.setUsage(THREE.DynamicDrawUsage);
  normals.setUsage(THREE.DynamicDrawUsage);
  colors.setUsage(THREE.DynamicDrawUsage);
  const faces = [];
  for (let k = 0; k < sections - 1; k++) {
    for (let j = 0; j < across - 1; j++) {
      const a = k * across + j;
      const b = a + across;
      faces.push(a, a + 1, b, a + 1, b + 1, b);
    }
  }
  geometry.setAttribute("position", vertices);
  geometry.setAttribute("color", colors);
  geometry.setAttribute("normal", normals);
  geometry.setIndex(faces);
  const material = new THREE.MeshStandardMaterial({
    vertexColors: true, side: THREE.FrontSide, metalness: muddy ? 0 : 0.19,
    roughness: muddy ? 0.67 : 0.38, polygonOffset: true, polygonOffsetFactor: -1
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.frustumCulled = false;
  mesh.renderOrder = muddy ? 3 : 1;

  const offset = wave?.start ?? 0;
  const reachScale = clamp(0.70 + (wave?.width ?? frame.grid.cell) / frame.grid.cell * 0.08, 0.76, 1.30);
  const interactions = world?.interactions ?? [];
  const covered = (x, y) => {
    if (!world?.arrival) return true;
    const column = Math.floor(x);
    const row = Math.floor(y);
    return column >= 0 && column < frame.grid.cols && row >= 0 && row < frame.grid.rows
      && Number.isFinite(world.arrival[row * frame.grid.cols + column]);
  };
  const tint = new THREE.Color();
  const normal = new THREE.Vector3();
  const direction = new THREE.Vector3();
  const lateral = new THREE.Vector3();
  const update = minute => {
    const elapsed = minute - offset;
    mesh.visible = !muddy || elapsed >= samples[0].minute;
    if (!mesh.visible) return;
    let rows = 0;
    for (let k = 0; k < samples.length; k++) {
      let point = samples[k];
      let leading = false;
      if (muddy && point.minute > elapsed) {
        if (!k) break;
        point = pathPoint(samples, elapsed);
        leading = true;
      }
      const age = Math.max(0, elapsed - point.minute);
      const nose = muddy ? Math.exp(-age * 4.4) : 0;
      const body = muddy ? Math.exp(-age * 0.52) : 1;
      const steep = smoothstep(point.slope, 0.09, 0.36);
      const fan = wave?.profile === "andes" ? smoothstep(point.distance, 7600, 9100) : 0;
      let disturbance = 0;
      for (const event of interactions) {
        if (minute < event.minute) continue;
        const radius = Math.hypot(point.x - event.x, point.y - event.y);
        const local = (1 - smoothstep(radius, 0.8, 12)) * Math.exp(-(minute - event.minute) * 0.43);
        const effect = event.kind === "reinforcement" ? 0.8 : 0.52;
        disturbance = Math.max(disturbance, local * effect * clamp(event.strength ?? 1, 0.5, 1.4));
      }
      const modelWidth = point.width > 0 ? clamp(point.width * 0.60, 0.52, 1.85) : 0.71 * reachScale;
      const bodyLift = point.depth > 0 ? clamp((point.depth / frame.grid.cell) * 3.4, 0.30, 1.10) : 0.39;
      const halfWidth = muddy
        ? (modelWidth * (0.42 + body * 0.58) + nose * 0.28 + 0.34 * fan + 0.40 * disturbance) * (1 - steep * 0.36)
        : 0.24 * (1 - steep * 0.4);
      const bed = frame.height(point.x, point.y);
      const bankLimit = 0.17 + bodyLift * (body * 0.43 + nose * 0.54);
      const sideWidth = (side) => {
        let validWidth = halfWidth / 8;
        for (let j = 1; j <= 8; j++) {
          const width = halfWidth * j / 8;
          const x = point.x - point.dy * side * width;
          const y = point.y + point.dx * side * width;
          if (frame.height(x, y) - bed > bankLimit || muddy && !covered(x, y)) break;
          validWidth = width;
        }
        return validWidth;
      };
      const leftBank = sideWidth(-1);
      const rightBank = sideWidth(1);
      for (let j = 0; j < across; j++) {
        const u = (j / (across - 1)) * 2 - 1;
        const lateralWidth = u * (u < 0 ? leftBank : rightBank);
        const bow = leading ? -0.32 * u * u + 0.065 * Math.sin(u * 19 + elapsed * 11) : 0;
        const x = point.x - point.dy * lateralWidth + point.dx * bow;
        const y = point.y + point.dx * lateralWidth + point.dy * bow;
        const ground = frame.height(x, y);
        const roll = Math.sin(k * 1.94 - elapsed * 30 + u * 5.8 + Math.cos(k * 0.31) * 1.6);
        const ripple = Math.sin(k * 0.81 - elapsed * 18 + Math.sin(u * 6));
        const boil = Math.sin(k * 5.17 + u * 21 + Math.sin(elapsed * 18)) * Math.cos(u * 9 - elapsed * 12);
        const dome = Math.pow(Math.max(0, 1 - u * u), 0.63);
        const depth = muddy
          ? 0.039 + dome * bodyLift * (0.27 * body + nose * (0.74 + 0.23 * roll) + 0.16 * body * ripple + 0.13 * body * boil + disturbance * 0.36)
          : 0.039 + 0.034 * dome + 0.009 * roll;
        const surface = Math.max(ground + 0.025, bed + depth + (wave?.index ?? 0) * 0.007);
        const vertex = rows * across + j;
        vertices.setXYZ(vertex, x - frame.grid.cols / 2, surface, y - frame.grid.rows / 2);
        const grit = 0.5 + 0.5 * Math.sin(k * 5.27 + j * 4.97);
        const foam = smoothstep(roll * 0.68 + ripple * 0.32, 0.52, 0.96);
        if (muddy) {
          tint.copy(MUD[0]).lerp(MUD[1], 0.44 + 0.4 * body);
          tint.lerp(MUD[2], body * (0.12 + 0.24 * grit) + nose * 0.32);
          tint.lerp(MUD[3], (nose + 0.25 * disturbance) * foam * (0.38 + 0.25 * Math.abs(u)));
          tint.multiplyScalar(0.95 + body * 0.10 * boil);
        } else {
          tint.copy(WATER[0]).lerp(WATER[1], 0.29 + 0.55 * dome + 0.1 * ripple);
          tint.lerp(WATER[2], foam * (0.14 + 0.13 * Math.abs(u)));
        }
        colors.setXYZ(vertex, tint.r, tint.g, tint.b);
      }
      rows++;
      if (leading) break;
    }
    geometry.setDrawRange(0, Math.max(0, rows - 1) * (across - 1) * 6);
    vertices.needsUpdate = true;
    colors.needsUpdate = true;
    for (let row = 0; row < rows; row++) {
      for (let j = 0; j < across; j++) {
        const back = Math.max(0, row - 1) * across + j;
        const ahead = Math.min(rows - 1, row + 1) * across + j;
        const left = row * across + Math.max(0, j - 1);
        const right = row * across + Math.min(across - 1, j + 1);
        direction.set(vertices.getX(ahead) - vertices.getX(back), vertices.getY(ahead) - vertices.getY(back),
          vertices.getZ(ahead) - vertices.getZ(back));
        lateral.set(vertices.getX(right) - vertices.getX(left), vertices.getY(right) - vertices.getY(left),
          vertices.getZ(right) - vertices.getZ(left));
        normal.crossVectors(lateral, direction).normalize();
        if (normal.y < 0) normal.negate();
        if (normal.lengthSq() < 0.1) normal.set(0, 1, 0);
        normals.setXYZ(row * across + j, normal.x, normal.y, normal.z);
      }
    }
    normals.needsUpdate = true;
  };
  return { mesh, update };
}

function movingDebris(wave, frame) {
  if (wave.samples.length < 2) return null;
  const count = 24;
  const material = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.81 });
  const mesh = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1, 0), material, count);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.renderOrder = 4;
  const piece = new THREE.Object3D();
  const tint = new THREE.Color();
  for (let i = 0; i < count; i++) {
    tint.setHex(i % 5 ? 0x59483b : 0xbaa98c);
    mesh.setColorAt(i, tint);
  }
  function update(minute) {
    const elapsed = minute - wave.start;
    const end = wave.samples.at(-1).minute;
    mesh.visible = elapsed > 0.02 && elapsed < end + 0.81;
    if (!mesh.visible) return;
    for (let i = 0; i < count; i++) {
      const lag = i * 0.040 + Math.sin(i * 2.47) * 0.016;
      const age = elapsed - lag;
      if (age < 0 || age > end) {
        piece.scale.setScalar(0.00001);
        piece.position.y = -1000;
        piece.updateMatrix();
        mesh.setMatrixAt(i, piece.matrix);
        continue;
      }
      const point = pathPoint(wave.samples, age);
      const spread = 0.19 + clamp(point.width * 0.23, 0, 0.37);
      const offset = Math.sin(i * 2.41 + elapsed * 6) * spread;
      const x = point.x - point.dy * offset;
      const y = point.y + point.dx * offset;
      const rise = clamp(point.depth * 3.4 / frame.grid.cell, 0.29, 0.83);
      const hop = (0.08 + 0.09 * Math.abs(Math.sin(i * 1.77 + elapsed * 19))) * Math.exp(-lag * 1.6);
      const base = frame.height(point.x, point.y) + rise * (0.28 + Math.exp(-lag * 4.3) * 0.54);
      piece.position.copy(frame.point(x, y));
      piece.position.y = Math.max(piece.position.y + 0.02, base) + hop;
      const size = 0.031 + 0.047 * (1 + Math.sin(i * 2.17)) / 2;
      piece.scale.set(size * 1.24, size, size * 1.08);
      piece.rotation.set(i * 1.4 + elapsed * 9, i * 0.61 + elapsed * 5, i * 0.57 + elapsed * 8);
      piece.updateMatrix();
      mesh.setMatrixAt(i, piece.matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
  }
  return { mesh, update };
}

function impactHaze(port, frame) {
  const group = new THREE.Group();
  const particles = [];
  for (let index = 0; index < 20; index++) {
    const material = new THREE.SpriteMaterial({
      color: index % 4 === 0 ? 0x9c9c92 : 0x837968,
      transparent: true, depthWrite: false, opacity: 0
    });
    material.onBeforeCompile = shader => {
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <alphatest_fragment>", `
        #include <alphatest_fragment>
        float radius = length(vUv - vec2(0.5)) * 2.0;
        float edge = 1.0 - smoothstep(0.25, 0.98, radius);
        diffuseColor.a *= edge * edge;`
      );
    };
    material.defines = { USE_UV: "" };
    const cloud = new THREE.Sprite(material);
    cloud.renderOrder = 6;
    group.add(cloud);
    particles.push(cloud);
  }
  const update = minute => {
    const age = minute - port.arrival;
    group.visible = age >= 0 && age < 1.5;
    if (!group.visible) return;
    particles.forEach((cloud, index) => {
      const spread = clamp(age - index * 0.024, 0, 1);
      const angle = index * 2.39996;
      const x = port.x + Math.cos(angle) * spread * 1.9;
      const y = port.y + Math.sin(angle) * spread * 1.25 + age * 0.55;
      cloud.position.copy(frame.point(x, y, 0.3 + spread * (0.65 + (index % 4) * 0.17)));
      cloud.scale.setScalar(0.38 + spread * 1.28);
      cloud.material.opacity = 0.26 * smoothstep(spread, 0.02, 0.25) * (1 - smoothstep(age, 0.6, 1.5));
    });
  };
  update(0);
  return { group, update };
}

function wetGround(grid, frame, world) {
  const { arrival, clearance } = world;
  if (!arrival) return null;
  const vertices = [];
  const normalData = [];
  const times = [];
  const clearTimes = [];
  const edges = [];
  const intensities = [];
  const interactionTimes = [];
  const normal = new THREE.Vector3();
  for (let id = 0; id < arrival.length; id++) {
    if (!Number.isFinite(arrival[id])) continue;
    const x = id % grid.cols + 0.5;
    const y = Math.floor(id / grid.cols) + 0.5;
    let spread = 0;
    let interactionAt = 1e6;
    for (const event of world.interactions ?? []) {
      const candidate = 1 - smoothstep(Math.hypot(x - event.x, y - event.y), 1.2, 12);
      if (candidate <= spread) continue;
      spread = candidate;
      interactionAt = event.minute;
    }
    const points = [[0, 0], [-0.5, -0.5], [-0.5, 0.5], [0.5, 0.5], [0.5, -0.5]];
    for (const index of [0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1]) {
      const [dx, dy] = points[index];
      const xx = clamp(x + dx, 0.5, grid.cols - 0.5);
      const yy = clamp(y + dy, 0.5, grid.rows - 0.5);
      const p = frame.point(xx, yy, 0.031);
      vertices.push(p.x, p.y, p.z);
      const sx = (frame.height(xx + 0.5, yy) - frame.height(xx - 0.5, yy));
      const sy = (frame.height(xx, yy + 0.5) - frame.height(xx, yy - 0.5));
      normal.set(-sx, 1, -sy).normalize();
      normalData.push(normal.x, normal.y, normal.z);
      times.push(arrival[id]);
      clearTimes.push(Number.isFinite(clearance?.[id]) ? clearance[id] : arrival[id] + 2.4);
      intensities.push(spread);
      interactionTimes.push(interactionAt);
      const ix = Math.sign(dx);
      const iy = Math.sign(dy);
      const inDomain = xx > 0.5 && xx < grid.cols - 0.5 && yy > 0.5 && yy < grid.rows - 0.5;
      edges.push(!index || inDomain && [id + ix, id + iy * grid.cols, id + iy * grid.cols + ix]
        .some(neighbor => Number.isFinite(arrival[neighbor])) ? 1 : 0);
    }
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(vertices, 3));
  geometry.setAttribute("normal", new THREE.Float32BufferAttribute(normalData, 3));
  geometry.setAttribute("arrivalMinute", new THREE.Float32BufferAttribute(times, 1));
  geometry.setAttribute("clearMinute", new THREE.Float32BufferAttribute(clearTimes, 1));
  geometry.setAttribute("edgeMix", new THREE.Float32BufferAttribute(edges, 1));
  geometry.setAttribute("reachPower", new THREE.Float32BufferAttribute(intensities, 1));
  geometry.setAttribute("interactionMinute", new THREE.Float32BufferAttribute(interactionTimes, 1));
  const time = { value: 0 };
  const material = new THREE.MeshStandardMaterial({
    color: 0x694936, transparent: true, opacity: 0.87, roughness: 0.82,
    polygonOffset: true, polygonOffsetFactor: -2, depthWrite: false
  });
  material.onBeforeCompile = shader => {
    shader.uniforms.uMinute = time;
    shader.vertexShader = `
      uniform float uMinute;
      attribute float arrivalMinute;
      attribute float clearMinute;
      attribute float edgeMix;
      attribute float reachPower;
      attribute float interactionMinute;
      varying float vArrival;
      varying float vEdge;
      varying float vSurface;
      varying vec2 vChannel;
    ` + shader.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
      vArrival = arrivalMinute;
      vEdge = edgeMix;
      vChannel = position.xz;
      float age = uMinute - arrivalMinute;
      float fill = smoothstep(0.0, 0.18, age) * (1.0 - smoothstep(clearMinute - 0.9, clearMinute + 0.9, uMinute));
      float textureWave = sin(position.x * 4.7 + position.z * 3.5 - uMinute * 17.0);
      vSurface = fill * (0.64 + reachPower * 0.36 * smoothstep(interactionMinute, interactionMinute + 0.3, uMinute));
      transformed.y += edgeMix * vSurface * (0.098 + 0.028 * textureWave);
    `);
    shader.fragmentShader = `
      uniform float uMinute;
      varying float vArrival;
      varying float vEdge;
      varying float vSurface;
      varying vec2 vChannel;
    ` + shader.fragmentShader.replace("#include <alphatest_fragment>", `
      #include <alphatest_fragment>
      float age = uMinute - vArrival;
      if (age < 0.0) discard;
      float crest = exp(-abs(age - 0.16) * 4.0);
      float grit = sin(vChannel.x * 12.3 + vChannel.y * 5.2 - uMinute * 19.2)
        * sin(vChannel.y * 14.7 + vChannel.x * 9.1 - uMinute * 10.7);
      diffuseColor.rgb *= (0.73 + vSurface * 0.46 + 0.13 * crest * grit);
      diffuseColor.a *= smoothstep(0.0, 0.20, age) * smoothstep(0.07, 0.84, vEdge)
        * (0.34 + 0.66 * vSurface);
    `);
  };
  const mesh = new THREE.Mesh(geometry, material);
  mesh.renderOrder = 2;
  return { mesh, time };
}

function observedLine(points, frame) {
  if (!points || points.length < 3) return null;
  const line = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
    points.map(point => frame.point(point.x, point.y, 0.11))
  ), new THREE.LineDashedMaterial({
    color: 0x91b8c4, transparent: true, opacity: 0.76, dashSize: 0.35, gapSize: 0.17
  }));
  line.computeLineDistances();
  line.visible = false;
  return line;
}

function walkerModel() {
  const group = new THREE.Group();
  const jacket = new THREE.MeshBasicMaterial({ color: 0xf8d795, fog: false });
  const trousers = new THREE.MeshBasicMaterial({ color: 0xeaf1e8, fog: false });
  const face = new THREE.MeshBasicMaterial({ color: 0xf0c89a, fog: false });
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.102, 0.20, 3, 8), jacket);
  torso.position.y = 0.66;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.091, 9, 7), face);
  head.position.y = 0.91;
  const limbs = [];
  for (const side of [-1, 1]) {
    const leg = new THREE.Group();
    leg.position.set(side * 0.072, 0.48, 0);
    const calf = new THREE.Mesh(new THREE.CapsuleGeometry(0.037, 0.30, 2, 5), trousers);
    calf.position.y = -0.18;
    leg.add(calf);
    const arm = new THREE.Group();
    arm.position.set(side * 0.14, 0.75, 0);
    arm.rotation.z = side * 0.13;
    const sleeve = new THREE.Mesh(new THREE.CapsuleGeometry(0.035, 0.21, 2, 5), jacket);
    sleeve.position.y = -0.13;
    arm.add(sleeve);
    group.add(leg, arm);
    limbs.push({ leg, arm, side });
  }
  group.add(torso, head);
  return { group, limbs };
}

function animateWalker(walker, route, fraction, minute, status, scale) {
  const p = route.getPointAt(fraction);
  const a = route.getPointAt(clamp(fraction - 0.016, 0, 1));
  const b = route.getPointAt(clamp(fraction + 0.016, 0, 1));
  const moving = status === "enroute";
  const phase = moving ? Math.sin(minute * 32) : 0;
  walker.group.visible = moving || fraction > 0 || status === "evacuated";
  walker.group.position.copy(p);
  walker.group.position.y += 0.07 + Math.abs(phase) * 0.035;
  walker.group.rotation.y = Math.atan2(b.x - a.x, b.z - a.z);
  walker.group.scale.setScalar(scale);
  for (const { leg, arm, side } of walker.limbs) {
    leg.rotation.x = phase * side * 0.58;
    arm.rotation.x = -phase * side * 0.46;
  }
}

function makeRoute(points, frame) {
  if (!points || points.length < 2) return null;
  const curve = new THREE.CatmullRomCurve3(points.map(point => frame.point(point.x, point.y, 0.19)), false, "centripetal");
  const track = [];
  const count = Math.max(12, Math.min(160, points.length * 6));
  for (let i = 0; i <= count; i++) {
    const position = curve.getPointAt(i / count);
    position.y = frame.height(position.x + frame.grid.cols / 2, position.z + frame.grid.rows / 2) + 0.16;
    track.push(position);
  }
  const route = new THREE.CatmullRomCurve3(track, false, "centripetal");
  const geometry = new THREE.TubeGeometry(route, count, 0.052, 5, false);
  const progressGeometry = geometry.clone();
  const base = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: 0xb7c1ad, transparent: true, opacity: 0.68 }));
  const progress = new THREE.Mesh(progressGeometry, new THREE.MeshBasicMaterial({ color: 0xbcf4c0 }));
  const walker = walkerModel();
  const destination = new THREE.Mesh(new THREE.RingGeometry(0.23, 0.31, 24), new THREE.MeshBasicMaterial({
    color: 0xbce5be, transparent: true, opacity: 0.85, side: THREE.DoubleSide, depthWrite: false
  }));
  destination.rotation.x = -Math.PI / 2;
  destination.position.copy(track[track.length - 1]);
  const group = new THREE.Group();
  group.add(base, progress, walker.group, destination);
  group.visible = false;
  return { group, route, progress, walker };
}

function siteModel(site, frame) {
  const group = new THREE.Group();
  const location = frame.point(site.x, site.y);
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.68, 0.74, 36),
    new THREE.MeshBasicMaterial({ color: 0xe3e8df, transparent: true, opacity: 0.73, side: THREE.DoubleSide, depthWrite: false }));
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.27;
  const pin = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 8), new THREE.MeshBasicMaterial({ color: 0xebf0ea }));
  pin.position.y = 0.48;
  const pulse = new THREE.Mesh(new THREE.RingGeometry(0.76, 0.88, 42),
    new THREE.MeshBasicMaterial({ color: 0xeda876, transparent: true, side: THREE.DoubleSide, depthWrite: false }));
  pulse.rotation.x = -Math.PI / 2;
  pulse.position.y = 0.28;
  pulse.visible = false;
  group.position.copy(location);
  group.add(pin, ring, pulse);
  const route = makeRoute(site.route, frame);
  const backup = makeRoute(site.backup, frame);
  return { site, group, ring, pin, pulse, route, backup };
}

function settlement(sites, frame, world) {
  const objects = [];
  const building = new THREE.BoxGeometry(1, 1, 1);
  const roof = new THREE.CylinderGeometry(0, 0.72, 0.46, 4, 1);
  const buildings = new THREE.InstancedMesh(building, new THREE.MeshStandardMaterial({
    color: 0xb3aa92, roughness: 0.88
  }), sites.length * 20);
  const roofs = new THREE.InstancedMesh(roof, new THREE.MeshStandardMaterial({
    color: 0x524d41, roughness: 0.87
  }), sites.length * 20);
  const marker = new THREE.Object3D();
  for (const [index, site] of sites.entries()) {
    for (let i = 0; i < 20; i++) {
      const angle = i * 2.399963 + index * 0.47;
      const radius = 0.32 + Math.sqrt(i) * 0.32;
      const x = site.x + Math.cos(angle) * radius;
      const y = site.y + Math.sin(angle) * radius;
      if (x < 0.6 || y < 0.6 || x >= frame.grid.cols - 0.6 || y >= frame.grid.rows - 0.6) continue;
      if (Math.abs(frame.height(x + 0.15, y) - frame.height(x - 0.15, y)) > 0.16
        || Math.abs(frame.height(x, y + 0.15) - frame.height(x, y - 0.15)) > 0.16) continue;
      const id = Math.floor(y) * frame.grid.cols + Math.floor(x);
      const arrival = world.arrival?.[id];
      objects.push({
        x, y, angle, size: 0.08 + 0.05 * Math.sin(i * 1.54) ** 2,
        arrival: i % 4 === 3 ? Infinity : arrival,
        fall: Math.sin(angle + i * 0.31)
      });
    }
  }
  const update = (minute) => {
    objects.forEach(({ x, y, angle, size, arrival, fall }, index) => {
      const washed = Number.isFinite(arrival) ? smoothstep(minute - arrival, 0.09, 0.68) : 0;
      marker.position.copy(frame.point(x + fall * 0.30 * washed, y + 0.22 * washed, size * (0.68 - 0.42 * washed)));
      marker.rotation.set(0.58 * washed, angle * 0.2 + fall * washed, -0.69 * washed * fall);
      marker.scale.set(size * 1.7, size * (1.36 - 0.80 * washed), size * 1.38);
      marker.updateMatrix();
      buildings.setMatrixAt(index, marker.matrix);
      marker.position.y += size * (0.81 - 0.58 * washed);
      marker.position.z += washed * (0.29 + 0.13 * fall);
      marker.rotation.y += Math.PI / 4 + 0.60 * washed;
      marker.rotation.x += 0.50 * washed;
      marker.scale.set(size * 1.4, size * 0.93, size * 1.4);
      marker.updateMatrix();
      roofs.setMatrixAt(index, marker.matrix);
    });
    buildings.instanceMatrix.needsUpdate = true;
    roofs.instanceMatrix.needsUpdate = true;
  };
  buildings.count = objects.length;
  roofs.count = objects.length;
  buildings.frustumCulled = false;
  roofs.frustumCulled = false;
  const group = new THREE.Group();
  group.add(buildings, roofs);
  update(0);
  return { group, update };
}

function bridgeModel(bridge, frame) {
  const group = new THREE.Group();
  const length = bridge.length ?? 2;
  const material = new THREE.MeshStandardMaterial({ color: 0xb0a38b, roughness: 0.77 });
  const sectionLength = length / 4;
  const deck = new THREE.BoxGeometry(sectionLength - 0.009, 0.11, 0.27);
  const rail = new THREE.BoxGeometry(sectionLength - 0.009, 0.048, 0.041);
  const segments = [];
  for (let index = 0; index < 4; index++) {
    const section = new THREE.Group();
    section.add(new THREE.Mesh(deck, material));
    for (const z of [-0.12, 0.12]) {
      const parapet = new THREE.Mesh(rail, material);
      parapet.position.set(0, 0.14, z);
      section.add(parapet);
    }
    section.position.x = (index - 1.5) * sectionLength;
    segments.push(section);
    group.add(section);
  }
  group.position.copy(frame.point(bridge.x, bridge.y, 0.23));
  group.rotation.y = -(bridge.heading || 0);
  const update = (minute) => {
    const age = Number.isFinite(bridge.closedAt) ? minute - bridge.closedAt : -Infinity;
    material.color.setHex(age >= 0 ? 0x906752 : 0xb0a38b);
    segments.forEach((section, index) => {
      const breakage = smoothstep(age - index * 0.075, 0, 0.7);
      const outer = index === 0 || index === 3;
      section.position.y = breakage * (outer ? -0.07 : -0.31);
      section.position.z = breakage * (outer ? 0.12 : 0.72 + index * 0.24);
      section.rotation.z = breakage * (index < 2 ? -0.33 : 0.48);
      section.rotation.y = breakage * (outer ? -0.20 : 0.83 + 0.21 * index);
    });
  };
  return { group, update };
}

function updateSite(object, status, minute, highlight, dispatch) {
  const { group, pin, ring, pulse: impact, route: standard, backup } = object;
  const route = status?.routeChanged && backup ? backup : standard;
  if (standard && route !== standard) standard.group.visible = false;
  if (backup && route !== backup) backup.group.visible = false;
  const { passed, notified, evacuated, progress = 0 } = status ?? {};
  const color = evacuated ? 0xbcebc4 : passed ? 0xf0a77d : notified ? 0x8ee1ea : 0xe3e8df;
  const changeTime = evacuated ? status.evacuatedAt : passed ? status.passedAt : status?.notifiedAt;
  const age = Number.isFinite(changeTime) ? minute - changeTime : Infinity;
  const pulse = age >= 0 && age < 0.75 ? 1 - age / 0.75 : 0;
  pin.material.color.setHex(color);
  ring.material.color.setHex(color);
  ring.material.opacity = pulse ? 0.5 + 0.36 * pulse : highlight ? 0.86 : 0.64;
  const markerScale = dispatch ? 1.9 : 1;
  pin.scale.setScalar(markerScale);
  ring.scale.setScalar(markerScale * (1 + pulse * 2.3));
  const sinceImpact = Number.isFinite(status?.passedAt) ? minute - status.passedAt : Infinity;
  impact.visible = sinceImpact >= 0 && sinceImpact <= 1.25;
  if (impact.visible) {
    impact.material.opacity = 0.82 * (1 - sinceImpact / 1.25);
    impact.scale.setScalar(markerScale * (1.3 + sinceImpact * 3.7));
  }
  group.visible = true;
  if (!route) return;
  route.group.visible = Boolean(notified || progress > 0 || evacuated);
  if (!route.group.visible) return;
  const fraction = evacuated ? 1 : clamp(progress, 0, 1);
  const count = route.progress.geometry.index.count;
  route.progress.geometry.setDrawRange(0, Math.floor(count * fraction / 30) * 30);
  animateWalker(route.walker, route.route, fraction, minute, status?.status, highlight ? 0.87 : 0.69);
}

function disposeGroup(group) {
  const geometries = new Set();
  const materials = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    if (object.material) materials.add(object.material);
  });
  geometries.forEach(geometry => geometry.dispose());
  materials.forEach(material => material.dispose());
}

function commonPoint(waves) {
  if (waves.length < 2) return null;
  const trail = new Set(waves[0].path.map(point => point.id));
  return waves[1].path.find(point => trail.has(point.id)) ?? null;
}

function dispatchPose(camera, world, frame) {
  const subjects = world.sites.map(site => frame.point(site.x, site.y, 1.1));
  const bounds = new THREE.Box3().setFromPoints(subjects);
  const center = bounds.getCenter(new THREE.Vector3());
  const spread = bounds.getSize(new THREE.Vector3());
  const halfWidth = spread.x / 2 + 6;
  const halfHeight = spread.z / 2 + 7;
  const tangent = Math.tan(THREE.MathUtils.degToRad(23));
  const distance = Math.max(19, halfWidth / (tangent * camera.aspect), halfHeight / tangent) + spread.y;
  const position = center.clone().add(new THREE.Vector3(0, distance, Math.max(0.4, distance * 0.092)));
  return { target: center, position, fov: 46 };
}

function pose(camera, state, world, frame) {
  const minute = state.minute;
  const waves = world.renderWaves;
  const primary = waves.find(wave => wave.index === state.waveIndex) ?? waves[0];
  const points = primary?.samples ?? [];
  const start = primary?.start ?? 0;
  const source = points[0];
  if (state.camera === "dispatch" && world.sites.length) return dispatchPose(camera, world, frame);
  const center = new THREE.Vector3(0, (frame.max - frame.min) / frame.grid.cell * 0.29, 0);
  if (state.camera === "overview" || !source) {
    const tall = smoothstep(camera.aspect, 0.63, 1.47);
    const axis = new THREE.Vector3(lerp(-0.18, -0.33, tall), lerp(1.12, 0.70, tall), lerp(0.44, 0.72, tall)).normalize();
    const right = new THREE.Vector3(0, 1, 0).cross(axis).normalize();
    const up = axis.clone().cross(right).normalize();
    const tangent = Math.tan(THREE.MathUtils.degToRad(22));
    const { grid } = frame;
    let distance = 0;
    for (const x of [-grid.cols / 2, grid.cols / 2]) {
      for (const y of [-3, (frame.max - frame.min) / grid.cell]) {
        for (const z of [-grid.rows / 2, grid.rows / 2]) {
          const corner = new THREE.Vector3(x, y, z).sub(center);
          distance = Math.max(distance, corner.dot(axis) + Math.max(
            Math.abs(corner.dot(right)) / (tangent * camera.aspect),
            Math.abs(corner.dot(up)) / tangent
          ) * 1.09);
        }
      }
    }
    return { target: center, position: center.clone().addScaledVector(axis, distance), fov: 44 };
  }

  let focus = state.focus;
  let heading;
  const place = (target, dx, dz, range, lift, side, fov) => {
    const position = target.clone().add(new THREE.Vector3(dx * range - dz * side, lift, dz * range + dx * side));
    const ground = frame.height(position.x + frame.grid.cols / 2, position.z + frame.grid.rows / 2);
    position.y = Math.max(position.y, ground + 8);
    return { target, position, fov };
  };

  if (state.camera === "helicopter") {
    const flight = waves.find(wave => wave.index === state.waveIndex)
      ?? waves.find(wave => wave.kind !== "return") ?? primary;
    return flightPose(flight, minute, frame);
  }

  if (state.camera === "source") {
    focus ??= source;
    heading = points[Math.min(15, points.length - 1)];
    return place(frame.point(focus.x, focus.y, 0.8), heading.dx, heading.dy, 10, 7.5, 7.5, 45);
  }

  if (state.camera === "confluence") {
    focus ??= world.confluence ?? points[Math.floor(points.length * 0.49)];
    return place(frame.point(focus.x, focus.y, 0.45), 0.58, 0.81, 13.4, 15.5, 9.6, 43);
  }

  const site = state.probe && state.camera === "evacuation"
    ? state.probe : world.sites.find(candidate => candidate.id === state.activeSiteId) ?? world.sites[0];
  focus ??= site ?? pathPoint(points, minute - start) ?? source;
  const target = frame.point(focus.x, focus.y, 0.45);
  const route = state.events?.[site?.id]?.routeChanged && site?.backup ? site.backup : site?.route;
  if (state.camera === "evacuation" && route?.length > 1) {
    const endpoint = route.at(-1);
    target.lerp(frame.point(endpoint.x, endpoint.y, 0.55), 0.41);
    return place(target, 0.64, 0.76, 7.5, 11.5, -7, 46);
  }
  return place(target, 0.82, 0.57, 8.7, 8.5, -7.5, 43);
}

function create(container, { onSelect, onCameraChange } = {}) {
  const renderer = new THREE.WebGLRenderer({
    antialias: true, alpha: false, powerPreference: "high-performance"
  });
  renderer.setClearColor(0x202d32);
  renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, 1.55));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.06;
  const canvas = renderer.domElement;
  canvas.className = "runout-canvas";
  canvas.style.cssText = "display:block;width:100%;height:100%;touch-action:none";
  canvas.setAttribute("aria-label", "Interactive 3D view of the valley and simulated debris flow");
  canvas.tabIndex = 0;
  container.append(canvas);

  const scene = new THREE.Scene();
  const light = new THREE.HemisphereLight(0xd8ebef, 0x807264, 1.43);
  const sun = new THREE.DirectionalLight(0xffe5c7, 2.45);
  sun.position.set(-70, 100, -48);
  scene.add(light, sun);
  const camera = new THREE.PerspectiveCamera(44, 1, 0.11, 2400);
  const controls = new OrbitControls(camera, canvas);
  controls.enabled = false;
  controls.enableDamping = false;
  controls.enablePan = true;
  controls.zoomSpeed = 0.9;
  controls.panSpeed = 0.8;
  controls.rotateSpeed = 0.65;
  controls.maxPolarAngle = Math.PI * 0.495;
  controls.minDistance = 1.1;

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let world;
  let frame;
  let stage;
  let ground;
  let dome;
  let wet;
  let observed;
  let houses;
  let haze;
  let probeObject;
  let siteModels = [];
  let bridgeModels = [];
  let flows = [];
  let rivers = [];
  let current;
  let lastMinute;
  let lastExplore;
  let down;
  let drawing = false;

  function draw() {
    if (!stage || drawing) return;
    drawing = true;
    dome.position.copy(camera.position);
    const distance = camera.position.distanceTo(controls.target);
    scene.fog.near = Math.max(frame.span * 0.40, distance - frame.span * 0.13);
    scene.fog.far = Math.max(frame.span * 1.90, distance + frame.span * 2.65);
    renderer.render(scene, camera);
    drawing = false;
  }

  function setCamera(next) {
    const shot = pose(camera, next, world, frame);
    camera.fov = shot.fov;
    camera.position.copy(shot.position);
    controls.target.copy(shot.target);
    camera.lookAt(shot.target);
    camera.updateProjectionMatrix();
  }

  function load(data, preserveView = false) {
    const savedView = preserveView ? lastExplore : undefined;
    if (stage) {
      scene.remove(stage);
      disposeGroup(stage);
    }
    current = undefined;
    lastMinute = undefined;
    lastExplore = savedView;
    probeObject = undefined;
    frame = { ...makeFrame(data.grid), grid: data.grid };
    world = {
      ...data,
      renderWaves: data.waves.map((wave, index) => ({
        ...wave, index, start: wave.start ?? 0, samples: smoothPath(wave.path)
      })).filter(wave => wave.samples.length),
      confluence: data.confluence ?? commonPoint(data.waves)
    };
    stage = new THREE.Group();
    scene.add(stage);
    scene.fog = new THREE.Fog(0xa2aeaa, frame.span * 0.71, frame.span * 2.8);
    camera.far = frame.span * 7;
    controls.maxDistance = frame.span * 4;
    dome = atmosphere(frame.span);
    ground = terrainMesh(data.grid, frame);
    houses = settlement(data.sites, frame, data.forecastOnly ? {} : data);
    stage.add(dome, ground, terrainSides(data.grid, frame), houses.group);
    const port = ["01", "09"].includes(data.sceneId) && data.sites.find(site => site.id === "port");
    haze = !data.forecastOnly && port && Number.isFinite(port.arrival) ? impactHaze(port, frame) : null;
    if (haze) stage.add(haze.group);

    wet = wetGround(data.grid, frame, data);
    if (wet) stage.add(wet.mesh);
    observed = observedLine(data.observed, frame);
    if (observed) stage.add(observed);
    flows = world.renderWaves.flatMap(wave => [
      ribbon(wave.samples, frame, true, wave, data), movingDebris(wave, frame)
    ]).filter(Boolean);
    const waterPaths = [...world.renderWaves].sort((a, b) => b.path.length - a.path.length);
    const covered = new Set();
    rivers = waterPaths.flatMap(wave => {
      const sections = [];
      let section = [];
      let connector;
      const begin = wave.path.findIndex((point, index) => index > wave.path.length * 0.12 && point.slope < 0.18);
      if (begin < 0) return sections;
      for (const point of wave.path.slice(begin)) {
        if (covered.has(point.id)) {
          if (section.length) sections.push([...section, point]);
          section = [];
          connector = point;
          continue;
        }
        if (!section.length && connector) section.push(connector);
        connector = undefined;
        covered.add(point.id);
        section.push(point);
      }
      if (section.length > 1) sections.push(section);
      return sections.map(path => ribbon(smoothPath(path), frame, false));
    }).filter(Boolean);
    for (const item of [...rivers, ...flows]) stage.add(item.mesh);

    siteModels = data.sites.map(site => siteModel(site, frame));
    for (const site of siteModels) {
      stage.add(site.group);
      if (site.route) stage.add(site.route.group);
      if (site.backup) stage.add(site.backup.group);
    }
    bridgeModels = (data.bridges ?? []).map(bridge => bridgeModel(bridge, frame));
    for (const bridge of bridgeModels) stage.add(bridge.group);
    resize();
    render({ mode: "film", camera: "overview", minute: 0 });
  }

  function render(next) {
    if (!stage) return;
    const previous = current;
    current = next;
    const explore = next.mode === "explore";
    controls.enabled = explore;
    if (observed) observed.visible = next.showObserved ?? (explore || next.camera === "overview");
    if (!explore || previous?.mode !== "explore") {
      if (explore && lastExplore) {
        camera.position.copy(lastExplore.position);
        controls.target.copy(lastExplore.target);
        camera.lookAt(controls.target);
      } else {
        setCamera(next);
      }
    }
    if (explore) {
      controls.update();
      lastExplore = { position: camera.position.clone(), target: controls.target.clone() };
    }
    if (next.minute !== lastMinute) {
      for (const item of [...rivers, ...flows]) item.update(next.minute);
      if (wet) wet.time.value = next.minute;
      houses.update(next.minute);
      haze?.update(next.minute);
      for (const bridge of bridgeModels) bridge.update(next.minute);
      lastMinute = next.minute;
    }
    for (const site of siteModels) {
      updateSite(site, next.events?.[site.site.id], next.minute, next.activeSiteId === site.site.id, next.camera === "dispatch");
    }
    updateProbe(next.probe, next.minute);
    draw();
  }

  function updateProbe(probe, minute) {
    const valid = Number.isFinite(probe?.x) && Number.isFinite(probe?.y);
    const key = valid ? JSON.stringify([probe.x, probe.y, probe.route ?? []]) : undefined;
    if (key !== probeObject?.key) {
      if (probeObject) {
        stage.remove(probeObject.group);
        disposeGroup(probeObject.group);
        probeObject = undefined;
      }
      if (valid) {
        const group = new THREE.Group();
        const pin = new THREE.Mesh(new THREE.OctahedronGeometry(0.31), new THREE.MeshBasicMaterial({
          color: 0xffd095, fog: false
        }));
        pin.position.copy(frame.point(probe.x, probe.y, 0.50));
        const line = makeRoute(probe.route, frame);
        group.add(pin);
        if (line) group.add(line.group);
        stage.add(group);
        probeObject = { group, key, line };
      }
    }
    const line = probeObject?.line;
    if (!line) return;
    const fraction = probe.evacuated ? 1 : clamp(probe.progress ?? 0, 0, 1);
    line.group.visible = true;
    line.progress.geometry.setDrawRange(0, Math.floor(line.progress.geometry.index.count * fraction / 30) * 30);
    animateWalker(line.walker, line.route, fraction, minute, probe.status, 0.92);
  }

  function resize() {
    const width = Math.max(1, container.clientWidth);
    const height = Math.max(1, container.clientHeight);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    if (current && current.mode !== "explore") setCamera(current);
    camera.updateProjectionMatrix();
    draw();
  }

  function project(point, lift = 0.8) {
    if (!stage) return { x: 0, y: 0, visible: false };
    const anchor = frame.point(point.x, point.y, lift);
    const vector = anchor.clone().project(camera);
    const x = (vector.x / 2 + 0.5) * container.clientWidth;
    const y = (0.5 - vector.y / 2) * container.clientHeight;
    const visible = vector.z > -1 && vector.z < 1 && Math.abs(vector.x) < 1 && Math.abs(vector.y) < 1;
    return { x, y, visible };
  }

  function click(event) {
    if (!onSelect || !stage || !down) return;
    if (Math.hypot(event.clientX - down.x, event.clientY - down.y) > 5 || event.button !== 0) return;
    const rect = canvas.getBoundingClientRect();
    const xx = event.clientX - rect.left;
    const yy = event.clientY - rect.top;
    const site = siteModels.find(({ site }) => {
      const anchor = project(site, 0.48);
      return anchor.visible && Math.hypot(xx - anchor.x, yy - anchor.y) <= 11;
    });
    if (site) {
      onSelect({ x: site.site.x, y: site.site.y, siteId: site.site.id });
      return;
    }
    ndc.set((xx / rect.width) * 2 - 1, -(yy / rect.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const hit = ray.intersectObject(ground)[0];
    if (hit) onSelect({ x: hit.point.x + frame.grid.cols / 2, y: hit.point.z + frame.grid.rows / 2 });
  }

  controls.addEventListener("change", () => {
    if (!current || current.mode !== "explore") return;
    const x = camera.position.x + frame.grid.cols / 2;
    const y = camera.position.z + frame.grid.rows / 2;
    if (x >= 0 && y >= 0 && x < frame.grid.cols && y < frame.grid.rows) {
      camera.position.y = Math.max(camera.position.y, frame.height(x, y) + 0.95);
      camera.lookAt(controls.target);
    }
    lastExplore = { position: camera.position.clone(), target: controls.target.clone() };
    draw();
    onCameraChange?.();
  });
  canvas.addEventListener("pointerdown", event => {
    down = { x: event.clientX, y: event.clientY };
  });
  canvas.addEventListener("pointerup", click);
  canvas.addEventListener("keydown", event => {
    if (!current || current.mode !== "explore") return;
    const key = event.key.toLowerCase();
    if (!["w", "a", "s", "d", "arrowup", "arrowleft", "arrowdown", "arrowright"].includes(key)) return;
    event.preventDefault();
    const forward = controls.target.clone().sub(camera.position).setY(0).normalize();
    const sideways = new THREE.Vector3(forward.z, 0, -forward.x);
    const delta = ({
      w: forward, arrowup: forward,
      s: forward.clone().negate(), arrowdown: forward.clone().negate(),
      a: sideways, arrowleft: sideways,
      d: sideways.clone().negate(), arrowright: sideways.clone().negate()
    })[key].multiplyScalar(clamp(camera.position.distanceTo(controls.target) * 0.026, 0.36, 11));
    camera.position.add(delta);
    controls.target.add(delta);
    controls.update();
    draw();
  });

  return {
    load, render, resize, project,
    dispose() {
      controls.dispose();
      if (stage) disposeGroup(stage);
      renderer.dispose();
      canvas.remove();
    }
  };
}

globalThis.RunoutRenderer = { create };
