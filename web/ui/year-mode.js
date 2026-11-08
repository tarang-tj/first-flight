// A Year in Light: scrub or play the covered range. Every first flight draws as a
// light trail in time order, then settles into a glow. Months load lazily.

import { clear } from "./dom.js";
import { monthLabel, monthKey, fmtDateKey } from "./format.js";
import { countedFromDate } from "./ledger-model.js";
import { createYearPanel } from "./year-panel.js";
import { timelineBounds, fractionToTime, timeToFraction, countsAt, monthsUpTo, SIM_RATE, programColor, settledGlow } from "./year-model.js";
import { toTrailPoints } from "../air/geo-bridge.js";
import { yearShot, REGION_SHOT } from "./choreo.js";

const REVEAL_S = 1.1, SETTLE_S = 2.6, SPAWN_BUDGET = 30, MAX_TRAILS = 2500;
const ease = (x) => 1 - Math.pow(1 - x, 3);

export function createYearMode(ctx) {
  const { world, geo, ticker, chrome, data, camera } = ctx;
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
  let run = null;

  async function enter() {
    const my = { alive: true, offs: [], timers: [] };
    run = my;
    const nowSec = Date.now() / 1000;
    const bounds = timelineBounds(data.ledger, nowSec);
    const [t0, t1] = bounds;
    const cov = data.ledger?.coverage; // the real covered range, as dates
    const startLabel = cov?.firstDay ? fmtDateKey(cov.firstDay) : monthLabel(monthKey(t0));
    const endLabel = cov?.lastDay ? fmtDateKey(cov.lastDay) : monthLabel(monthKey(t1));
    let T = reduceMotion ? t1 : t0, prevT = T, playing = !reduceMotion, ramp = 0, cursor = 0, started = false, clockS = 0, lastN = -1;
    const loaded = new Map(); // month -> entries[]
    const pending = new Set();
    let all = [];
    const shown = new Map(); // id -> { trail, t0, born, settled }
    let lastDim = 0;
    const animating = new Set();

    const panel = createYearPanel(chrome.stage, {
      reduceMotion, startLabel, endLabel, countedFrom: data.ledger ? fmtDateKey(countedFromDate(data.ledger)) : null,
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
        const trail = world?.addTrail?.(`y:${id}`, toTrailPoints(geo, row.pts), { color: programColor(row.program), glow: 1, width: 2.6 });
        const item = { trail, t0: row.t0, born: performance.now(), settled: !animate };
        if (animate) animating.add(item); else { trail?.setProgress?.(1); trail?.setOpacity?.(settledGlow(shown.size + 1)); }
        shown.set(id, item);
        return true;
      } catch (err) { console.warn(`[year] trail failed: ${err?.message || err}`); return false; }
    }

    // The film opens over the region and rises to the state view as the year plays.
    camera.drive(() => yearShot(timeToFraction(T, bounds), clockS, innerWidth / innerHeight), { snap: true, rate: 2.5 });
    camera.setFraming(...(innerWidth >= 820 ? [0, 0.1] : [0, 0.2]));
    try { world?.snapTo?.(REGION_SHOT); } catch (e) { console.warn(`[year] ${e?.message || e}`); }
    Promise.resolve(ctx.whenReady).then(() => { started = true; });

    my.offs.push(ticker.add((dt, nowMs) => {
      for (const k of monthsNeeded()) ensure(k);
      const next = monthKey(Math.min(t1, T + SIM_RATE * 2));
      ensure(next);
      clockS += dt;
      if (playing && started && ready()) {
        ramp = Math.min(1, ramp + dt / 1.2);
        T = Math.min(t1, T + SIM_RATE * dt * ease(ramp));
        if (T >= t1) { playing = false; sync(); panel.announce(`Reached ${endLabel}.`); }
      }
      const done = T >= t1 - 1 && !playing;
      if (done && shown.size !== lastN) { // summary line: refresh while the last months finish loading
        lastN = shown.size;
        const mo = monthsUpTo(bounds, t1).length;
        panel.setFinal(lastN ? `${lastN.toLocaleString("en-US")} first flights in light, over ${mo} ${mo === 1 ? "month" : "months"}` : "");
      } else if (!done && lastN >= 0) { lastN = -1; panel.setFinal(""); }
      if (T < prevT - 1) { // scrubbed backwards: drop what has not happened yet
        for (const [id, it] of shown) if (it.t0 > T) { it.trail?.dispose?.(); animating.delete(it); shown.delete(id); }
        cursor = 0;
        lastDim = -Infinity; // fewer trails now: re-brighten on the next frame
      }
      prevT = T;
      const animate = playing;
      for (let n = 0; cursor < all.length && all[cursor].t0 <= T && n < SPAWN_BUDGET; cursor++) {
        if (spawn(all[cursor], animate && T - all[cursor].t0 < SIM_RATE * 1.5)) n++;
      }
      // As trails pile up, dim the settled ones so the painting never blows out to white.
      if (shown.size - lastDim >= 40) {
        lastDim = shown.size;
        const g = settledGlow(shown.size);
        for (const it of shown.values()) if (it.settled) it.trail?.setOpacity?.(g);
      }
      for (const it of animating) {
        const age = (nowMs - it.born) / 1000;
        it.trail?.setProgress?.(ease(Math.min(1, age / REVEAL_S)));
        const g = settledGlow(shown.size);
        it.trail?.setOpacity?.(age < REVEAL_S ? 1 : 1 - (1 - g) * ease(Math.min(1, (age - REVEAL_S) / SETTLE_S)));
        if (age > REVEAL_S + SETTLE_S) { it.settled = true; animating.delete(it); }
      }
      const f = timeToFraction(T, bounds);
      panel.setDate(T, f);
      panel.setCounts(countsAt(data.airframes, T, data.ledger, bounds), dt);
      camera.step(dt);
    }));

    my.dispose = () => { panel.dispose(); for (const it of shown.values()) it.trail?.dispose?.(); shown.clear(); animating.clear(); };
  }

  function exit() {
    if (!run) return;
    run.alive = false;
    run.offs.forEach((f) => f());
    run.timers.forEach(clearTimeout);
    camera.release();
    run.dispose?.();
    clear(chrome.stage);
    run = null;
  }

  return { enter, exit };
}
