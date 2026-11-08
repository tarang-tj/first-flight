// The time control: big date and Pacific time, a scrubber over the whole data span with the monthly
// flight density drawn behind it, play/pause, rate buttons, a busiest-moments list and "Now".
import { h } from "./dom.js";
import { ZONE } from "./format.js";
import { RATES, RATE_LABELS } from "../air/sky-clock.js";

const dateOf = (t) => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: ZONE, month: "short", day: "numeric", year: "numeric" });
const timeOf = (t) => new Date(t * 1000).toLocaleTimeString("en-US", { timeZone: ZONE, hour: "numeric", minute: "2-digit", second: "2-digit", timeZoneName: "short" });
const shortOf = (t) => new Date(t * 1000).toLocaleDateString("en-US", { timeZone: ZONE, month: "short", day: "numeric", year: "2-digit" });

/** Bars for the density sparkline: flex weight = how much of the month lies inside the span. */
export function densityBars(index) {
  const [t0, t1] = index.span, max = Math.max(1, ...index.months.map((m) => m.flights));
  return index.months.map((m) => {
    const [y, mo] = m.key.split("-").map(Number);
    const a = Date.UTC(y, mo - 1, 1, 8) / 1000, b = Date.UTC(y, mo, 1, 8) / 1000;
    return { key: m.key, flights: m.flights, weight: Math.max(0, Math.min(b, t1) - Math.max(a, t0)), height: m.flights / max };
  }).filter((b) => b.weight > 0);
}

export function createTimeDial({ clock, index, onChange }) {
  const [t0, t1] = clock.span;
  const date = h("div.td-date");
  const time = h("div.td-time");
  const count = h("div.td-count", { role: "status", "aria-live": "off" });
  const bars = h("div.td-bars", { "aria-hidden": "true" }, densityBars(index).map((b) =>
    h("i", { style: `flex-grow:${b.weight};--h:${(8 + b.height * 92).toFixed(0)}%`, title: `${b.key}: ${b.flights} flights` })));
  const range = h("input.td-range", { type: "range", min: t0, max: t1, step: 60, value: clock.t, "aria-label": "Moment in time" });
  range.addEventListener("input", () => { clock.set(Number(range.value)); onChange?.("scrub"); });
  
  const play = h("button.td-btn.td-play", { type: "button", "aria-label": "Pause", onclick: () => { clock.toggle(); onChange?.("play"); } });
  const rateBtns = RATES.map((r) => h("button.td-rate", { type: "button", "data-rate": r, onclick: () => { clock.setRate(r); onChange?.("rate"); } }, RATE_LABELS[r]));
  const now = h("button.td-btn.td-now", { type: "button", onclick: () => { clock.set(t1); clock.pause(); onChange?.("now"); } }, "Now");
  const close = () => { root.classList.remove("is-open"); more.setAttribute("aria-expanded", "false"); };
  const more = h("button.td-more", { type: "button", "aria-expanded": "false", onclick: () => {
    const open = root.classList.toggle("is-open");
    more.setAttribute("aria-expanded", String(open));
  } }, "Busiest");
  const onKey = (e) => { if (e.key === "Escape") close(); };
  const onAway = (e) => { if (!root.contains(e.target)) close(); };
  addEventListener("keydown", onKey);
  addEventListener("pointerdown", onAway);
  const moments = [...(index.moments || [])].sort((a, b) => b.n - a.n || b.t - a.t).slice(0, 12);
  const jumps = h("div.td-jumps", { role: "list" }, moments.map((m) =>
    h("button.td-jump", { type: "button", role: "listitem", onclick: () => { clock.set(m.t); close(); onChange?.("jump"); } },
      h("b", { text: String(m.n) }), h("span", { text: shortOf(m.t) }))));

  const popover = h("div.td-pop", { role: "dialog", "aria-label": "Busiest moments" },
    h("div.td-label", { text: "Most jets in the air at once" }), jumps);
  const root = h("section.time-dial", { "aria-label": "Time machine" },
    popover,
    h("div.td-head", {}, h("div.td-when", {}, date, time), count),
    h("div.td-track", { title: `${dateOf(t0)} to ${dateOf(t1)}` }, bars, range),
    h("div.td-row", {}, play, h("div.td-rates", { role: "group", "aria-label": "Speed" }, rateBtns), now, more));

  let last = {};
  function update(n, near) {
    const t = clock.t, sec = Math.floor(t);
    if (last.sec !== sec) { last.sec = sec; date.textContent = dateOf(t); time.textContent = timeOf(t); }
    if (document.activeElement !== range) range.value = t;
    const frac = (t - t0) / (t1 - t0);
    range.style.setProperty("--p", `${(frac * 100).toFixed(2)}%`);
    if (last.playing !== clock.playing) {
      last.playing = clock.playing;
      play.textContent = clock.playing ? "Pause" : "Play";
      play.setAttribute("aria-label", clock.playing ? "Pause" : "Play");
    }
    if (last.rate !== clock.rate) { last.rate = clock.rate; rateBtns.forEach((b) => b.classList.toggle("is-on", Number(b.dataset.rate) === clock.rate)); }
    const key = `${n}/${near}`;
    if (last.n !== key && n !== undefined) {
      last.n = key;
      const base = n === 1 ? "1 Boeing jet in the air" : `${n} Boeing jets in the air`;
      count.textContent = near !== undefined && near !== n ? `${base} (${near} near Puget Sound)` : base;
      count.classList.toggle("is-zero", n === 0);
    }
  }
  update();
  /** Brief note over the dial, e.g. when the clock skips quiet hours. */
  let flashTimer = 0;
  function flash(text) {
    let n = root.querySelector(".td-flash");
    if (!n) { n = document.createElement("div"); n.className = "td-flash"; n.setAttribute("role", "status"); root.append(n); }
    n.textContent = text; n.classList.add("is-on");
    clearTimeout(flashTimer); flashTimer = setTimeout(() => n.classList.remove("is-on"), 1800);
  }
  return { el: root, update, flash, dispose() { removeEventListener("keydown", onKey); removeEventListener("pointerdown", onAway); clearTimeout(flashTimer); root.remove(); } };
}
