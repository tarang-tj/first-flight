// A Year in Light: the panel (date readout, program counters, scrubber, play).

import { h } from "./dom.js";
import { PROGRAMS } from "./year-model.js";

const MON = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

export function createYearPanel(host, { reduceMotion, onToggle, onScrub, startLabel, endLabel }) {
  const month = h("span.year-month", { text: "---" });
  const year = h("span.year-year", { text: "" });
  const date = h("div.year-date", { "aria-hidden": "true" }, month, year);
  const live = h("p.sr-only", { role: "status", "aria-live": "polite" });
  const cells = Object.fromEntries(PROGRAMS.map((p) => {
    const val = h("span.counter-val.mono", { text: "#0" });
    return [p, { val, shown: 0, el: h("div.counter", {}, h("span.counter-label", { text: p }), val) }];
  }));
  const counters = h("div.counters", { role: "group", "aria-label": "New jets seen, by program" }, PROGRAMS.map((p) => cells[p].el));
  const slider = h("input.scrub", { type: "range", min: "0", max: "1000", value: "0", step: "1", "aria-label": "Timeline, January 2025 to now", "aria-valuetext": startLabel });
  const play = h("button.btn.primary.play", { type: "button", onclick: onToggle, "aria-label": "Play" }, "▶");
  const note = h("p.fine", { text: "Each line is one new jet's first flight. Warm-up days at the start are not counted." });
  let dragging = false;
  slider.addEventListener("pointerdown", () => { dragging = true; });
  addEventListener("pointerup", () => { dragging = false; });
  slider.addEventListener("input", () => onScrub(Number(slider.value) / 1000));

  host.append(h("section.panel.year", {}, h("p.kicker", { text: "A Year in Light" }), date, counters,
    h("div.scrub-row", {}, play, h("div.scrub-wrap", {}, slider, h("div.scrub-ends.mono", {}, h("span", { text: startLabel }), h("span", { text: endLabel })))), note, live));

  return {
    setPlaying(state) { // "playing" | "paused" | "ended"
      play.textContent = state === "playing" ? "❚❚" : state === "ended" ? "↻" : "▶";
      play.setAttribute("aria-label", state === "playing" ? "Pause" : state === "ended" ? "Replay" : "Play");
    },
    setDate(t, fraction) {
      const d = new Date(t * 1000);
      month.textContent = MON[d.getUTCMonth()];
      year.textContent = String(d.getUTCFullYear());
      if (!dragging) slider.value = String(Math.round(fraction * 1000));
      slider.setAttribute("aria-valuetext", `${MON[d.getUTCMonth()]} ${d.getUTCFullYear()}`);
    },
    /** Ease each displayed number toward its target; snap when motion is reduced. */
    setCounts(target, dt) {
      for (const p of PROGRAMS) {
        const c = cells[p];
        const goal = target[p] ?? 0;
        c.shown = reduceMotion ? goal : c.shown + (goal - c.shown) * (1 - Math.exp(-dt * 7));
        if (Math.abs(goal - c.shown) < 0.05) c.shown = goal;
        const txt = `#${Math.round(c.shown)}`;
        if (c.val.textContent !== txt) c.val.textContent = txt;
        c.el.classList.toggle("is-zero", goal === 0);
      }
    },
    announce(text) { live.textContent = text; },
  };
}
