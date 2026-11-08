// One program's chart: orange bars = first flights seen, white dots = Boeing reported
// deliveries. The warm-up month is grey. Returns an SVG plus a hidden-by-default table.

import { h, svg } from "./dom.js";
import { monthLabel } from "./format.js";

const W = 380, H = 200, L = 28, R = 6, T = 10, B = 24;

function niceMax(v) {
  if (v <= 5) return 5;
  const step = v <= 20 ? 5 : v <= 60 ? 10 : 20;
  return Math.ceil((v * 1.1) / step) * step;
}

export function ledgerChart(program, series, label) {
  const n = Math.max(series.length, 1);
  const top = niceMax(Math.max(1, ...series.map((r) => Math.max(r.seen, r.reported ?? 0))));
  const pw = W - L - R, ph = H - T - B;
  const slot = pw / n, bw = Math.min(18, slot * 0.62);
  const x = (i) => L + slot * i + slot / 2;
  const y = (v) => T + ph - (v / top) * ph;

  const kids = [];
  for (const g of [0, 0.5, 1]) {
    const v = Math.round(top * g);
    kids.push(svg("line", { class: "grid", x1: L, x2: W - R, y1: y(v), y2: y(v) }));
    kids.push(svg("text", { class: "axis", x: L - 6, y: y(v) + 3, "text-anchor": "end" }, v));
  }
  series.forEach((r, i) => {
    kids.push(svg("rect", { class: r.warmup ? "bar warm" : "bar", x: x(i) - bw / 2, y: y(r.seen), width: bw, height: Math.max(0, y(0) - y(r.seen)), rx: 2 }, svg("title", {}, `${monthLabel(r.month)}: ${r.seen} first flights seen${r.warmup ? " (warm-up, not counted)" : ""}`)));
    if (i % 4 === 0) kids.push(svg("text", { class: "axis", x: x(i), y: H - 7, "text-anchor": "middle" }, monthLabel(r.month).replace(/ 20/, " '")));
  });
  const rep = series.map((r, i) => (r.reported === null ? null : [x(i), y(r.reported), r])).filter(Boolean);
  if (rep.length > 1) kids.push(svg("polyline", { class: "rep-line", points: rep.map((p) => `${p[0]},${p[1]}`).join(" ") }));
  for (const [cx, cy, r] of rep) {
    kids.push(svg("circle", { class: "rep-dot", cx, cy, r: 3.6 }, svg("title", {}, `${monthLabel(r.month)}: Boeing reported ${r.reported} deliveries`)));
  }
  const chart = svg("svg", { viewBox: `0 0 ${W} ${H}`, role: "img", class: "chart", "aria-label": label, preserveAspectRatio: "xMidYMid meet" }, kids);

  const table = h("table.data", {},
    h("thead", {}, h("tr", {}, h("th", { scope: "col", text: "Month" }), h("th", { scope: "col", text: "Seen" }), h("th", { scope: "col", text: "Reported" }))),
    h("tbody", {}, series.map((r) => h("tr", {}, h("th", { scope: "row", text: monthLabel(r.month) + (r.warmup ? " (warm-up)" : "") }), h("td", { text: r.seen }),
      h("td", {}, r.reported === null ? "none" : r.source ? h("a", { href: r.source, target: "_blank", rel: "noopener" }, String(r.reported)) : String(r.reported))))));
  return { chart, table };
}
