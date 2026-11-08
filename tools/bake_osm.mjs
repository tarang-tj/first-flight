// Bake Paine Field / Everett OpenStreetMap geometry into web/data/osm-paine.json.
// Run: node tools/bake_osm.mjs   (needs network; Overpass wants a User-Agent). Data (c) OpenStreetMap, ODbL.
// Output coordinates are local metres (x east, z = -north) from web/geo.js, rounded to 0.1 m.
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { toLocal, ORIGIN } from "../web/geo.js";

const BBOX = [47.885, -122.335, 47.945, -122.225]; // S, W, N, E
const OUT = fileURLToPath(new URL("../web/data/osm-paine.json", import.meta.url));
const MIN_AREA = 140; // m2, drops sheds
const DEFAULT_PLANT_H = 35; // Everett plant is about 35 m tall at the roof
const PLANT_ID = 26996005;
const UA = "first-flight/0.1 (github.com/tarang-tj/first-flight; build script)";

const q = `[out:json][timeout:90];(way["building"](${BBOX.join(",")});way["aeroway"~"runway|taxiway|apron|hangar|terminal"](${BBOX.join(",")}););out geom tags;`;

const r1 = (n) => Math.round(n * 10) / 10;
const area = (ring) => Math.abs(ring.reduce((s, p, i) => {
  const q2 = ring[(i + 1) % ring.length];
  return s + p[0] * q2[1] - q2[0] * p[1];
}, 0)) / 2;

/** Douglas-Peucker on an open polyline. */
function dp(pts, eps) {
  if (pts.length < 3) return pts;
  let idx = 0, dmax = 0;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1e-9;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dz * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > dmax) { dmax = d; idx = i; }
  }
  if (dmax <= eps) return [a, b];
  return [...dp(pts.slice(0, idx + 1), eps).slice(0, -1), ...dp(pts.slice(idx), eps)];
}
const simplifyRing = (ring, eps) => {
  const open = ring.slice(0, -1); // OSM closed ways repeat the first point
  const s = dp([...open, open[0]], eps).slice(0, -1);
  return s.length >= 3 ? s : open;
};

function heightOf(t, id) {
  if (id === PLANT_ID) return DEFAULT_PLANT_H; // OSM levels tag (5) understates the roof
  const h = parseFloat(t.height);
  if (h > 0) return Math.min(h, 120);
  const lv = parseFloat(t["building:levels"]);
  if (lv > 0) return Math.min(lv * 4, 120);
  if (id === PLANT_ID) return DEFAULT_PLANT_H;
  if (t.building === "industrial" || t.building === "warehouse" || t.aeroway === "hangar") return 12;
  if (t.building === "house" || t.building === "garage" || t.building === "detached") return 6;
  return 8;
}

async function fetchOsm() {
  const cache = new URL("./cache/overpass-paine.json", import.meta.url);
  try { return JSON.parse(await readFile(cache, "utf8")); } catch { /* fetch below */ }
  const res = await fetch("https://overpass-api.de/api/interpreter", {
    method: "POST", headers: { "User-Agent": UA, "Content-Type": "application/x-www-form-urlencoded" },
    body: "data=" + encodeURIComponent(q),
  });
  if (!res.ok) throw new Error(`Overpass HTTP ${res.status}`);
  const j = await res.json();
  await mkdir(new URL("./cache/", import.meta.url), { recursive: true });
  await writeFile(cache, JSON.stringify(j));
  return j;
}

const local = (g) => g.map((p) => { const l = toLocal(p.lat, p.lon, 0); return [r1(l.x), r1(l.z)]; });

const osm = await fetchOsm();
const out = { source: "OpenStreetMap contributors, ODbL", origin: ORIGIN, buildings: [], runways: [], taxiways: [], aprons: [] };
for (const el of osm.elements) {
  if (el.type !== "way" || !el.geometry) continue;
  const t = el.tags || {};
  const pts = local(el.geometry);
  if (t.aeroway === "runway") out.runways.push({ ref: t.ref || "", width: parseFloat(t.width) || 30, pts: dp(pts, 1) });
  else if (t.aeroway === "taxiway") out.taxiways.push({ ref: t.ref || "", width: parseFloat(t.width) || 23, pts: dp(pts, 1) });
  else if (t.aeroway === "apron") out.aprons.push({ ring: simplifyRing(pts, 1.5) });
  else if ((t.building || t.aeroway === "hangar" || t.aeroway === "terminal") && pts.length >= 4) {
    const ring = simplifyRing(pts, el.id === PLANT_ID ? 1 : 1.5);
    if (el.id !== PLANT_ID && area(ring) < MIN_AREA) continue;
    const b = { id: el.id, h: heightOf(t, el.id), ring: ring.map(([x, z]) => [r1(x), r1(z)]) };
    if (t.name) b.name = t.name;
    if (el.id === PLANT_ID) b.plant = true;
    out.buildings.push(b);
  }
}
if (!out.buildings.some((b) => b.plant)) throw new Error("Everett plant way missing from Overpass result");
if (!out.runways.length) throw new Error("no runways in Overpass result");
await mkdir(new URL("../web/data/", import.meta.url), { recursive: true });
await writeFile(OUT, JSON.stringify(out));
console.log(`buildings ${out.buildings.length} runways ${out.runways.length} taxiways ${out.taxiways.length} aprons ${out.aprons.length}`);
