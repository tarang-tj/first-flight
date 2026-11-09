// Screen-space markers for jets in view: a glow dot and a callsign in IBM Plex Mono, moved every frame
// from world.project (same approach as labels.js). Fades with distance so a crowd stays readable.
import { h } from "./dom.js";
import { programColor } from "./year-model.js";

const clamp01 = (x) => Math.min(1, Math.max(0, x));

export function createJetMarkers({ root, world }) {
  const layer = h("div.jet-layer", { "aria-hidden": "true" });
  root.prepend(layer);
  const els = new Map(); // pick id -> { el, a, label }

  return {
    /** entries: [id, { jet, info }] pairs from traffic.entries(). */
    update(entries, selectedId, top = 110, bottom = 40) {
      const cp = world.camera.position, seen = new Set(), rect = world.canvas.getBoundingClientRect(), calc = [];
      // read pass: project every jet and measure new labels, then write styles (no layout flush between reads)
      for (const [id, e] of entries) {
        const info = e.info;
        if (!info) continue;
        seen.add(id);
        let m = els.get(id);
        const label = info.cs || info.reg || info.hex;
        if (!m) {
          m = { el: h("div.jet-marker", {}, h("span.jm-dot"), h("span.jm-txt")), a: "", label: "", sel: null, w: 0 };
          m.txt = m.el.querySelector(".jm-txt");
          m.el.style.setProperty("--c", programColor(info.program));
          m.el.style.opacity = "0";
          layer.append(m.el);
          els.set(id, m);
        }
        if (m.label !== label) { m.label = label; m.txt.textContent = label; m.w = 0; }
        const p = e.jet.pos, pr = world.project(p.x, p.y, p.z, rect);
        let a = 0, x = 0, flip = false;
        if (pr.visible && pr.x > 8 && pr.x < innerWidth - 8 && pr.y > top && pr.y < innerHeight - bottom) {
          const d = Math.hypot(cp.x - p.x, cp.y - p.y, cp.z - p.z);
          a = clamp01((d - 120) / 400) * clamp01((600000 - d) / 200000);
          if (!m.w) m.w = m.el.offsetWidth || 90;
          flip = pr.x + m.w > innerWidth - 10;
          x = flip ? pr.x - m.w + 8 : pr.x;
        }
        calc.push({ id, m, a, x, y: pr.y, flip });
      }
      for (const c of calc) {
        const { m } = c, sel = c.id === selectedId;
        if (c.a > 0.02) { m.el.classList.toggle("flip", c.flip); m.el.style.transform = `translate(${c.x.toFixed(1)}px, ${c.y.toFixed(1)}px)`; }
        if (m.sel !== sel) { m.sel = sel; m.el.classList.toggle("is-sel", sel); }
        const v = c.a > 0.02 ? (sel ? 1 : c.a).toFixed(2) : "0";
        if (m.a !== v) { m.a = v; m.el.style.opacity = v; }
      }
      for (const [id, m] of els) if (!seen.has(id)) { m.el.remove(); els.delete(id); }
    },
    dispose() { layer.remove(); els.clear(); },
  };
}
