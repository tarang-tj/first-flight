// Place names pinned to the 3D world: the plant (OSM name) and the three airfields. Each label is a
// DOM element moved every frame from world.project, faded by camera distance and hidden when off screen.

import { h } from "./dom.js";
import { labelAlpha } from "./choreo.js";

const FIELDS = [
  { id: "kpae", text: "Paine Field", lat: 47.9063, lon: -122.2816, min: 900, max: 85000 },
  { id: "krnt", text: "Renton", lat: 47.4931, lon: -122.2157, min: 900, max: 85000 },
  { id: "kbfi", text: "Boeing Field", lat: 47.53, lon: -122.302, min: 900, max: 85000 },
];

export function createLabels({ root, world, geo, ticker }) {
  if (!world?.project || !world?.camera) return { dispose() {}, setEnabled() {} };
  const layer = h("div.label-layer", { "aria-hidden": "true" });
  root.prepend(layer);
  let enabled = true;
  const items = FIELDS.map((f) => {
    const p = geo.toLocal(f.lat, f.lon, 0);
    return { ...f, el: h("div.map-label", {}, h("span.pin"), h("span.txt", { text: f.text })), pos: () => ({ x: p.x, y: (world.groundAt?.(p.x, p.z) ?? 0) + 30, z: p.z }) };
  });
  items.push({ id: "plant", text: "Boeing Everett Assembly Plant", min: 350, max: 9000, el: h("div.map-label.plant", {}, h("span.pin"), h("span.txt", { text: "Boeing Everett Assembly Plant" })),
    pos: () => { const l = world.landmarks?.plant; return l ? { x: l.x, y: l.y + 25, z: l.z } : null; } });
  items.forEach((i) => layer.append(i.el));

  const off = ticker.add(() => {
    const cp = world.camera.position;
    for (const it of items) {
      const p = enabled ? it.pos() : null;
      let a = 0;
      if (p) {
        const pr = world.project(p.x, p.y, p.z);
        const margin = 40;
        if (pr.visible && pr.x > margin && pr.x < innerWidth - margin && pr.y > 70 && pr.y < innerHeight - 60) {
          a = labelAlpha(Math.hypot(cp.x - p.x, cp.y - p.y, cp.z - p.z), it);
          it.el.style.transform = `translate(${pr.x.toFixed(1)}px, ${pr.y.toFixed(1)}px)`;
        }
      }
      const v = a > 0.02 ? a.toFixed(2) : "0";
      if (it.alpha !== v) { it.alpha = v; it.el.style.opacity = v; }
    }
  });
  return { setEnabled(v) { enabled = !!v; }, dispose() { off(); layer.remove(); } };
}
