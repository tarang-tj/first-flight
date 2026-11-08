// Baked OpenStreetMap geometry (web/data/osm-paine.json): extruded buildings, the Everett plant picked
// out, runway / taxiway lights and factory lights for night. Missing data degrades to an empty group.
import * as THREE from "three";
import { createGlowPoints } from "./glow-points.js";
import { extrudeBuildings } from "./extrude.js";
import { fromLocal } from "../geo.js";
import { lonToU, latToV } from "./tile-math.js";

const DATA_URL = new URL("../data/osm-paine.json", import.meta.url).href;
const PLANT_EMPHASIS = 1.35;
const BASE_Y = -2; // sink footprints slightly below the DEM so none float

/** Lights spaced along a polyline, offset to both edges. */
function edgeLights(pts, width, step, y, out) {
  let carry = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const [ax, az] = pts[i], [bx, bz] = pts[i + 1];
    const len = Math.hypot(bx - ax, bz - az);
    if (len < 1) continue;
    const dx = (bx - ax) / len, dz = (bz - az) / len;
    for (let d = carry; d < len; d += step) {
      for (const s of [-1, 1]) out.push([ax + dx * d - dz * s * width / 2, y, az + dz * d + dx * s * width / 2]);
    }
    carry = ((len - carry) % step) ? step - ((len - carry) % step) : 0;
  }
}

export async function createOsmLayer(groundAt = () => 0, core = null) {
  const group = new THREE.Group();
  const api = { group, plant: null, setNight() {}, dispose() {} };
  let data;
  try {
    const res = await fetch(DATA_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    data = await res.json();
    if (!Array.isArray(data.buildings)) throw new Error("bad shape");
  } catch (err) {
    console.warn("[world] OSM data unavailable, no buildings:", err.message);
    return api;
  }

  for (const b of data.buildings) if (b.plant) b.h = Math.round(b.h * PLANT_EMPHASIS); // slightly taller than life so the hero reads
  for (const b of data.buildings) { // ground under the lowest footprint corner
    let gy = Infinity;
    for (const p of b.ring.length > 8 ? b.ring.filter((_, i) => i % 3 === 0) : b.ring) gy = Math.min(gy, groundAt(p[0], p[1]));
    b.gy = gy;
  }
  const uvOf = core ? (x, z) => {
    const ll = fromLocal(x, z), r = core.rect;
    return [(lonToU(ll.lon) - r.u0) / (r.u1 - r.u0), 1 - (latToV(ll.lat) - r.v0) / (r.v1 - r.v0)];
  } : () => null;
  const g = extrudeBuildings(data.buildings, BASE_Y, uvOf);
  const matGeneral = new THREE.MeshLambertMaterial({ vertexColors: true });
  const matPlantWall = new THREE.MeshLambertMaterial({ vertexColors: true, color: 0xf2f5f8, emissive: 0xffa060, emissiveIntensity: 0 });
  const matRoof = new THREE.MeshLambertMaterial({ map: core && core.texture, color: 0xffffff });
  const matPlantRoof = new THREE.MeshLambertMaterial({ map: core && core.texture, color: 0xffffff, emissive: 0xff7a2a, emissiveIntensity: 0 });
  const meshes = [[g.walls, matGeneral], [g.roofs, matRoof], [g.plantWalls, matPlantWall], [g.plantRoofs, matPlantRoof]]
    .filter(([geo]) => geo).map(([geo, m]) => new THREE.Mesh(geo, m));
  meshes.forEach((m) => { m.frustumCulled = false; group.add(m); });

  const pb = data.buildings.find((b) => b.plant);
  if (pb) {
    const cx = pb.ring.reduce((s, p) => s + p[0], 0) / pb.ring.length;
    const cz = pb.ring.reduce((s, p) => s + p[1], 0) / pb.ring.length;
    api.plant = { name: pb.name || "Boeing Everett Assembly Plant", x: cx, y: pb.gy + pb.h, z: cz, height: pb.h };
  }

  // night lights
  const pos = [], col = [], size = [];
  const add = (p, c, s, rel = null) => { pos.push(p[0], p[1] + (rel ? rel(p[0], p[2]) : 0), p[2]); col.push(c[0], c[1], c[2]); size.push(s); };
  const WHITE = [1, 0.93, 0.8], BLUE = [0.2, 0.45, 1], GREEN = [0.2, 1, 0.35], RED = [1, 0.15, 0.1], WARM = [1, 0.68, 0.34];
  for (const r of data.runways || []) {
    const e = []; edgeLights(r.pts, r.width + 4, 60, 1.2, e);
    e.forEach((p) => add(p, WHITE, 4.5, groundAt));
    const a = r.pts[0], b = r.pts[r.pts.length - 1];
    [[a, GREEN], [b, RED]].forEach(([p, c]) => { for (let k = -5; k <= 5; k++) add([p[0] + k * 4, 1.2, p[1]], c, 5, groundAt); });
  }
  for (const t of data.taxiways || []) {
    const e = []; edgeLights(t.pts, t.width, 32, 0.8, e);
    e.forEach((p) => add(p, BLUE, 3, groundAt));
  }
  for (const a of data.aprons || []) {
    if (a.ring.length < 3) continue;
    const cx = a.ring.reduce((s, p) => s + p[0], 0) / a.ring.length, cz = a.ring.reduce((s, p) => s + p[1], 0) / a.ring.length;
    add([cx, 14, cz], [1, 0.9, 0.7], 14, groundAt);
  }
  if (pb) { // plant: perimeter glow plus roofline lights
    const r = pb.ring;
    for (let i = 0; i < r.length; i++) {
      const [ax, az] = r[i], [bx, bz] = r[(i + 1) % r.length];
      const len = Math.hypot(bx - ax, bz - az);
      for (let d = 0; d < len; d += 22) add([ax + ((bx - ax) * d) / len, pb.gy + pb.h + 1, az + ((bz - az) * d) / len], WARM, 12);
    }
    let seed = 7;
    const rnd = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
    const xs = r.map((p) => p[0]), zs = r.map((p) => p[1]);
    const [x0, x1, z0, z1] = [Math.min(...xs), Math.max(...xs), Math.min(...zs), Math.max(...zs)];
    for (let k = 0; k < 600; k++) { // roof lamps (point-in-polygon rejection)
      const x = x0 + rnd() * (x1 - x0), z = z0 + rnd() * (z1 - z0);
      if (inside(r, x, z)) add([x, pb.gy + pb.h + 0.8, z], [1, 0.82, 0.6], 7);
    }
  }
  for (const b of data.buildings) { // lit industrial roofs elsewhere
    if (b.plant || b.h < 11 || b.ring.length < 4) continue;
    const c = b.ring[0];
    add([c[0], b.gy + b.h + 1, c[1]], WARM, 4);
  }
  const lights = createGlowPoints(pos, col, size, { minPx: 1.5, maxPx: 22 });
  lights.visible = false;
  group.add(lights);

  api.setNight = (n) => {
    lights.userData.setOpacity(n);
    matPlantWall.emissiveIntensity = 0.07 * n;
    matPlantRoof.emissiveIntensity = 0.04 * n;
    matGeneral.emissive.setRGB(0.06 * n, 0.05 * n, 0.03 * n);
  };
  api.dispose = () => {
    meshes.forEach((m) => m.geometry.dispose());
    [matGeneral, matPlantWall, matRoof, matPlantRoof].forEach((m) => m.dispose());
    lights.geometry.dispose(); lights.material.dispose();
  };
  return api;
}

function inside(ring, x, z) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, zi] = ring[i], [xj, zj] = ring[j];
    if ((zi > z) !== (zj > z) && x < ((xj - xi) * (z - zi)) / (zj - zi) + xi) c = !c;
  }
  return c;
}
