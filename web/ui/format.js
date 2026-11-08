// Pure formatting helpers (no DOM), shared by the UI and its tests.

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export const AIRPORTS = Object.freeze({
  KRNT: "Renton",
  KPAE: "Paine Field",
  KBFI: "Boeing Field",
  KSEA: "Sea-Tac",
  KGRF: "Gray Army Airfield",
  KMWH: "Moses Lake",
});

export function airportName(code) {
  if (!code) return "an unknown field";
  return AIRPORTS[String(code).toUpperCase()] || String(code).toUpperCase();
}

/** "6 h ago" style age; all inputs from data, never hard-coded. */
export function relativeAgo(nowMs, thenSec) {
  const s = Math.round((nowMs - thenSec * 1000) / 1000);
  if (!Number.isFinite(s)) return "";
  if (s < 0) return "just now";
  if (s < 90) return s < 10 ? "just now" : `${s} s ago`;
  const min = Math.round(s / 60);
  if (min < 90) return `${min} min ago`;
  const hr = Math.round(s / 3600);
  if (hr < 48) return `${hr} h ago`;
  const d = Math.round(s / 86400);
  if (d < 60) return `${d} days ago`;
  return `${Math.round(d / 30)} months ago`;
}

export function fmtDuration(sec) {
  if (!Number.isFinite(sec) || sec <= 0) return "unknown";
  const m = Math.round(sec / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  return `${h} h ${String(m % 60).padStart(2, "0")} min`;
}

export function fmtAlt(ft) {
  return Number.isFinite(ft) ? `${Math.round(ft).toLocaleString("en-US")} ft` : "unknown";
}

/** Local Pacific time, e.g. "Oct 28, 2026, 9:14 AM PDT". */
export function fmtWhen(sec) {
  if (!Number.isFinite(sec)) return "unknown";
  return new Date(sec * 1000).toLocaleString("en-US", {
    timeZone: "America/Los_Angeles", month: "short", day: "numeric", year: "numeric",
    hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
}

export const ZONE = "America/Los_Angeles";

/** Calendar day in Pacific time, the same zone as fmtWhen and the month buckets. */
export function fmtDay(sec) {
  if (!Number.isFinite(sec)) return "unknown";
  return new Date(sec * 1000).toLocaleDateString("en-US", { timeZone: ZONE, month: "short", day: "numeric", year: "numeric" });
}

/** "2026-11-05" (a calendar date, no zone) -> "Nov 5, 2026". */
export function fmtDateKey(key) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(key ?? ""));
  return m ? `${MONTHS[Number(m[2]) - 1] || "?"} ${Number(m[3])}, ${m[1]}` : "unknown";
}

/** "2025-03" -> "Mar 2025" */
export function monthLabel(key) {
  const [y, m] = String(key).split("-");
  return `${MONTHS[Number(m) - 1] || "?"} ${y}`;
}

const MONTH_PARTS = new Intl.DateTimeFormat("en-US", { timeZone: ZONE, year: "numeric", month: "2-digit" });

/** "YYYY-MM" of a moment in Pacific time (Boeing's months are local). */
export function monthKey(sec) {
  const parts = Object.fromEntries(MONTH_PARTS.formatToParts(new Date(sec * 1000)).map((p) => [p.type, p.value]));
  return `${parts.year}-${parts.month}`;
}

/** Unix seconds at 00:00 UTC on the first day of "YYYY-MM". */
export function monthStart(key) {
  const [y, m] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, 1) / 1000;
}

/** Every "YYYY-MM" from the month of fromSec through the month of toSec. */
export function monthRange(fromSec, toSec) {
  const out = [];
  let [y, m] = monthKey(fromSec).split("-").map(Number);
  const end = monthKey(toSec);
  for (;;) {
    const k = `${y}-${String(m).padStart(2, "0")}`;
    out.push(k);
    if (k >= end || out.length > 600) break;
    if (++m > 12) { m = 1; y++; }
  }
  return out;
}

export function pct(n, d) {
  return d > 0 ? `${Math.round((n / d) * 100)}%` : "n/a";
}

/** "Renton to Boeing Field", "out of Boeing Field", "into Renton", or a local flight. */
export function routeText(from, to) {
  if (from && to && from !== to) return `${airportName(from)} to ${airportName(to)}`;
  if (from && to) return `local flight from ${airportName(from)}`;
  if (from) return `out of ${airportName(from)}`;
  if (to) return `into ${airportName(to)}`;
  return "route not recorded";
}

/** Stopwatch style: 754 -> "12:34", 4000 -> "1:06:40". */
export function fmtClock(sec) {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), r = s % 60;
  const two = (n) => String(n).padStart(2, "0");
  return h ? `${h}:${two(m)}:${two(r)}` : `${m}:${two(r)}`;
}

/** World pick ids are "live:hex", "ride:hex" or "replay:hex:i": the hex is always the second part. */
export function hexOfPickId(id) {
  const parts = String(id ?? "").split(":");
  return (parts.length > 1 ? parts[1] : parts[0]).toLowerCase();
}
