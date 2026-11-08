// A Year in Light: pure timeline maths (no DOM).

import { monthStart, monthKey } from "./format.js";
import { warmupEnd } from "./ledger-model.js";

export const PROGRAMS = ["737", "767", "777", "777X"];
export const MONTH_REAL_S = 2; // playback: one month per ~2 real seconds
const AVG_MONTH_S = 30.44 * 86400;
export const SIM_RATE = AVG_MONTH_S / MONTH_REAL_S; // sim seconds per real second

/** [start, end] in unix seconds. Falls back to Jan 2025 .. now when no ledger. */
export function timelineBounds(ledger, nowSec) {
  const first = ledger?.coverage?.firstDay;
  const last = ledger?.coverage?.lastDay;
  // 08:00 UTC is 00:00 PST / 01:00 PDT: still the same Pacific day, so month keys stay right.
  const start = first ? Date.parse(`${first}T08:00:00Z`) / 1000 : monthStart("2025-01") + 12 * 3600;
  const end = last ? Date.parse(`${last}T23:59:59Z`) / 1000 : nowSec;
  return [start, Math.max(end, start + 86400)];
}

export const fractionToTime = (f, [a, b]) => a + Math.min(1, Math.max(0, f)) * (b - a);
export const timeToFraction = (t, [a, b]) => (b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0);

/**
 * New-jet first flights counted up to time t, per program. Only airframes the
 * ledger counts (counted: true) are included, so the numbers agree on screen.
 */
export function countsAt(airframes, t, ledger, bounds) {
  const from = ledger ? warmupEnd(ledger) : bounds[0] + 30 * 86400;
  const out = Object.fromEntries(PROGRAMS.map((p) => [p, 0]));
  for (const a of airframes) {
    if (a.counted !== true || !(a.program in out)) continue; // same rule as the ledger
    const ft = a.firstFlight?.t;
    if (ft >= from && ft <= t) out[a.program]++;
  }
  return out;
}

/** Months (keys) that must be loaded to show everything up to time t. */
export function monthsUpTo(bounds, t) {
  const out = [];
  let [y, m] = monthKey(bounds[0]).split("-").map(Number);
  const end = monthKey(Math.min(t, bounds[1]));
  for (let guard = 0; guard < 600; guard++) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= end) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

/** Trail colour per program, so the light painting reads as four production lines. */
export const PROGRAM_COLORS = { "737": "#ff6a1a", "767": "#ffc94a", "777": "#5cd0ff", "777X": "#c58bff" };
export const programColor = (p) => PROGRAM_COLORS[p] || "#ffe2c4";

/**
 * Opacity a settled trail glows at when `n` trails are on screen. Trails add
 * light, so hundreds of them at a fixed opacity blow out to white over the
 * Renton and Boeing Field corridor. Scale by 1/sqrt(n) past 40 trails, floor 0.035.
 */
export function settledGlow(n, base = 0.42) {
  return Math.max(0.035, base * Math.sqrt(40 / Math.max(40, n)));
}
