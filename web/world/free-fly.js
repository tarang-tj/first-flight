// Free-flight camera. Does not import "three": it drives a camera object through position and Euler
// rotation only, so the pure helpers below can be unit tested in node.
// Frame: local x east, y up, z = -north. Heading = compass degrees the camera looks toward,
// pitch = degrees looking DOWN (matches the orbit rig).
import { ORIGIN_ELEV_M } from "../geo.js";

export const MIN_AGL_M = 15;
const D2R = Math.PI / 180;
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const ease = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const wrapDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

/** Cruise speed (m/s) at a height above ground: precise near the apron, fast at 30,000 ft. */
export const speedForHeight = (agl) => clamp(12 + 0.28 * Math.max(0, agl), 12, 3200);

/** Lowest allowed y over a ground height; `ahead` is the ground a moment further along the flight path. */
export const floorY = (ground, ahead = ground, min = MIN_AGL_M) => Math.max(ground + min, ahead + min * 0.8);

/** Hard clamp: never lower than the floor. */
export const clampToGround = (y, ground, ahead = ground, min = MIN_AGL_M) => Math.max(y, floorY(ground, ahead, min));

/** Glide duration (ms) for a hop of `distM` metres. */
export const glideMs = (distM) => clamp(2200 + distM / 18, 2200, 9000);

/** Pose along a glide at progress k in 0..1; long hops arc up by up to 7 km and settle back down. */
export function glidePose(from, to, k) {
  if (k >= 1) return { x: to.x, y: to.y, z: to.z, headingDeg: to.headingDeg, pitchDeg: to.pitchDeg };
  const e = ease(clamp(k, 0, 1));
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const arc = d > 3000 ? Math.min(7000, d * 0.18) * Math.sin(Math.PI * e) : 0;
  return {
    x: from.x + (to.x - from.x) * e,
    y: from.y + (to.y - from.y) * e + arc,
    z: from.z + (to.z - from.z) * e,
    headingDeg: from.headingDeg + wrapDelta(from.headingDeg, to.headingDeg) * e,
    pitchDeg: from.pitchDeg + (to.pitchDeg - from.pitchDeg) * e,
  };
}

export function createFreeFly(camera, canvas, groundAt, rig) {
  const p = { x: 0, y: 500, z: 0, heading: 0, pitch: 10, roll: 0 };
  const goal = { heading: 0, pitch: 10 };
  const v = { x: 0, y: 0, z: 0 };
  let wanted = false, paused = false, cruise = 1, glide = null, speed = 0, agl = 500;
  const input = { fwd: 0, strafe: 0, vert: 0, boost: false };

  const cancelGlide = () => { if (glide) { const r = glide.resolve; glide = null; r(); } };

  /** Take the pose from the camera as it is right now (rig has just applied it). */
  function adopt() {
    camera.updateMatrixWorld();
    const e = camera.matrixWorld.elements;
    const dx = -e[8], dy = -e[9], dz = -e[10];
    p.x = camera.position.x; p.y = camera.position.y; p.z = camera.position.z;
    p.heading = goal.heading = (Math.atan2(dx, -dz) / D2R + 360) % 360;
    p.pitch = goal.pitch = clamp(-Math.asin(clamp(dy, -1, 1)) / D2R, -85, 85);
    p.roll = 0; v.x = v.y = v.z = 0;
  }
  const live = () => wanted && !paused;
  const sync = () => rig.setSuspended(live());

  /** Hand the pose back to the orbit rig so leaving free flight does not jump the view. */
  function handBack() {
    const back = clamp(agl * 2.5, 400, 40000), ph = p.pitch * D2R, hh = p.heading * D2R;
    rig.state.target.set(p.x + Math.sin(hh) * Math.cos(ph) * back, p.y - Math.sin(ph) * back, p.z - Math.cos(hh) * Math.cos(ph) * back);
    rig.state.distance = back; rig.state.heading = p.heading; rig.state.pitch = clamp(p.pitch, -6, 88);
  }

  const api = {
    enable() { if (wanted) return; wanted = true; paused = false; adopt(); sync(); },
    disable() { if (!wanted) return; if (live()) handBack(); cancelGlide(); wanted = false; sync(); },
    /** Chase takes over the camera; free flight remembers it was on. */
    pause() { if (live()) { cancelGlide(); paused = true; sync(); } },
    resume() { if (wanted && paused) { paused = false; adopt(); sync(); } },
    get active() { return live(); },
    get speedMs() { return speed; },
    get altM() { return p.y + ORIGIN_ELEV_M; },
    get aglM() { return agl; },
    /** Glide to {x,y,z,headingDeg,pitchDeg}. Resolves when it lands or when any user input cancels it. */
    goTo(pose, ms) {
      if (![pose?.x, pose?.y, pose?.z].every(Number.isFinite)) return Promise.reject(new Error("goTo needs a finite x, y, z"));
      if (!wanted) api.enable(); else if (paused) api.resume();
      cancelGlide();
      const from = { x: p.x, y: p.y, z: p.z, headingDeg: p.heading, pitchDeg: p.pitch };
      const to = { x: pose.x, y: pose.y, z: pose.z, headingDeg: pose.headingDeg ?? p.heading, pitchDeg: pose.pitchDeg ?? p.pitch };
      const dur = ms ?? glideMs(Math.hypot(to.x - from.x, to.z - from.z));
      return new Promise((resolve) => {
        v.x = v.y = v.z = 0;
        glide = { from, to, ms: dur, t0: performance.now(), resolve };
        if (!(dur > 0)) step(0);
      });
    },
    /** Touch UI inputs (-1..1 stick axes; look deltas in degrees). */
    setStick(fwd, strafe) { input.fwd = fwd; input.strafe = strafe; if (fwd || strafe) cancelGlide(); },
    setVertical(vert) { input.vert = vert; if (vert) cancelGlide(); },
    look(dHeading, dPitch) { cancelGlide(); goal.heading += dHeading; goal.pitch = clamp(goal.pitch + dPitch, -85, 85); },
    update(dt) { if (live()) step(dt); },
  };

  // Input: keys on window, drag-look and wheel on the canvas. Handlers never stop propagation, so
  // main.js still sees pointerdown/up and a short tap still picks a jet.
  const KEYS = { KeyW: "fwd+", ArrowUp: "fwd+", KeyS: "fwd-", ArrowDown: "fwd-", KeyD: "str+", ArrowRight: "str+", KeyA: "str-", ArrowLeft: "str-", KeyE: "up", Space: "up", KeyQ: "dn", KeyC: "dn" };
  const down = new Set(), ptrs = new Map();
  const axis = (a, b) => (down.has(a) ? 1 : 0) - (down.has(b) ? 1 : 0);
  const pushKeys = () => {
    input.fwd = axis("fwd+", "fwd-"); input.strafe = axis("str+", "str-"); input.vert = axis("up", "dn");
    input.boost = down.has("boost");
    if (input.fwd || input.strafe || input.vert) cancelGlide();
  };
  const typing = (t) => t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable);
  const onKey = (e, on) => {
    if (!live() || typing(e.target) || e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key === "Shift" ? "boost" : KEYS[e.code];
    if (!k) return;
    if (e.key.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    on ? down.add(k) : down.delete(k);
    pushKeys();
  };
  const onKeyDown = (e) => onKey(e, true), onKeyUp = (e) => onKey(e, false);
  const onBlur = () => { down.clear(); pushKeys(); };
  const onDown = (e) => { if (!live()) return; ptrs.set(e.pointerId, { x: e.clientX, y: e.clientY }); canvas.setPointerCapture?.(e.pointerId); cancelGlide(); };
  const onMove = (e) => {
    const q = ptrs.get(e.pointerId);
    if (!q || !live()) return;
    const dx = e.clientX - q.x, dy = e.clientY - q.y;
    q.x = e.clientX; q.y = e.clientY;
    api.look(-dx * 0.2, -dy * 0.2);
  };
  const onUp = (e) => ptrs.delete(e.pointerId);
  const onWheel = (e) => { if (!live()) return; e.preventDefault(); cancelGlide(); cruise = clamp(cruise * Math.exp(-e.deltaY * 0.0012), 0.1, 8); };
  window.addEventListener("keydown", onKeyDown); window.addEventListener("keyup", onKeyUp); window.addEventListener("blur", onBlur);
  canvas.addEventListener("pointerdown", onDown); canvas.addEventListener("pointermove", onMove);
  canvas.addEventListener("pointerup", onUp); canvas.addEventListener("pointercancel", onUp);
  canvas.addEventListener("wheel", onWheel, { passive: false });
  api.dispose = () => {
    window.removeEventListener("keydown", onKeyDown); window.removeEventListener("keyup", onKeyUp); window.removeEventListener("blur", onBlur);
    canvas.removeEventListener("pointerdown", onDown); canvas.removeEventListener("pointermove", onMove);
    canvas.removeEventListener("pointerup", onUp); canvas.removeEventListener("pointercancel", onUp);
    canvas.removeEventListener("wheel", onWheel);
  };

  function step(dt) {
    const prevHeading = p.heading;
    if (glide) {
      // wall-clock progress, so a slow phone frame rate does not stretch the glide
      const k = glide.ms > 0 ? Math.min(1, (performance.now() - glide.t0) / glide.ms) : 1, g = glidePose(glide.from, glide.to, k);
      Object.assign(p, { x: g.x, y: g.y, z: g.z, heading: g.headingDeg, pitch: g.pitchDeg });
      goal.heading = p.heading; goal.pitch = p.pitch;
      if (k >= 1) { const r = glide.resolve; glide = null; r(); }
    } else {
      const base = speedForHeight(agl) * cruise * (input.boost ? 4 : 1);
      const hh = p.heading * D2R, ph = p.pitch * D2R;
      const fx = Math.sin(hh), fz = -Math.cos(hh);
      const tx = (fx * Math.cos(ph) * input.fwd + -fz * input.strafe) * base;
      const ty = (-Math.sin(ph) * input.fwd + input.vert) * base * (input.vert ? 0.7 : 1);
      const tz = (fz * Math.cos(ph) * input.fwd + fx * input.strafe) * base;
      const a = 1 - Math.exp(-dt * (input.fwd || input.strafe || input.vert ? 2.6 : 3.4));
      v.x += (tx - v.x) * a; v.y += (ty - v.y) * a; v.z += (tz - v.z) * a;
      p.x += v.x * dt; p.y += v.y * dt; p.z += v.z * dt;
      const turn = 1 - Math.exp(-dt * 12);
      p.heading += wrapDelta(p.heading, goal.heading) * turn;
      p.pitch += (goal.pitch - p.pitch) * turn;
    }
    const ahead = groundAt(p.x + v.x * 0.8, p.z + v.z * 0.8), ground = groundAt(p.x, p.z);
    const lo = floorY(ground, ahead);
    if (p.y < lo) p.y = Math.max(p.y + (lo - p.y) * Math.min(1, dt * 8), ground + MIN_AGL_M * 0.8); // rise smoothly, never below 80% of the floor
    if (v.y < 0 && p.y <= lo + 0.5) v.y = 0;
    agl = p.y - ground; speed = Math.hypot(v.x, v.y, v.z);
    const yawRate = dt > 0 ? wrapDelta(prevHeading, p.heading) / dt : 0;
    p.roll += (clamp(yawRate * 0.28, -22, 22) - p.roll) * (1 - Math.exp(-dt * 4));
    goal.heading = ((goal.heading % 360) + 360) % 360;
    camera.position.set(p.x, p.y, p.z);
    camera.rotation.order = "YXZ";
    camera.rotation.set(-p.pitch * D2R, -p.heading * D2R, -p.roll * D2R);
    camera.near = clamp(agl / 150, 1, 2500); camera.far = 900000;
    camera.updateProjectionMatrix();
  }
  return api;
}
