// A Year in Light: scrub or play Jan 2025 to now. Every first flight draws as a
// light trail in time order, then settles into a glow. Months load lazily.

import { clear } from "./dom.js";
import { monthLabel, monthKey } from "./format.js";
import { createYearPanel } from "./year-panel.js";
import { timelineBounds, fractionToTime, timeToFraction, countsAt, monthsUpTo, SIM_RATE } from "./year-model.js";
import { toTrailPoints } from "../air/geo-bridge.js";

const REVEAL_S = 1.1, SETTLE_S = 2.6, GLOW = 0.42, SPAWN_BUDGET = 30, MAX_TRAILS = 2500;
const ease = (x) => 1 - Math.pow(1 - x, 3);

export function createYearMode(ctx) {
  const { world, geo, ticker, chrome, data } = ctx;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let run = null;

  async function enter() {
    const my = { alive: true, offs: [], timers: [] };
    run = my;
    const nowSec = Date.now() / 1000;
    const bounds = timelineBounds(data.ledger, nowSec);
    const [t0, t1] = bounds;
    const startLabel = monthLabel(monthKey(t0));
    const endLabel = monthLabel(monthKey(t1));
    let T = reduceMotion ? t1 : t0, prevT = T, playing = !reduceMotion, ramp = 0, cursor = 0;
    const loaded = new Map(); // month -> entries[]
    const pending = new Set();
    let all = [];
    const shown = new Map(); // id -> { trail, t0, born, settled }
    const animating = new Set();

    const panel = createYearPanel(chrome.stage, {
      reduceMotion, startLabel, endLabel,
      onToggle: () => { if (T >= t1 - 1) { T = t0; prevT = T; } playing = !playing; ramp = 0; sync(); },
      onScrub: (f) => { playing = false; T = fractionToTime(f, bounds); ramp = 0; sync(); },
    });
    const sync = () => panel.setPlaying(playing ? "playing" : T >= t1 - 1 ? "ended" : "paused");
    sync();

    function ensure(key) {
      if (loaded.has(key) || pending.has(key)) return;
      const known = data.ledger?.months?.map((m) => m.month);
      if (known && !known.includes(key)) { loaded.set(key, []); return; } // no file for this month: do not request it
      pending.add(key);
      ctx.loadMonth(key).then((rows) => {
        pending.delete(key);
        if (!my.alive) return;
        loaded.set(key, Array.isArray(rows) ? rows.filter((r) => r && r.pts?.length > 1) : []);
        all = [...loaded.values()].flat().sort((a, b) => a.t0 - b.t0);
        cursor = 0;
      });
    }
    const monthsNeeded = () => monthsUpTo(bounds, T);
    const ready = () => monthsNeeded().every((k) => loaded.has(k));

    function spawn(row, animate) {
      const id = `${row.hex}:${row.t0}`;
      if (shown.has(id) || shown.size >= MAX_TRAILS) return false;
      try {
        const trail = world?.addTrail?.(`y:${id}`, toTrailPoints(geo, row.pts), { color: "#ff6a1a", glow: 1 });
        const item = { trail, t0: row.t0, born: performance.now(), settled: !animate };
        if (animate) animating.add(item); else { trail?.setProgress?.(1); trail?.setOpacity?.(GLOW); }
        shown.set(id, item);
        return true;
      } catch (err) { console.warn(`[year] trail failed: ${err?.message || err}`); return false; }
    }

    if (world?.setView) { try { world.setView("state"); } catch (e) { console.warn(`[year] ${e?.message || e}`); } }
    const drift = (n = 0) => {
      if (!my.alive || reduceMotion || !world?.flyTo || ctx.rideActive()) return;
      const c = geo.toLocal(47.55, -121.9, 0);
      try { world.flyTo({ target: { x: c.x, y: 0, z: c.z }, distance: 330000, headingDeg: n % 2 ? 18 : -14, pitchDeg: 50 }, 11000); }
      catch (e) { console.warn(`[year] camera: ${e?.message || e}`); }
      my.timers.push(setTimeout(() => drift(n + 1), 11000));
    };
    drift();

    my.offs.push(ticker.add((dt, nowMs) => {
      for (const k of monthsNeeded()) ensure(k);
      const next = monthKey(Math.min(t1, T + SIM_RATE * 2));
      ensure(next);
      if (playing && ready()) {
        ramp = Math.min(1, ramp + dt / 1.2);
        T = Math.min(t1, T + SIM_RATE * dt * ease(ramp));
        if (T >= t1) { playing = false; sync(); panel.announce(`Reached ${endLabel}.`); }
      }
      if (T < prevT - 1) { // scrubbed backwards: drop what has not happened yet
        for (const [id, it] of shown) if (it.t0 > T) { it.trail?.dispose?.(); animating.delete(it); shown.delete(id); }
        cursor = 0;
      }
      prevT = T;
      const animate = playing;
      for (let n = 0; cursor < all.length && all[cursor].t0 <= T && n < SPAWN_BUDGET; cursor++) {
        if (spawn(all[cursor], animate && T - all[cursor].t0 < SIM_RATE * 1.5)) n++;
      }
      for (const it of animating) {
        const age = (nowMs - it.born) / 1000;
        it.trail?.setProgress?.(ease(Math.min(1, age / REVEAL_S)));
        it.trail?.setOpacity?.(age < REVEAL_S ? 1 : 1 - (1 - GLOW) * ease(Math.min(1, (age - REVEAL_S) / SETTLE_S)));
        if (age > REVEAL_S + SETTLE_S) { it.settled = true; animating.delete(it); }
      }
      const f = timeToFraction(T, bounds);
      panel.setDate(T, f);
      panel.setCounts(countsAt(data.airframes, T, data.ledger, bounds), dt);
    }));

    my.dispose = () => { for (const it of shown.values()) it.trail?.dispose?.(); shown.clear(); animating.clear(); };
  }

  function exit() {
    if (!run) return;
    run.alive = false;
    run.offs.forEach((f) => f());
    run.timers.forEach(clearTimeout);
    run.dispose?.();
    clear(chrome.stage);
    run = null;
  }

  return { enter, exit };
}
