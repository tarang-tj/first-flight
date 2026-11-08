// Orbit camera rig: target + distance + heading (compass direction the camera LOOKS toward) + pitch
// (degrees looking down). Drag orbits, wheel/pinch zooms, flyTo tweens, chase follows a jet.
import * as THREE from "three";

export const VIEWS = {
  hero: { target: { x: 350, y: 30, z: -2400 }, distance: 1700, headingDeg: 28, pitchDeg: 8 },
  region: { target: { x: 3000, y: 0, z: 23000 }, distance: 70000, headingDeg: 6, pitchDeg: 46 },
  state: { target: { x: 40000, y: 0, z: 30000 }, distance: 340000, headingDeg: 0, pitchDeg: 58 },
};

const D2R = Math.PI / 180;
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
const wrapDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

export function createRig(camera, canvas, groundAt) {
  const st = { target: new THREE.Vector3(VIEWS.hero.target.x, VIEWS.hero.target.y, VIEWS.hero.target.z), distance: VIEWS.hero.distance, heading: VIEWS.hero.headingDeg, pitch: VIEWS.hero.pitchDeg };
  let tween = null, chased = null, userHeading = 0, idle = 0;

  function apply() {
    const ph = st.pitch * D2R, hh = st.heading * D2R;
    const look = new THREE.Vector3(Math.sin(hh) * Math.cos(ph), -Math.sin(ph), -Math.cos(hh) * Math.cos(ph));
    camera.position.copy(st.target).addScaledVector(look, -st.distance);
    const floor = groundAt(camera.position.x, camera.position.z) + 6;
    if (camera.position.y < floor) camera.position.y = floor;
    camera.lookAt(st.target);
    camera.near = Math.min(3000, Math.max(0.6, st.distance / 320));
    camera.far = 900000;
    camera.updateProjectionMatrix();
  }

  function flyTo(goal, ms = 2200) {
    chased = null;
    const from = { x: st.target.x, y: st.target.y, z: st.target.z, d: st.distance, h: st.heading, p: st.pitch };
    const to = {
      x: goal.target ? goal.target.x : from.x, y: goal.target ? goal.target.y : from.y, z: goal.target ? goal.target.z : from.z,
      d: goal.distance ?? from.d, h: goal.headingDeg ?? from.h, p: goal.pitchDeg ?? from.p,
    };
    return new Promise((resolve) => {
      if (!(ms > 0)) { Object.assign(st, { distance: to.d, heading: to.h, pitch: to.p }); st.target.set(to.x, to.y, to.z); resolve(); return; }
      tween = { from, to, ms, t: 0, resolve };
    });
  }

  function stepTween(dt) {
    if (!tween) return;
    tween.t += dt * 1000;
    const k = ease(Math.min(1, tween.t / tween.ms)), { from, to } = tween;
    st.target.set(from.x + (to.x - from.x) * k, from.y + (to.y - from.y) * k, from.z + (to.z - from.z) * k);
    // log-interpolate distance so long flights feel even; arc up mid-flight for big moves
    st.distance = Math.exp(Math.log(from.d) + (Math.log(to.d) - Math.log(from.d)) * k);
    st.heading = from.h + wrapDelta(from.h, to.h) * k;
    st.pitch = from.p + (to.p - from.p) * k;
    if (tween.t >= tween.ms) { const r = tween.resolve; tween = null; r(); }
  }

  function stepChase(dt) {
    if (!chased) return;
    st.target.copy(chased.pos); // locked on: the jet stays centred however fast it moves
    const want = (chased.heading || 0) + userHeading;
    st.heading += wrapDelta(st.heading, want) * (1 - Math.exp(-dt * 2));
  }

  // pointer input
  const pts = new Map();
  let lastPinch = 0;
  const cancelAuto = () => { if (tween) { tween.resolve(); tween = null; } idle = 0; };
  canvas.style.touchAction = "none";
  const onDown = (e) => { canvas.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); cancelAuto(); if (pts.size === 2) lastPinch = pinchDist(); };
  const pinchDist = () => { const [a, b] = [...pts.values()]; return Math.hypot(a.x - b.x, a.y - b.y); };
  const onMove = (e) => {
    const p = pts.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    if (pts.size === 1) {
      if (chased) userHeading -= dx * 0.25; else st.heading -= dx * 0.25;
      st.pitch = Math.min(88, Math.max(-6, st.pitch + dy * 0.2));
    } else if (pts.size === 2) {
      const d = pinchDist();
      if (lastPinch > 0) zoomBy(lastPinch / d);
      lastPinch = d;
    }
  };
  const onUp = (e) => { pts.delete(e.pointerId); lastPinch = 0; };
  const zoomBy = (f) => { st.distance = Math.min(700000, Math.max(chased ? 40 : 60, st.distance * f)); };
  const onWheel = (e) => { e.preventDefault(); cancelAuto(); zoomBy(Math.exp(e.deltaY * 0.0012)); };
  canvas.addEventListener("pointerdown", onDown);
  canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp);
  canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });

  apply();
  return {
    state: st,
    flyTo,
    update(dt) {
      stepTween(dt);
      stepChase(dt);
      if (!tween && !chased && pts.size === 0) { idle += dt; }
      apply();
    },
    chase(jet) {
      if (!jet) { chased = null; return; }
      if (tween) { tween.resolve(); tween = null; }
      userHeading = 0;
      chased = jet;
      st.target.copy(jet.pos);
      st.heading = jet.heading || st.heading;
      st.distance = Math.min(st.distance, Math.max(160, jet.dims.length * 3.6));
      st.pitch = Math.min(st.pitch, 16);
    },
    get chasing() { return chased; },
    setView(name, ms) { return flyTo(VIEWS[name] || VIEWS.hero, ms ?? 2400); },
    snapTo(goal) { return flyTo(goal, 0); },
    dispose() {
      canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
      canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
      canvas.removeEventListener("wheel", onWheel);
    },
  };
}
