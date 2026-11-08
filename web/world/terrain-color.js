// Hypsometric vertex colours: the look of every ring until imagery lands, and of the far ring always.
// Water at 0 m, lowland green, forest, bare rock by slope and height, snow on high ground.

const lerp = (a, b, t) => a + (b - a) * t;
const sstep = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// deterministic hash noise so colours vary without a RNG
const hash = (x, y) => { const s = Math.sin(x * 127.1 + y * 311.7) * 43758.5453; return s - Math.floor(s); };

/** Colour for a vertex. h metres MSL, ny = normal.y (1 flat), n = per-vertex noise 0..1. */
export function terrainColor(h, ny, n) {
  if (h <= 0.4) return [0.07 + n * 0.015, 0.14 + n * 0.02, 0.21 + n * 0.025];
  const low = [0.13 + n * 0.04, 0.17 + n * 0.04, 0.12];
  const forest = [0.05 + n * 0.025, 0.12 + n * 0.035, 0.08 + n * 0.02];
  const rock = [0.36 + n * 0.06, 0.33 + n * 0.05, 0.3 + n * 0.04];
  const snow = [0.93, 0.95, 0.99];
  let c = low.map((v, i) => lerp(v, forest[i], sstep(60, 400, h)));
  const rockness = Math.max(sstep(900, 1700, h), sstep(0.88, 0.62, ny) * sstep(120, 600, h));
  c = c.map((v, i) => lerp(v, rock[i], rockness));
  const snowAmt = sstep(1500 + n * 150, 2000, h) * sstep(0.4, 0.8, ny + 0.2);
  return c.map((v, i) => lerp(v, snow[i], snowAmt));
}

/** Per-vertex RGB for a ring geometry (needs normals and geometry.userData.heights). */
export function tintRing(geo) {
  const nrm = geo.getAttribute("normal"), pos = geo.getAttribute("position"), hs = geo.userData.heights;
  const out = new Float32Array(pos.count * 3);
  for (let i = 0; i < pos.count; i++) {
    const n = hash(pos.getX(i) * 0.01, pos.getZ(i) * 0.01);
    out.set(terrainColor(hs[i], nrm.getY(i), n), i * 3);
  }
  return out;
}
