// One program's chart: orange bars = first flights seen, white dots = Boeing reported deliveries.
// The warm-up month is grey. Tap or hover a column to read its month. Returns a wrapper element
// (readout + SVG) plus a hidden-by-default table.

import { h, svg } from "./dom.js";
import { monthLabel } from "./format.js";

const W = 360, H = 224, L = 30, R = 8, T = 12, B = 28;

export function niceMax(v) {
  if (v <= 5) return 5;
  const step = v <= 20 ? 5 : v <= 60 ? 10 : 20;
  return Math.ceil((v * 1.1) / step) * step;
}

/** Months between axis labels: a divisor of 12 so labels land on Jan, Apr, Jul... and never crowd (~6 at most). */
export const labelStep = (n) => [1, 2, 3, 4, 6, 12].find((s) => s >= Math.ceil(n / 6)) ?? 12;

/** Label for a month column, or null when this column is not labelled. January carries the year. */
export function axisLabel(month, step) {
  const m = Number(month.slice(5, 7));
  if ((m - 1) % step !== 0) return null;
  const full = monthLabel(month); // "Apr 2025"
  return m === 1 ? full.replace(/ 20/, " '") : full.slice(0, 3);
}

export function readoutText(r) {
  if (!r) return "";
  const rep = r.reported === null ? "no Boeing figure for this month" : `Boeing reported ${r.reported}`;
  return `${monthLabel(r.month)}: ${r.seen} first ${r.seen === 1 ? "flight" : "flights"} seen, ${rep}${r.warmup ? (r.partial ? ` (partial month${r.countedFrom ? `, counted from ${r.countedFrom}` : ""}, not compared)` : " (warm-up, not counted)") : ""}`;
}

export function ledgerChart(program, series, label) {
  const n = Math.max(series.length, 1);
  const top = niceMax(Math.max(1, ...series.map((r) => Math.max(r.seen, r.reported ?? 0))));
  const pw = W - L - R, ph = H - T - B;
  const slot = pw / n, bw = Math.min(20, Math.max(5, slot * 0.66));
  const x = (i) => L + slot * i + slot / 2;
  const y = (v) => T + ph - (v / top) * ph;
  const gid = `bg-${program}`;

  const kids = [svg("defs", {}, svg("linearGradient", { id: gid, x1: 0, y1: 0, x2: 0, y2: 1 },
    svg("stop", { offset: "0", "stop-color": "#ff9a52" }), svg("stop", { offset: "1", "stop-color": "#ff5a0a" })))];
  for (const g of [0, 0.5, 1]) {
    const v = Math.round(top * g);
    kids.push(svg("line", { class: "gridline", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    kids.push(svg("text", { class: "axis", x: L - 6, y: y(v) + 4, "text-anchor": "end" }, v));
  }
  const readout = h("p.chart-read", { role: "status", "aria-live": "polite" });
  const cols = [];
  const pick = (i) => {
    cols.forEach((c, k) => c.classList.toggle("is-on", k === i));
    readout.replaceChildren(...(i === null ? ["Tap a bar to read that month."] : [readoutText(series[i])]));
  };
  const step = labelStep(series.length);
  series.forEach((r, i) => {
    const bh = Math.max(r.seen > 0 ? 2 : 0, y(0) - y(r.seen));
    const col = svg("g", { class: "col", tabindex: 0, role: "button", "aria-label": readoutText(r) },
      svg("rect", { class: "hit", x: x(i) - slot / 2, y: T, width: slot, height: ph + B - 6 }),
      svg("rect", { class: r.warmup ? "bar warm" : "bar", style: r.warmup ? null : `fill:url(#${gid});--i:${i}`, x: x(i) - bw / 2, y: y(0) - bh, width: bw, height: bh, rx: 3 }));
    col.addEventListener("pointerenter", () => pick(i));
    col.addEventListener("click", () => pick(i));
    col.addEventListener("focus", () => pick(i));
    cols.push(col);
    kids.push(col);
    const tick = axisLabel(r.month, step);
    if (tick) kids.push(svg("text", { class: "axis", x: x(i), y: H - 9, "text-anchor": "middle" }, tick));
  });
  const rep = series.map((r, i) => (r.reported === null ? null : [x(i), y(r.reported), r])).filter(Boolean);
  if (rep.length > 1) kids.push(svg("polyline", { class: "rep-line", points: rep.map((p) => `${p[0]},${p[1]}`).join(" ") }));
  for (const [cx, cy] of rep) kids.push(svg("circle", { class: "rep-dot", cx, cy, r: 4 }));
  const chart = h("div.chart-wrap", {}, readout,
    svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "group", class: "chart", "aria-label": label, preserveAspectRatio: "xMidYMid meet" }, kids));
  const last = series.map((r, i) => (r.warmup ? -1 : i)).filter((i) => i >= 0).pop();
  pick(last === undefined ? null : last);

  const table = h("table.data", {},
    h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Month" }), h("th", { scope: "col", text: "Seen" }), h("th", { scope: "col", text: "Reported" }))),
    h("tbody", {}, series.map((r) => h("tr", {}, h("th", { scope: "row", text: monthLabel(r.month) + (r.partial ? " (partial)" : r.warmup ? " (warm-up)" : "") }), h("td", { text: r.seen }),
      h("td", {}, r.reported === null ? "none" : r.source ? h("a", { href: r.source, target: "_blank", rel: "noopener" }, String(r.reported)) : String(r.reported))))));
  return { chart, table };
}
