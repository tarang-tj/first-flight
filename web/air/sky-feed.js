// Time machine data: monthly flight files, loaded lazily, and the maths that turns a point list into
// "where is this jet at instant t". The pure parts (no fetch, no DOM) are what tests/air-sky.test.mjs covers.
// Months are Pacific time; a flight sits in its takeoff month, so a flight crossing a month end is
// found by also keeping the previous month loaded.

import { fetchFresh, createMonthStore } from "./sky-store.js";

const FT = 0.3048, D2R = Math.PI / 180;
const ZONE = "America/Los_Angeles";
let fmt = null;

/** "YYYY-MM" of a unix second in Pacific time. */
export function monthKeyPT(sec) {
  fmt ||= new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit" });
  const p = Object.fromEntries(fmt.formatToParts(new Date(sec * 1000)).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}`;
}
export function shiftMonth(key, d) {
  const [y, m] = key.split("-").map(Number);
  const i = y * 12 + (m - 1) + d;
  return `${Math.floor(i / 12)}-${String((i % 12) + 1).padStart(2, "0")}`;
}
/** Months to hold for time t: [current, previous] needed now, next is a prefetch. Filtered to months that exist. */
export function monthsFor(t, index) {
  const have = new Set((index?.months || []).map((m) => m.key));
  const cur = monthKeyPT(t);
  const pick = (ks) => ks.filter((k) => have.has(k));
  return { need: pick([cur, shiftMonth(cur, -1)]), prefetch: pick([shiftMonth(cur, 1)]) };
}

/** Tail length in sim seconds: short at 1x so it reads as a contrail, long when time races. */
export function tailSeconds(rate) {
  return Math.min(10800, Math.max(900, 900 * Math.sqrt(Math.max(1, rate))));
}

const lerp = (a, b, k) => a + (b - a) * k;
function bearing(lat1, lon1, lat2, lon2) {
  const p1 = lat1 * D2R, p2 = lat2 * D2R, dl = (lon2 - lon1) * D2R;
  const y = Math.sin(dl) * Math.cos(p2), x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return ((Math.atan2(y, x) / D2R) + 360) % 360;
}
const metres = (lat1, lon1, lat2, lon2) => {
  const dy = (lat2 - lat1) * 111320, dx = (lon2 - lon1) * 111320 * Math.cos(((lat1 + lat2) / 2) * D2R);
  return Math.hypot(dx, dy);
};

/** Position at flight-relative seconds dt (clamped to the track), or null for an empty track. */
export function posAt(pts, dt) {
  const n = pts?.length || 0;
  if (!n) return null;
  if (dt <= pts[0][0]) return { lat: pts[0][1], lon: pts[0][2], altFt: pts[0][3] || 0 };
  if (dt >= pts[n - 1][0]) return { lat: pts[n - 1][1], lon: pts[n - 1][2], altFt: pts[n - 1][3] || 0 };
  let lo = 0, hi = n - 1;
  while (hi - lo > 1) { const mid = (lo + hi) >> 1; if (pts[mid][0] <= dt) lo = mid; else hi = mid; }
  const a = pts[lo], b = pts[hi], k = (dt - a[0]) / Math.max(1e-6, b[0] - a[0]);
  return { lat: lerp(a[1], b[1], k), lon: lerp(a[2], b[2], k), altFt: lerp(a[3] || 0, b[3] || 0, k) };
}

const wrap180 = (d) => ((d + 540) % 360) - 180;
const SPAN_S = 20; // look this far each side of now for heading, speed and turn rate

/** Heading of the nearest stretch of track that actually moves, so a parked jet faces the way it will go. Pure. */
export function parkedHeading(pts, dt) {
  let at = 0;
  while (at < pts.length - 1 && pts[at + 1][0] <= dt) at++;
  for (let k = 0; k < pts.length; k++) {
    for (const i of [at + k, at - k - 1]) {
      if (i < 0 || i >= pts.length - 1) continue;
      if (metres(pts[i][1], pts[i][2], pts[i + 1][1], pts[i + 1][2]) > 15) return bearing(pts[i][1], pts[i][2], pts[i + 1][1], pts[i + 1][2]);
    }
  }
  return 0;
}

/** Interpolated state at unix time t: {lat,lon,altFt,headingDeg,pitchDeg,rollDeg,groundKt,climbFpm}, or null if not aloft. */
export function stateAt(f, t) {
  const dt = t - f.t0, pts = f.pts;
  if (!pts?.length || dt < 0 || dt > Math.max(pts[pts.length - 1][0], f.t1 - f.t0)) return null;
  const p = posAt(pts, dt), a = posAt(pts, dt - SPAN_S), b = posAt(pts, dt + SPAN_S);
  const span = Math.min(dt + SPAN_S, pts[pts.length - 1][0]) - Math.max(dt - SPAN_S, 0);
  const dist = metres(a.lat, a.lon, b.lat, b.lon);
  const mps = span > 0 ? dist / span : 0;
  const moving = dist > 15;
  const heading = moving ? bearing(a.lat, a.lon, b.lat, b.lon) : parkedHeading(pts, dt);
  const pa = posAt(pts, dt - SPAN_S * 2), pb = posAt(pts, dt + SPAN_S * 2);
  const hA = metres(pa.lat, pa.lon, a.lat, a.lon) > 15 ? bearing(pa.lat, pa.lon, a.lat, a.lon) : heading;
  const hB = metres(b.lat, b.lon, pb.lat, pb.lon) > 15 ? bearing(b.lat, b.lon, pb.lat, pb.lon) : heading;
  const turn = span > 0 ? wrap180(hB - hA) / (SPAN_S * 3) : 0; // deg per second: the two bearings are centred 60 s apart
  const bank = Math.atan((mps * turn * D2R) / 9.81) / D2R;
  const climbFtS = span > 0 ? (b.altFt - a.altFt) / span : 0;
  const pitch = mps > 8 ? Math.atan2(climbFtS * FT, mps) / D2R : 0;
  return {
    lat: p.lat, lon: p.lon, altFt: p.altFt, headingDeg: heading,
    pitchDeg: Math.max(-18, Math.min(20, pitch)), rollDeg: Math.max(-35, Math.min(35, bank)),
    groundKt: mps * 1.94384, climbFpm: climbFtS * 60,
  };
}

/** Flights from one or more month lists whose [t0, t1] contains t. Order is stable by id. */
export function activeFlights(lists, t) {
  const out = [];
  for (const list of lists) for (const f of list || []) if (f.t0 <= t && t <= f.t1) out.push(f);
  return out.sort((x, y) => (x.id < y.id ? -1 : 1));
}

/** Tail points [lat,lon,altFt] covering [t - sec, t], thinned to at most maxPts, ending exactly at the head. */
export function tailPoints(f, t, sec, maxPts = 160) {
  const dt = t - f.t0, from = Math.max(0, dt - sec), pts = f.pts;
  const inner = pts.filter((p) => p[0] > from && p[0] < dt);
  const stride = Math.max(1, Math.ceil(inner.length / (maxPts - 2)));
  const out = [];
  const s = posAt(pts, from);
  if (s) out.push([s.lat, s.lon, s.altFt]);
  for (let i = 0; i < inner.length; i += stride) out.push([inner[i][1], inner[i][2], inner[i][3] || 0]);
  const e = posAt(pts, dt);
  if (e) out.push([e.lat, e.lon, e.altFt]);
  return out;
}

/** Paine Field, the centre of the "near Puget Sound" count. */
export const PAINE = Object.freeze({ lat: 47.9063, lon: -122.2816 });
export const NEAR_KM = 150;
export const distKm = (lat, lon) => metres(PAINE.lat, PAINE.lon, lat, lon) / 1000;
/** How many of the active states are within km of Paine Field. */
export const nearCount = (acts, km = NEAR_KM) => acts.reduce((n, a) => n + (distKm(a.lat, a.lon) <= km ? 1 : 0), 0);

/** Flights that finished in the last windowS seconds, with age as a 0..1 fraction of the window, newest first. */
export function memoryFlights(lists, t, windowS = 86400) {
  const out = [];
  for (const list of lists) for (const f of list || []) if (f.t1 < t && f.t1 >= t - windowS && f.pts?.length > 1) out.push({ flight: f, age: (t - f.t1) / windowS });
  return out.sort((a, b) => a.age - b.age);
}

export function createSkyFeed({ base = "web/data/sky", load = fetchFresh, maxMonths = 6 } = {}) {
  let index = null;
  const store = createMonthStore({ base, load, max: maxMonths });
  const lists = (keys) => keys.map((k) => store.get(k));
  return {
    get index() { return index; },
    get loadedMonths() { return store.keys(); },
    /** Load index.json. A failed fetch is not remembered, so calling this again retries. */
    async loadIndex() {
      const d = await load(`${base}/index.json`);
      const okSpan = Array.isArray(d?.span) && Number.isFinite(d.span[0]) && Number.isFinite(d.span[1]) && d.span[1] > d.span[0];
      index = okSpan && Array.isArray(d.months) ? { ...d, moments: Array.isArray(d.moments) ? d.moments : [] } : null;
      return index;
    },
    /** Start loading what time t needs. Resolves when the needed months are in; prefetch is not awaited. */
    async ensure(t) {
      if (!index) return false;
      const { need, prefetch } = monthsFor(t, index);
      prefetch.forEach((k) => { store.fetch(k); });
      await Promise.all(need.map((k) => store.fetch(k)));
      store.trim([...need, ...prefetch]);
      return need.every((k) => store.has(k));
    },
    isReady(t) { return !!index && monthsFor(t, index).need.every((k) => store.has(k)); },
    /** Of the newest `k` moments, the one with the most jets near Puget Sound (ties go to the newest). Loads their months. */
    async bestMoment(k = 4, km = NEAR_KM) {
      const ms = [...(index?.moments || [])].sort((a, b) => b.t - a.t).slice(0, k);
      let best = null;
      for (const m of ms) {
        if (!(await this.ensure(m.t))) continue;
        const near = nearCount(this.activeAt(m.t, 0), km);
        if (!best || near > best.near) best = { t: m.t, near };
      }
      return best;
    },
    /** First takeoff after t (within `km` of Paine Field) in the loaded months, or null. */
    nextNearTakeoff(t, km = NEAR_KM) {
      if (!index) return null;
      const { need, prefetch } = monthsFor(t, index);
      let best = null;
      for (const list of lists([...need, ...prefetch])) for (const f of list || []) {
        if (f.t0 > t && (!best || f.t0 < best) && f.pts?.length && distKm(f.pts[0][1], f.pts[0][2]) <= km) best = f.t0;
      }
      return best;
    },
    /** Recently finished flights (for the persistent glow layer). */
    memoryAt(t, windowS = 86400) {
      if (!index) return [];
      return memoryFlights(lists(monthsFor(t, index).need), t, windowS);
    },
    /** Everything aloft at t with interpolated state and tail. Only reads months already loaded. */
    activeAt(t, tailSec = 300) {
      if (!index) return [];
      return activeFlights(lists(monthsFor(t, index).need), t)
        .map((f) => { const s = stateAt(f, t); return s ? { flight: f, ...s, tail: tailPoints(f, t, tailSec) } : null; })
        .filter(Boolean);
    },
  };
}
