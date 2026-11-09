// Free-flight controls. Touch: left virtual joystick (move/strafe), right drag area (look), up/down
// buttons. Desktop: a small key hint that fades after the first input. The world does the flying.
import { h } from "./dom.js";

const RADIUS = 52; // joystick travel in px
const isTouch = () => typeof matchMedia === "function" && matchMedia("(pointer: coarse)").matches;

export function createFlyControls(root, world) {
  const ff = world.freeFly;
  const touch = isTouch();
  const cleanups = [];
  const wrap = h("div.fly-ui" + (touch ? ".fly-touch" : ".fly-desk"), { hidden: true });
  let seen = false, resetPads = () => {};

  if (touch) {
    const knob = h("div.fly-knob");
    const pad = h("div.fly-stick", { "aria-label": "Move" }, knob);
    let id = null, cx = 0, cy = 0;
    const move = (e) => {
      let dx = e.clientX - cx, dy = e.clientY - cy;
      const m = Math.hypot(dx, dy);
      if (m > RADIUS) { dx *= RADIUS / m; dy *= RADIUS / m; }
      knob.style.transform = `translate(${dx}px, ${dy}px)`;
      ff.setStick(-dy / RADIUS, dx / RADIUS);
    };
    const end = (e) => {
      if (e.pointerId !== id) return;
      id = null; knob.style.transform = ""; ff.setStick(0, 0);
    };
    pad.addEventListener("pointerdown", (e) => {
      if (id !== null) return;
      id = e.pointerId; pad.setPointerCapture?.(id);
      const r = pad.getBoundingClientRect(); cx = r.left + r.width / 2; cy = r.top + r.height / 2;
      move(e); e.preventDefault();
    });
    pad.addEventListener("pointermove", (e) => { if (e.pointerId === id) move(e); });
    pad.addEventListener("pointerup", end); pad.addEventListener("pointercancel", end); pad.addEventListener("lostpointercapture", end);

    const lookArea = h("div.fly-look", { "aria-label": "Look" });
    let lp = null;
    lookArea.addEventListener("pointerdown", (e) => { if (lp) return; lp = { id: e.pointerId, x: e.clientX, y: e.clientY }; lookArea.setPointerCapture?.(e.pointerId); e.preventDefault(); });
    lookArea.addEventListener("pointermove", (e) => {
      if (!lp || e.pointerId !== lp.id) return;
      ff.look(-(e.clientX - lp.x) * 0.25, -(e.clientY - lp.y) * 0.25);
      lp.x = e.clientX; lp.y = e.clientY;
    });
    const lend = (e) => { if (lp && e.pointerId === lp.id) lp = null; };
    lookArea.addEventListener("pointerup", lend); lookArea.addEventListener("pointercancel", lend); lookArea.addEventListener("lostpointercapture", lend);
    // hiding the pads (Follow) drops pointer capture without a pointerup, so forget any touch in progress
    resetPads = () => { id = null; lp = null; knob.style.transform = ""; };

    const hold = (label, dir, cls) => {
      const b = h("button.fly-vert" + cls, { type: "button", "aria-label": label }, dir > 0 ? "▲" : "▼");
      const off = () => ff.setVertical(0);
      b.addEventListener("pointerdown", (e) => { b.setPointerCapture?.(e.pointerId); ff.setVertical(dir); e.preventDefault(); });
      b.addEventListener("pointerup", off); b.addEventListener("pointercancel", off);
      return b;
    };
    wrap.append(pad, lookArea, h("div.fly-vertical", {}, hold("Climb", 1, ".up"), hold("Descend", -1, ".down")));
  } else {
    const hint = h("div.fly-hint", {}, "Drag to look · W A S D to fly · Q E down / up · Shift boost · wheel changes speed");
    wrap.append(hint);
    const first = () => { if (seen) return; seen = true; hint.classList.add("fly-fade"); };
    for (const t of ["keydown", "pointerdown", "wheel"]) {
      window.addEventListener(t, first, { passive: true });
      cleanups.push(() => window.removeEventListener(t, first));
    }
  }
  root.append(wrap);

  return {
    show() {
      wrap.hidden = false;
      if (!touch) { seen = false; wrap.querySelector(".fly-hint")?.classList.remove("fly-fade"); }
    },
    hide() { wrap.hidden = true; resetPads(); ff.setStick(0, 0); ff.setVertical(0); },
    dispose() { cleanups.forEach((f) => f()); wrap.remove(); ff.setStick(0, 0); ff.setVertical(0); },
  };
}
