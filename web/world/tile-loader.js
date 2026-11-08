// Throttled tile image loader with a capped LRU cache of decoded elevation tiles.
// Failures resolve to null (console.warn once per host at most); nothing here ever throws.

const MAX_PARALLEL = 14;
const TIMEOUT_MS = 25000;
const queue = [];
let active = 0;
const warnedHosts = new Set();

function pump() {
  while (active < MAX_PARALLEL && queue.length) {
    const job = queue.shift();
    active++;
    job.run().finally(() => { active--; pump(); });
  }
}

/** Load an image (CORS-anonymous). priority: lower runs first. Resolves to the image or null. */
export function loadImage(url, priority = 5) {
  return new Promise((resolve) => {
    const run = () => new Promise((done) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      const timer = setTimeout(() => finish(null, "timeout"), TIMEOUT_MS);
      function finish(v, why) {
        clearTimeout(timer);
        img.onload = img.onerror = null;
        if (!v) {
          const host = new URL(url).host;
          if (!warnedHosts.has(host)) { warnedHosts.add(host); console.warn(`[world] tile load failed (${why}) from ${host}; falling back`); }
        }
        resolve(v);
        done();
      }
      img.onload = () => finish(img.naturalWidth > 0 ? img : null, "empty image");
      img.onerror = () => finish(null, "error");
      img.src = url;
    });
    queue.push({ priority, run });
    queue.sort((a, b) => a.priority - b.priority);
    pump();
  });
}

const demCache = new Map();
const DEM_CAP = 96;

/** Elevation tile as a 256x256 Float32Array of metres (zeros if the tile cannot load). */
export async function loadDemTile(url, decode, priority = 1) {
  if (demCache.has(url)) { const v = demCache.get(url); demCache.delete(url); demCache.set(url, v); return v; }
  const img = await loadImage(url, priority);
  const out = new Float32Array(256 * 256);
  if (img) {
    try {
      const c = document.createElement("canvas");
      c.width = c.height = 256;
      const ctx = c.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, 256, 256);
      const px = ctx.getImageData(0, 0, 256, 256).data;
      for (let i = 0; i < 65536; i++) out[i] = decode(px[i * 4], px[i * 4 + 1], px[i * 4 + 2]);
    } catch (err) {
      console.warn("[world] elevation tile decode failed", err && err.message);
      out.fill(0);
    }
  }
  demCache.set(url, out);
  if (demCache.size > DEM_CAP) demCache.delete(demCache.keys().next().value);
  return out;
}

/** Stitch the tiles covering a world rect into one heightfield { z, x0, y0, w, h, data }. */
export async function loadHeightfield(urlFor, decode, cover, z, priority = 1) {
  const nx = cover.x1 - cover.x0 + 1, ny = cover.y1 - cover.y0 + 1;
  const w = nx * 256, h = ny * 256, data = new Float32Array(w * h);
  const jobs = [];
  for (let ty = 0; ty < ny; ty++) for (let tx = 0; tx < nx; tx++) {
    jobs.push(loadDemTile(urlFor(z, cover.x0 + tx, cover.y0 + ty), decode, priority).then((t) => {
      for (let y = 0; y < 256; y++) data.set(t.subarray(y * 256, y * 256 + 256), (ty * 256 + y) * w + tx * 256);
    }));
  }
  await Promise.all(jobs);
  return { z, x0: cover.x0, y0: cover.y0, w, h, data };
}
