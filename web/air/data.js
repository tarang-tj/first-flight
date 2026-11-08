// Data loading with honest failure: a missing or broken file yields null and one
// console.warn, never a throw. Lane A writes these files (see interfaces.md).

const cache = new Map();

export function loadJson(url, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  if (cache.has(url)) return cache.get(url);
  const p = (async () => {
    try {
      const res = await fetchImpl(url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return await res.json();
    } catch (err) {
      console.warn(`[data] ${url} unavailable: ${err?.message || err}`);
      return null;
    }
  })();
  cache.set(url, p);
  return p;
}

export const loadLedger = () => loadJson("web/data/ledger.json");
export const loadLatest = () => loadJson("web/data/latest.json");
export const loadTrailMonth = (key) => loadJson(`web/data/trails/${key}.json`);

export async function loadAirframes() {
  const raw = await loadJson("web/data/airframes.json");
  return Array.isArray(raw) ? raw.filter((a) => a && a.hex && a.firstFlight) : [];
}

/** latest.json -> legs, newest first. Tolerates an array or {legs|flights|items}. */
export function normalizeLegs(latest) {
  const list = Array.isArray(latest) ? latest : latest?.legs || latest?.flights || latest?.items || [];
  return list
    .filter((l) => l && Array.isArray(l.pts) && l.pts.length > 1)
    .map((l) => ({
      hex: l.hex || null,
      callsign: l.callsign || l.flight || null,
      from: l.from || null,
      to: l.to || null,
      reg: l.reg || null,
      program: l.program || "unknown",
      t0: Number(l.t0 ?? l.t ?? 0),
      durationS: l.durationS ?? null,
      maxAltFt: l.maxAltFt ?? null,
      firstFlight: l.firstFlight === true,
      flightTest: l.flightTest === true,
      pts: l.pts,
    }))
    .sort((a, b) => b.t0 - a.t0);
}

/** Non-test-fleet airframes, newest first flight first. */
export function newestJets(airframes, n = 6) {
  return airframes
    .filter((a) => !a.flightTest)
    .sort((a, b) => b.firstFlight.t - a.firstFlight.t)
    .slice(0, n);
}

/** The replay for the opening view: newest new jet with a recorded path, else the newest leg. */
export async function pickReplay({ airframes, legs, loadMonth, monthOf }) {
  // A recorded leg already flagged as a new jet's first flight is the best match.
  const flagged = legs.find((l) => l.firstFlight && !l.flightTest);
  if (flagged) {
    const a = airframes.find((x) => x.hex === flagged.hex) || null;
    return { ...flagged, isNewJet: true, airframe: a };
  }
  // Only airframes counted as new (not warm-up history) may be called new jets.
  for (const a of newestJets(airframes.filter((x) => x.counted === true), 5)) {
    const leg = legs.find((l) => l.hex === a.hex && Math.abs(l.t0 - a.firstFlight.t) < 6 * 3600);
    if (leg) return { ...leg, callsign: a.firstFlight.callsign || leg.callsign, from: a.firstFlight.from || leg.from, to: a.firstFlight.to || leg.to, program: a.program, isNewJet: true, airframe: a };
    const path = await findTrail(a, loadMonth, monthOf);
    if (path) return { hex: a.hex, callsign: a.firstFlight.callsign, from: a.firstFlight.from, to: a.firstFlight.to, program: a.program, t0: path.t0, pts: path.pts, isNewJet: true, airframe: a };
  }
  // Otherwise the newest leg worth watching: a real flight, not a taxi or a hop.
  const pick = legs.find((l) => legDuration(l) >= 900 && legMaxAlt(l) >= 3000) || legs[0];
  if (!pick) return null;
  return { ...pick, isNewJet: false, airframe: airframes.find((x) => x.hex === pick.hex) || null };
}

/** Find an airframe's first-flight path in its month file. */
export async function findTrail(airframe, loadMonth, monthOf) {
  const month = await loadMonth(monthOf(airframe.firstFlight.t));
  if (!Array.isArray(month)) return null;
  return month.find((t) => t.hex === airframe.hex && Array.isArray(t.pts) && t.pts.length > 1) || null;
}

const legDuration = (l) => l.durationS ?? (l.pts.at(-1)[0] - l.pts[0][0]);
const legMaxAlt = (l) => l.maxAltFt ?? l.pts.reduce((m, p) => Math.max(m, p[3] || 0), 0);
