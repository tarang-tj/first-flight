// Nested terrain rings: core (z16 imagery), near (z14), mid (z12), wide (z11) and a far ring (z9) out to
// about 250 km so Rainier, the Cascades and the Olympics frame the horizon. Layout per tier: terrain-rings.js.
// Each ring = Terrarium heightfield mesh (lat/lon -> toLocal, so curvature is exact) + USGS imagery
// texture streamed into one canvas. Coarser rings have the finest cells cut out; every ring has skirts.
import * as THREE from "three";
import { toLocal, fromLocal } from "../geo.js";
import {
  lonToU, latToV, uToLon, vToLat, blockRect, tilesCovering, sampleField, terrariumUrl, decodeTerrarium,
} from "./tile-math.js";
import { loadHeightfield } from "./tile-loader.js";
import { tintRing } from "./terrain-color.js";
import { ringsFor } from "./terrain-rings.js";
import { FEATHER, featherMask, makeRingMaterial } from "./terrain-material.js";
import { streamImagery } from "./terrain-imagery.js";
import { TIER_SETTINGS } from "./tier.js";

const insetRect = (r, f) => { const du = (r.u1 - r.u0) * f, dv = (r.v1 - r.v0) * f; return { u0: r.u0 + du, v0: r.v0 + dv, u1: r.u1 - du, v1: r.v1 - dv }; };

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Mountains read bigger than life far from the airport (up to +70% above 150 m); nothing changes near it. */
const exaggeration = (h, distM) => Math.max(0, h - 150) * 0.7 * sstep(20000, 90000, distM);

/** Build ring geometry from a heightfield. `holes` are world rects of finer rings to cut out. */
function ringGeometry(ring, rect, field, holes) {
  const G = ring.grid, W = G + 1;
  const pos = [], uv = [], idx = [], base = [];
  for (let j = 0; j <= G; j++) for (let i = 0; i <= G; i++) {
    const u = rect.u0 + ((rect.u1 - rect.u0) * i) / G, v = rect.v0 + ((rect.v1 - rect.v0) * j) / G;
    const h = Math.max(0, sampleField(field, u, v));
    const p = toLocal(vToLat(v), uToLon(u), h);
    pos.push(p.x, p.y - ring.drop + exaggeration(h, Math.hypot(p.x, p.z)), p.z);
    uv.push(i / G, 1 - j / G);
    base.push(h);
  }
  const inHole = (i, j) => {
    const u = rect.u0 + ((rect.u1 - rect.u0) * i) / G, v = rect.v0 + ((rect.v1 - rect.v0) * j) / G;
    return holes.some((h) => u > h.u0 && u < h.u1 && v > h.v0 && v < h.v1);
  };
  for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
    if (inHole(i, j) && inHole(i + 1, j) && inHole(i, j + 1) && inHole(i + 1, j + 1)) continue;
    const a = j * W + i;
    idx.push(a, a + W, a + 1, a + 1, a + W, a + W + 1);
  }
  // skirts: duplicate the border vertices lower down and stitch
  const edges = [];
  for (let i = 0; i < G; i++) edges.push([i, i + 1], [G * W + i, G * W + i + 1]);
  for (let j = 0; j < G; j++) edges.push([j * W, (j + 1) * W], [j * W + G, (j + 1) * W + G]);
  const skirtOf = new Map();
  const skirtVert = (k) => {
    if (!skirtOf.has(k)) {
      skirtOf.set(k, pos.length / 3);
      pos.push(pos[k * 3], pos[k * 3 + 1] - ring.skirt, pos[k * 3 + 2]);
      uv.push(uv[k * 2], uv[k * 2 + 1]);
      base.push(base[k]);
    }
    return skirtOf.get(k);
  };
  for (const [a, b] of edges) { const sa = skirtVert(a), sb = skirtVert(b); idx.push(a, sa, b, b, sa, sb); }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  g.computeVertexNormals();
  // elevation tiles unreachable (all zeros): colour as lowland rather than a sea
  let max = 0;
  for (let k = 0; k < field.data.length; k += 97) if (field.data[k] > max) max = field.data[k];
  g.userData.heights = max > 0 ? base : base.map(() => 40);
  return g;
}

/** Returns { group, ready:Promise, dispose() }. Never rejects; errors become warnings. */
export function createTerrain(tier = "full") {
  const RINGS = ringsFor(tier), aniso = TIER_SETTINGS[tier].anisotropy;
  const group = new THREE.Group();
  const disposables = [];
  const settled = [], fieldJobs = [], fields = [];
  let resolveCore = () => {};
  const mask = featherMask();
  disposables.push(mask);
  const api = { core: null, coreReady: new Promise((r) => { resolveCore = r; }) };

  RINGS.forEach((ring, ri) => {
    const rect = blockRect(ring.z, ring.block.x0, ring.block.y0, ring.block.n);
    // every finer ring cuts its footprint out of this one (the apron keeps its full surface: see terrain-rings.js)
    const holes = ri === 0 ? [] : RINGS.slice(ri + 1).map((f) => insetRect(blockRect(f.z, f.block.x0, f.block.y0, f.block.n), FEATHER));
    const prio = 10 - ri; // core first
    const fieldP = loadHeightfield(terrariumUrl, decodeTerrarium, tilesCovering(rect, ring.demZ), ring.demZ, prio)
      .then((f) => { fields.push({ rect, field: f, order: ri }); return f; });
    fieldJobs.push(fieldP.catch(() => null));
    const job = (async () => {
      try {
        const field = await fieldP;
        const geo = ringGeometry(ring, rect, field, holes);
        const colors = tintRing(geo);
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mat = makeRingMaterial(ring.name, ri, mask);
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = ri - 5;
        mesh.frustumCulled = false;
        group.add(mesh);
        disposables.push(geo, mat);
        await streamImagery(ring, rect, mat, prio, disposables, aniso, ring.name === "core" ? { set: (v) => { api.core = v; resolveCore(); } } : null);
      } catch (err) {
        console.warn(`[world] terrain ring ${ring.name} failed`, err && err.message);
        if (ring.name === "core") resolveCore();
      }
    })();
    settled.push(job);
  });

  return Object.assign(api, {
    group,
    ready: Promise.all(settled).then(() => true),
    /** Resolves when every elevation ring has loaded (imagery may still be streaming). */
    demReady: Promise.all(fieldJobs).then(() => true),
    /** Ground height in local y (metres) under local x,z, from the finest ring that covers it. */
    groundAt(x, z) {
      const ll = fromLocal(x, z), u = lonToU(ll.lon), v = latToV(ll.lat);
      let best = null;
      for (const f of fields) {
        const r = f.rect;
        if (u >= r.u0 && u <= r.u1 && v >= r.v0 && v <= r.v1 && (!best || f.order > best.order)) best = f;
      }
      return toLocal(ll.lat, ll.lon, best ? Math.max(0, sampleField(best.field, u, v)) : 0).y;
    },
    dispose() { disposables.forEach((d) => d.dispose()); },
  });
}
