// Camera driver: a mode hands it a function that returns the wanted shot each frame. The target is
// followed exactly (a fast jet stays centred); distance, heading and pitch are smoothed. A drag,
// pinch or wheel hands the camera to the viewer for a few seconds, then it eases back to the story.

import { wrapDelta } from "./choreo.js";

const HOLD_MS = 7000;

export function createCamera(world) {
  const st = world?.rig?.state;
  let want = null, opts = {}, holdUntil = 0, snapNext = false;
  const hold = () => { holdUntil = performance.now() + HOLD_MS; };
  const c = world?.canvas;
  if (c) {
    c.addEventListener("pointerdown", hold, { passive: true });
    c.addEventListener("wheel", hold, { passive: true });
    c.addEventListener("pointermove", (e) => { if (e.buttons) hold(); }, { passive: true });
  }

  function cancelRigMotion() {
    try { world.rig.chase(null); world.flyTo({}, 1); } catch (e) { console.warn(`[camera] ${e?.message || e}`); }
  }

  // Framing: slide the picture away from the card (up on phones, right on desktop) with a view offset.
  let fx = 0, fy = 0;
  function applyFraming() {
    const cam = world?.camera;
    if (!cam?.setViewOffset) return;
    const w = innerWidth, h = innerHeight;
    if (!fx && !fy) cam.clearViewOffset(); else cam.setViewOffset(w, h, Math.round(fx * w), Math.round(fy * h), w, h);
    cam.updateProjectionMatrix();
  }
  addEventListener("resize", applyFraming);

  return {
    /** fx, fy: fractions of the screen to shift the picture (fy > 0 moves it up, fx < 0 moves it right). */
    setFraming(x = 0, y = 0) { fx = x; fy = y; applyFraming(); },
    /** fn(dt) -> shot | null. opts: { rate = 3 (smoothing per second), snap = false, track = true } */
    drive(fn, o = {}) {
      if (!st) return;
      cancelRigMotion();
      want = fn; opts = { rate: 3, track: true, ...o }; snapNext = !!o.snap; holdUntil = 0;
    },
    release() { want = null; },
    get held() { return performance.now() < holdUntil; },
    /** Call once per frame, after the mode has moved its jet. */
    step(dt) {
      if (!st || !want) return;
      const g = want(dt);
      if (!g) return;
      st.target.set(g.target.x, g.target.y, g.target.z);
      if (performance.now() < holdUntil) return; // viewer is steering: keep the jet in frame only
      const k = snapNext ? 1 : 1 - Math.exp(-dt * opts.rate);
      snapNext = false;
      st.distance = Math.exp(Math.log(st.distance) + (Math.log(g.distance) - Math.log(st.distance)) * k);
      st.heading += wrapDelta(st.heading, g.headingDeg) * k;
      st.pitch += (g.pitchDeg - st.pitch) * k;
    },
  };
}
