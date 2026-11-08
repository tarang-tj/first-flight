// Ledger maths, no DOM. Sky counts (first flights seen) vs Boeing reported deliveries.

import { monthStart, pct, fmtDateKey } from "./format.js";

const DAY = 86400;
export const WARMUP_DAYS = 30;

/** Unix seconds at which the warm-up window ends (first 30 days are not counted). */
export function warmupEnd(ledger) {
  const first = ledger?.coverage?.firstDay;
  const t = first ? Date.parse(`${first}T00:00:00Z`) / 1000 : monthStart(ledger?.months?.[0]?.month || "2025-01");
  return t + WARMUP_DAYS * DAY;
}

function nextMonthStart(key) {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, m, 1) / 1000;
}

/** "YYYY-MM-DD" from which airframes are counted: a partial month's own date, else coverage start + 30 days. */
// The ledger build writes `warmupPartial`; `partial` is accepted too.
export const isPartial = (m) => m?.warmupPartial === true || m?.partial === true;

export function countedFromDate(ledger) {
  const p = (ledger?.months || []).find((m) => isPartial(m) && /^\d{4}-\d{2}-\d{2}/.test(String(m.countedFrom || "")));
  if (p) return String(p.countedFrom).slice(0, 10);
  return new Date(warmupEnd(ledger) * 1000).toISOString().slice(0, 10);
}

const isExcluded = (m, wEnd) => isPartial(m) || (typeof m.warmup === "boolean" ? m.warmup : nextMonthStart(m.month) <= wEnd + DAY);

/**
 * Paine Field first flights whose type is not known yet, over the months that are compared.
 * null when the ledger carries no unknown figure at all (older data).
 */
export function unknownSeen(ledger) {
  const months = ledger?.months || [];
  if (!months.some((m) => Number.isFinite(m.firstFlights?.unknown))) return null;
  const wEnd = warmupEnd(ledger);
  return months.filter((m) => !isExcluded(m, wEnd)).reduce((a, m) => a + Number(m.firstFlights?.unknown ?? 0), 0);
}

export function unknownLine(n) {
  if (n === null) return null;
  return `Paine Field jets whose type is not known yet: ${n}. They are not in any program card or in the comparison below.`;
}

/** One row per month for a program. reported is null when Boeing has no figure. */
export function buildSeries(ledger, program) {
  const wEnd = warmupEnd(ledger);
  return (ledger?.months || []).map((m) => {
    const rep = m.reported && Number.isFinite(m.reported[program]) ? m.reported[program] : null;
    return {
      month: m.month,
      seen: Number(m.firstFlights?.[program] ?? 0),
      reported: rep,
      source: m.reportedSource || null,
      warmup: isExcluded(m, wEnd),
      partial: isPartial(m),
      countedFrom: isPartial(m) ? String(m.countedFrom || "").slice(0, 10) || null : null,
    };
  });
}

/** Totals over months that are counted (not warm-up) and have a reported figure. */
export function summarize(series) {
  const rows = series.filter((r) => !r.warmup && r.reported !== null);
  const seen = rows.reduce((a, r) => a + r.seen, 0);
  const reported = rows.reduce((a, r) => a + r.reported, 0);
  return { months: rows.length, seen, reported, gap: reported - seen, ratio: reported > 0 ? seen / reported : null };
}

/** The one plain sentence per program. */
export function gapSentence(program, s, unknown = 0) {
  const tail = unknown > 0 ? ` ${unknown} more ${unknown === 1 ? "first flight" : "first flights"} of unknown type ${unknown === 1 ? "is" : "are"} excluded from the per-program comparison.` : "";
  return gapCore(program, s) + tail;
}

function gapCore(program, s) {
  if (s.months === 0) return `No counted month has a Boeing ${program} delivery figure yet, so there is nothing to compare.`;
  const unit = s.months === 1 ? "month" : "months";
  if (s.gap === 0) return `Over ${s.months} ${unit} the sky count matched Boeing's reported ${program} deliveries exactly: ${s.seen}.`;
  const dir = s.gap > 0 ? "fewer" : "more";
  return `Over ${s.months} ${unit} we saw ${s.seen} first flights against ${s.reported} reported deliveries, ${Math.abs(s.gap)} ${dir} (${pct(s.seen, s.reported)} of the reported count).`;
}

export const EXPLAINER = "First flights and deliveries are different events: a jet flies weeks before it is handed over, and a receiver can miss a flight, so the two lines should track over a year rather than match month by month.";

export function coverageLine(ledger) {
  const c = ledger?.coverage;
  if (!c) return "Coverage information is not available.";
  const missing = (c.daysMissing || []).length;
  const base = `Receiver data scanned for ${c.daysScanned} days between ${c.firstDay} and ${c.lastDay}.`;
  return missing ? `${base} ${missing} ${missing === 1 ? "day is" : "days are"} missing and counted as zero flights.` : `${base} No days are missing.`;
}

/** The warm-up sentence: exact date counting starts, not a rounded "30 days". */
export function warmupLine(ledger) {
  return `Counting starts on ${fmtDateKey(countedFromDate(ledger))}; earlier and partial months are shown in grey and left out of the comparison.`;
}
