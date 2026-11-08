// Merge OSM footprints into BufferGeometries: flat-shaded walls (plus roofs outside the imagery) and
// roofs that sample the real aerial imagery (so the plant's actual roof detail shows, lifted to height).
// Footprint ring: [[x, z], ...] in local metres. uvOf(x, z) -> [u, v] in 0..1 inside the textured area, else null.
import * as THREE from "three";

const sink = () => ({ pos: [], nrm: [], col: [], uv: [] });

function pushBuilding(b, baseY, uvOf, walls, roofsTex) {
  const base = baseY + (b.gy || 0);
  const ring = b.ring.map(([x, z]) => new THREE.Vector2(x, z));
  if (ring.length < 3) return;
  const top = base + b.h;
  let area2 = 0;
  for (let i = 0; i < ring.length; i++) { const p = ring[i], q = ring[(i + 1) % ring.length]; area2 += p.x * q.y - q.x * p.y; }
  const orient = area2 >= 0 ? 1 : -1;
  const shade = (b.plant ? 0.92 : 0.5 + (((b.id || 0) % 1000) / 1000) * 0.22);
  const uvs = ring.map((p) => uvOf(p.x, p.y));
  const textured = uvs.every((t) => t && t[0] > 0.002 && t[0] < 0.998 && t[1] > 0.002 && t[1] < 0.998);
  // triangle with fixed facing: winding flipped when needed so the front face looks along `want`
  const tri = (out, a, c, d, want, s, uv) => {
    const ux = c[0] - a[0], uy = c[1] - a[1], uz = c[2] - a[2], vx = d[0] - a[0], vy = d[1] - a[1], vz = d[2] - a[2];
    const nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const flip = nx * want[0] + ny * want[1] + nz * want[2] < 0;
    const order = flip ? [0, 2, 1] : [0, 1, 2], pts = [a, c, d];
    for (const k of order) {
      const p = pts[k];
      out.pos.push(p[0], p[1], p[2]); out.nrm.push(want[0], want[1], want[2]); out.col.push(s, s, s);
      if (uv) out.uv.push(uv[k][0], uv[k][1]);
    }
  };
  for (const t of THREE.ShapeUtils.triangulateShape(ring, [])) {
    const P = t.map((k) => [ring[k].x, top, ring[k].y]);
    if (textured) tri(roofsTex, P[0], P[1], P[2], [0, 1, 0], 1, t.map((k) => uvs[k]));
    else tri(walls, P[0], P[1], P[2], [0, 1, 0], shade * 1.05, null);
  }
  for (let i = 0; i < ring.length; i++) {
    const a = ring[i], c = ring[(i + 1) % ring.length];
    const dx = c.x - a.x, dz = c.y - a.y, len = Math.hypot(dx, dz) || 1;
    const want = [(dz / len) * orient, 0, (-dx / len) * orient];
    const s = shade * (0.7 + 0.12 * Math.abs(want[0]));
    tri(walls, [a.x, base, a.y], [c.x, base, c.y], [c.x, top, c.y], want, s, null);
    tri(walls, [a.x, base, a.y], [c.x, top, c.y], [a.x, top, a.y], want, s, null);
  }
}

function toGeometry(out) {
  if (!out.pos.length) return null;
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(out.pos, 3));
  g.setAttribute("normal", new THREE.Float32BufferAttribute(out.nrm, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(out.col, 3));
  if (out.uv.length) g.setAttribute("uv", new THREE.Float32BufferAttribute(out.uv, 2));
  return g;
}

/** Returns { walls, roofs, plantWalls, plantRoofs } (any may be null). */
export function extrudeBuildings(buildings, baseY = 0, uvOf = () => null) {
  const w = sink(), r = sink(), pw = sink(), pr = sink();
  for (const b of buildings) pushBuilding(b, baseY, uvOf, b.plant ? pw : w, b.plant ? pr : r);
  return { walls: toGeometry(w), roofs: toGeometry(r), plantWalls: toGeometry(pw), plantRoofs: toGeometry(pr) };
}
