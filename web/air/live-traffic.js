// Layer live aircraft on the world: Boeing test flights orange, all else dim white.
// Positions are dead-reckoned between 5 s polls from ground speed and track.

import { classify, programFor } from "./classify.js";

const MAX_JETS = 160;
const KT_TO_MS = 0.514444;
const FT = 0.3048;

export function createLiveTraffic(world, geo) {
  const jets = new Map(); // hex -> { handle, kind, fix, fetchedAt }

  function sync(acList, fetchedAt) {
    if (!world?.addJet) return;
    const seen = new Set();
    // Test flights first so the cap never drops them.
    const usable = acList
      .filter((a) => a.hex && Number.isFinite(a.lat) && Number.isFinite(a.lon) && Number.isFinite(a.alt_baro))
      .sort((a, b) => (classify(a) === "test" ? 0 : 1) - (classify(b) === "test" ? 0 : 1))
      .slice(0, MAX_JETS);
    for (const a of usable) {
      seen.add(a.hex);
      const kind = classify(a);
      let j = jets.get(a.hex);
      if (!j) {
        try {
          const handle = world.addJet(`live:${a.hex}`, programFor(a.t));
          handle.setHighlight?.(kind);
          j = { handle, kind };
          jets.set(a.hex, j);
        } catch (err) {
          console.warn(`[live] could not add jet ${a.hex}: ${err?.message || err}`);
          continue;
        }
      }
      j.fix = { lat: a.lat, lon: a.lon, altFt: a.alt_baro, gs: Number(a.gs) || 0, track: Number(a.track) || 0, base: a.baro_rate || 0 };
      j.fetchedAt = fetchedAt;
      j.ac = a;
    }
    for (const [hex, j] of jets) {
      if (!seen.has(hex)) { j.handle.dispose?.(); jets.delete(hex); }
    }
  }

  function frame(nowMs) {
    for (const j of jets.values()) {
      const f = j.fix;
      const dt = Math.min(15, (nowMs - j.fetchedAt) / 1000);
      const dist = f.gs * KT_TO_MS * dt;
      const th = (f.track * Math.PI) / 180;
      const p = geo.toLocal(f.lat, f.lon, f.altFt * FT);
      j.handle.setPose({ x: p.x + Math.sin(th) * dist, y: p.y, z: p.z - Math.cos(th) * dist }, f.track, 0, 0);
    }
  }

  function clear() {
    for (const j of jets.values()) j.handle.dispose?.();
    jets.clear();
  }

  return { sync, frame, clear, get count() { return jets.size; }, aircraft: (hex) => jets.get(hex)?.ac || null };
}
