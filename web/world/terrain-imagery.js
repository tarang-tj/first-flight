// Streams USGS imagery tiles into one transparent canvas per terrain ring.
import * as THREE from "three";
import { loadImage } from "./tile-loader.js";
import { usgsUrl } from "./tile-math.js";

const tmp = document.createElement("canvas");
tmp.width = tmp.height = 256;
const tmpCtx = tmp.getContext("2d", { willReadFrequently: true });

/**
 * USGS returns pure-white "no data" pixels outside its coverage (Canada; border tiles are half white).
 * Returns a drawable for the tile with those pixels (and a 2 px fringe of antialiased near-white) made
 * transparent, or null if the tile is all no-data.
 */
function cleanTile(img) {
  tmpCtx.clearRect(0, 0, 256, 256);
  tmpCtx.drawImage(img, 0, 0, 256, 256);
  const d = tmpCtx.getImageData(0, 0, 256, 256);
  const p = d.data;
  const gone = new Uint8Array(65536);
  let white = 0;
  for (let i = 0, k = 0; i < p.length; i += 4, k++) {
    if (p[i] >= 244 && p[i + 1] >= 244 && p[i + 2] >= 244) { gone[k] = 1; white++; }
  }
  if (white === 0) return img;
  if (white === 65536) return null;
  const fringe = new Uint8Array(gone);
  for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
    const k = y * 256 + x;
    if (gone[k]) continue;
    for (let dy = -2; dy <= 2 && !fringe[k]; dy++) for (let dx = -2; dx <= 2; dx++) {
      const xx = x + dx, yy = y + dy;
      if (xx >= 0 && yy >= 0 && xx < 256 && yy < 256 && gone[yy * 256 + xx]) { fringe[k] = 1; break; }
    }
  }
  for (let k = 0; k < 65536; k++) if (fringe[k]) p[k * 4 + 3] = 0;
  tmpCtx.putImageData(d, 0, 0);
  return tmp;
}

/**
 * Paint USGS tiles into one canvas that starts transparent. The ring shader shows the elevation colours
 * (vertex colours) wherever the canvas is still transparent: not loaded yet, failed, or no data.
 */
export async function streamImagery(ring, rect, mat, prio, disposables, anisotropy, exposeTo) {
  const n = ring.block.n, px = n * 256;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = px;
  const ctx = canvas.getContext("2d");
  if (ring.name === "core") { ctx.fillStyle = "#6a6e70"; ctx.fillRect(0, 0, px, px); } // roofs sample this: never see-through
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = anisotropy;
  tex.generateMipmaps = true;
  disposables.push(tex);
  mat.map = tex;
  mat.color.setScalar(ring.name === "apron" ? 0.85 : 1.18); // USGS imagery runs dark next to the elevation colours; the z7 apron runs bright, so tone it down to meet the Sound
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
