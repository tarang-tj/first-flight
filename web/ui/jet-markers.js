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
      const cp = world.camera.position, seen = new Set();
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
          layer.append(m.el);
          els.set(id, m);
        }
        if (m.label !== label) { m.label = label; m.txt.textContent = label; m.w = 0; }
        const p = e.jet.pos, pr = world.project(p.x, p.y, p.z);
        let a = 0;
        if (pr.visible && pr.x > 8 && pr.x < innerWidth - 8 && pr.y > top && pr.y < innerHeight - bottom) {
          const d = Math.hypot(cp.x - p.x, cp.y - p.y, cp.z - p.z);
          a = clamp01((d - 120) / 400) * clamp01((600000 - d) / 200000);
          const w = m.w || (m.w = m.el.offsetWidth || 90), flip = pr.x + w > innerWidth - 10;
          m.el.classList.toggle("flip", flip);
          m.el.style.transform = `translate(${(flip ? pr.x - w + 8 : pr.x).toFixed(1)}px, ${pr.y.toFixed(1)}px)`;
        }
        const sel = id === selectedId;
        if (m.sel !== sel) { m.sel = sel; m.el.classList.toggle("is-sel", sel); }
        const v = a > 0.02 ? (sel ? 1 : a).toFixed(2) : "0";
        if (m.a !== v) { m.a = v; m.el.style.opacity = v; }
      }
      for (const [id, m] of els) if (!seen.has(id)) { m.el.remove(); els.delete(id); }
    },
    dispose() { layer.remove(); els.clear(); },
  };
}
