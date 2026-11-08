// Nested terrain rings: core (z16 imagery), near (z14), mid (z12) and a far elevation-only ring
// (hypsometric colours) out to about 250 km so Rainier, the Cascades and the Olympics frame the horizon.
// Each ring = Terrarium heightfield mesh (lat/lon -> toLocal, so curvature is exact) + USGS imagery
// texture streamed into one canvas. Coarser rings have the finest cells cut out; every ring has skirts.
import * as THREE from "three";
import { toLocal, fromLocal } from "../geo.js";
import {
  lonToU, latToV, uToLon, vToLat, blockRect, centeredBlock, tilesCovering, sampleField, terrariumUrl, usgsUrl, decodeTerrarium,
} from "./tile-math.js";
import { loadImage, loadHeightfield } from "./tile-loader.js";
import { tintRing } from "./terrain-color.js";
import { patchWaterSheen } from "./water-sheen.js";

const FEATHER = 0.07; // fraction of a ring's width over which its edge fades into the coarser ring
const insetRect = (r, f) => { const du = (r.u1 - r.u0) * f, dv = (r.v1 - r.v0) * f; return { u0: r.u0 + du, v0: r.v0 + dv, u1: r.u1 - du, v1: r.v1 - dv }; };

/** 64x64 alpha mask: opaque inside, fading to 0 across the outer FEATHER of each side (alphaMap reads green). */
function featherMask() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d"), img = ctx.createImageData(64, 64);
  const edge = (v) => { const t = Math.min(1, Math.min(v + 0.5, 63.5 - v) / (64 * FEATHER)); return t * t * (3 - 2 * t); };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = Math.round(255 * Math.min(edge(x), edge(y)));
    img.data.set([a, a, a, 255], (y * 64 + x) * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const CENTER = { lat: 47.9121, lon: -122.2816 };
const RINGS = [
  // z = imagery zoom, n = tiles per side; demZ = elevation zoom. Imagery everywhere (USGS serves low zooms
  // globally, checked 2026-11-08 over Canada and the Pacific); elevation colours are only the fallback.
  { name: "far", z: 9, block: centeredBlock(47.5, -121.2, 9, 10), imagery: true, demZ: 8, grid: 560, drop: 260, skirt: 600 },
  { name: "wide", z: 11, block: centeredBlock(47.7, -122.2, 11, 8), imagery: true, demZ: 9, grid: 220, drop: 90, skirt: 300 },
  { name: "mid", z: 12, block: centeredBlock(47.7, -122.25, 12, 10), imagery: true, demZ: 10, grid: 150, drop: 40, skirt: 150 },
  { name: "near", z: 14, block: centeredBlock(CENTER.lat, CENTER.lon, 14, 8), imagery: true, demZ: 12, grid: 150, drop: 12, skirt: 50 },
  { name: "core", z: 16, block: centeredBlock(CENTER.lat, CENTER.lon, 16, 12), imagery: true, demZ: 14, grid: 130, drop: 0, skirt: 15 },
];

const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
/** Mountains read bigger than life far from the airport (up to +70% above 150 m); nothing changes near it. */
const exaggeration = (h, distM) => Math.max(0, h - 150) * 0.7 * sstep(20000, 90000, distM);

/** Build ring geometry from a heightfield. `hole` is a world rect of the finer ring to cut out. */
function ringGeometry(ring, rect, field, hole) {
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
    if (!hole) return false;
    const u = rect.u0 + ((rect.u1 - rect.u0) * i) / G, v = rect.v0 + ((rect.v1 - rect.v0) * j) / G;
    return u > hole.u0 && u < hole.u1 && v > hole.v0 && v < hole.v1;
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
export function createTerrain() {
  const group = new THREE.Group();
  const disposables = [];
  const settled = [], fieldJobs = [], fields = [];
  let resolveCore = () => {};
  const mask = featherMask();
  disposables.push(mask);
  const api = { core: null, coreReady: new Promise((r) => { resolveCore = r; }) };

  RINGS.forEach((ring, ri) => {
    const rect = blockRect(ring.z, ring.block.x0, ring.block.y0, ring.block.n);
    const finer = RINGS[ri + 1];
    const hole = finer ? insetRect(blockRect(finer.z, finer.block.x0, finer.block.y0, finer.block.n), FEATHER) : null;
    const prio = 10 - ri; // core first
    const fieldP = loadHeightfield(terrariumUrl, decodeTerrarium, tilesCovering(rect, ring.demZ), ring.demZ, prio)
      .then((f) => { fields.push({ rect, field: f, order: ri }); return f; });
    fieldJobs.push(fieldP.catch(() => null));
    const job = (async () => {
      try {
        const field = await fieldP;
        const geo = ringGeometry(ring, rect, field, hole);
        const colors = tintRing(geo);
        geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
        const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
        if (ri > 0) { mat.alphaMap = mask; mat.transparent = true; }
        patchWaterSheen(mat);
        const sheen = mat.onBeforeCompile; // then: blend imagery over the elevation colours by tile alpha
        mat.onBeforeCompile = (s) => {
          sheen(s);
          s.fragmentShader = s.fragmentShader
            .replace("#include <map_fragment>", "#ifdef USE_MAP\n vec4 ffTexel = texture2D( map, vMapUv );\n#endif")
            .replace("#include <color_fragment>", "#if defined( USE_MAP ) && defined( USE_COLOR )\n diffuseColor.rgb = mix( vColor, ffTexel.rgb * diffuse, ffTexel.a );\n#elif defined( USE_COLOR )\n diffuseColor.rgb *= vColor;\n#endif");
        };
        mat.customProgramCacheKey = () => "ring-blend";
        const mesh = new THREE.Mesh(geo, mat);
        mesh.renderOrder = ri - 5;
        mesh.frustumCulled = false;
        group.add(mesh);
        disposables.push(geo, mat);
        if (ring.imagery) await streamImagery(ring, rect, mesh, geo, mat, prio, disposables, ring.name === "core" ? { set: (v) => { api.core = v; resolveCore(); } } : null);
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

/**
 * USGS returns pure-white "no data" pixels outside its coverage (Canada; border tiles are half white).
 * Returns a drawable for the tile with those pixels made transparent, or null if the tile is all no-data.
 */
const tmp = document.createElement("canvas");
tmp.width = tmp.height = 256;
const tmpCtx = tmp.getContext("2d", { willReadFrequently: true });
function cleanTile(img) {
  tmpCtx.clearRect(0, 0, 256, 256);
  tmpCtx.drawImage(img, 0, 0, 256, 256);
  const d = tmpCtx.getImageData(0, 0, 256, 256);
  const p = d.data;
  let white = 0;
  for (let i = 0; i < p.length; i += 4) {
    if (p[i] >= 250 && p[i + 1] >= 250 && p[i + 2] >= 250) { p[i + 3] = 0; white++; }
  }
  if (white === 0) return img;
  if (white === 65536) return null;
  tmpCtx.putImageData(d, 0, 0);
  return tmp;
}

/**
 * Paint USGS tiles into one canvas that starts transparent. The ring shader shows the elevation colours
 * (vertex colours) wherever the canvas is still transparent: not loaded yet, failed, or no data.
 */
async function streamImagery(ring, rect, mesh, geo, mat, prio, disposables, exposeTo) {
  const n = ring.block.n, px = n * 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (ring.name === "core") { ctx.fillStyle = "#6a6e70"; ctx.fillRect(0, 0, px, px); } // roofs sample this: never see-through
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  tex.generateMipmaps = true;
  disposables.push(tex);
  mat.map = tex;
  mat.color.setScalar(1.18); // USGS imagery runs dark next to the elevation colours
  mat.needsUpdate = true;
  if (exposeTo) exposeTo.set({ rect, texture: tex });
  let ok = 0, skipped = 0, dirty = false;
  const flush = () => { if (dirty) { dirty = false; tex.needsUpdate = true; } };
  const timer = setInterval(flush, 500);
  const jobs = [];
  const order = [];
  for (let dy = 0; dy < n; dy++) for (let dx = 0; dx < n; dx++) order.push([dx, dy]);
  // centre-out so the area around the airport sharpens first
  order.sort((a, b) => Math.hypot(a[0] - n / 2, a[1] - n / 2) - Math.hypot(b[0] - n / 2, b[1] - n / 2));
  for (const [dx, dy] of order) {
    jobs.push(loadImage(usgsUrl(ring.z, ring.block.x0 + dx, ring.block.y0 + dy), prio + 3).then((img) => {
      if (!img) return;
      try {
        const tile = cleanTile(img);
        if (!tile) { skipped++; return; }
        ctx.drawImage(tile, dx * 256, dy * 256, 256, 256); ok++; dirty = true;
      } catch (err) { console.warn("[world] tile draw failed", err.message); }
    }));
  }
  await Promise.all(jobs);
  clearInterval(timer);
  flush();
  window.__tileStats = Object.assign(window.__tileStats || {}, { [ring.name]: { ok, skipped } });
  if (!ok) console.warn(`[world] no imagery for ring ${ring.name}; using elevation colours`);
}
