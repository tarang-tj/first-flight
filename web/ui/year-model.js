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
  const start = first ? Date.parse(`${first}T00:00:00Z`) / 1000 : monthStart("2025-01");
  const end = last ? Date.parse(`${last}T23:59:59Z`) / 1000 : nowSec;
  return [start, Math.max(end, start + 86400)];
}

export const fractionToTime = (f, [a, b]) => a + Math.min(1, Math.max(0, f)) * (b - a);
export const timeToFraction = (t, [a, b]) => (b > a ? Math.min(1, Math.max(0, (t - a) / (b - a))) : 0);

/**
 * New-jet first flights counted up to time t, per program. Flight-test fleet
 * aircraft are excluded, and so is the 30-day warm-up window.
 */
export function countsAt(airframes, t, ledger, bounds) {
  const from = ledger ? warmupEnd(ledger) : bounds[0] + 30 * 86400;
  const out = Object.fromEntries(PROGRAMS.map((p) => [p, 0]));
  for (const a of airframes) {
    if (a.flightTest || !(a.program in out)) continue;
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
