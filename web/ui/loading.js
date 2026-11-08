// Loading state: a thin glowing progress line under the top bar plus one caption, shown while the
// world and its terrain tiles stream. It creeps forward between stages so it never looks stuck.

import { h } from "./dom.js";

export function createLoading(root) {
  const fill = h("div.load-fill");
  const cap = h("p.load-cap.mono", { role: "status", "aria-live": "polite" });
  const el = h("div.load", {}, fill, cap);
  root.append(el);
  let shown = 0.04, limit = 0.2, timer = 0, closed = false;
  const paint = () => { fill.style.transform = `scaleX(${shown.toFixed(3)})`; };
  paint();
  timer = setInterval(() => { shown += (limit - shown) * 0.05; paint(); }, 120);
  return {
    /** Move to a stage: bar jumps to `frac`, then creeps toward frac + 0.15. */
    stage(frac, text) {
      if (closed) return;
      shown = Math.max(shown, frac); limit = Math.min(0.96, frac + 0.15);
      if (text != null) cap.textContent = text;
      paint();
    },
    done() {
      if (closed) return;
      closed = true; clearInterval(timer);
      shown = 1; paint(); cap.textContent = "";
      el.classList.add("is-done");
      setTimeout(() => el.remove(), 900);
    },
  };
}
