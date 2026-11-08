// Pure camera choreography maths (no DOM, no three). A "shot" is
// { target: {x,y,z}, distance, headingDeg, pitchDeg }, the same shape world.flyTo takes.

export const clamp01 = (x) => Math.min(1, Math.max(0, x));
export const lerp = (a, b, k) => a + (b - a) * k;
export const easeInOut = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);
export const wrapDelta = (a, b) => ((((b - a) % 360) + 540) % 360) - 180;

/** Blend two shots. Distance moves in log space; `arc` (log units) bows the path outward mid-way
 *  so a long move rises above the ground and settles again instead of skimming it. */
export function blendShot(a, b, k, arc = 0) {
  const e = clamp01(k);
  const ld = lerp(Math.log(a.distance), Math.log(b.distance), e) + arc * Math.sin(Math.PI * e);
  return {
    target: { x: lerp(a.target.x, b.target.x, e), y: lerp(a.target.y, b.target.y, e), z: lerp(a.target.z, b.target.z, e) },
    distance: Math.exp(ld),
    headingDeg: a.headingDeg + wrapDelta(a.headingDeg, b.headingDeg) * e,
    pitchDeg: lerp(a.pitchDeg, b.pitchDeg, e),
  };
}

/** The opening hero shot of the plant, drifting slowly as k goes 0..1. */
export function heroShot(k, base = { x: 350, y: 30, z: -2400 }) {
  const e = clamp01(k);
  return { target: { ...base }, distance: lerp(1750, 1350, e), headingDeg: lerp(30, 12, e), pitchDeg: lerp(8, 12, e) };
}

export const REGION_SHOT = { target: { x: 5000, y: 0, z: 20000 }, distance: 62000, headingDeg: 6, pitchDeg: 46 };
export const STATE_SHOT = { target: { x: 40000, y: 0, z: 30000 }, distance: 330000, headingDeg: -6, pitchDeg: 56 };

/** A Year in Light: start over the region, rise to the state view as the year plays (f 0..1).
 *  `clockS` adds a slow idle sway so the finished light painting never freezes. */
export function yearShot(f, clockS = 0, aspect = 1.6) {
  // A portrait phone sees a narrow slice, so it settles nearer than the 330 km state view.
  const end = aspect < 1 ? { ...STATE_SHOT, distance: 115000, pitchDeg: 52 } : STATE_SHOT;
  const s = blendShot(REGION_SHOT, end, easeInOut(clamp01(f)));
  return { ...s, headingDeg: s.headingDeg + 7 * Math.sin(clockS * 0.12) };
}

/**
 * Time map for a replayed flight. Real seconds t -> flight seconds. The first `chase` seconds
 * run the takeoff and climb at v0x rising to v1x (the jet is followed close in); the next `run`
 * seconds speed up to finish the rest of the flight. Always ends exactly at `dur`.
 */
export function makeSimClock(dur, { chase = 15, run = 11, v0 = 6, v1 = 50, reverse = false } = {}) {
  if (reverse) { // an arrival: fast approach, then slow down into the landing
    const fwd = makeSimClock(dur, { chase, run, v0, v1 });
    return (t) => dur - fwd(Math.max(0, chase + run - t));
  }
  const lr = Math.log(v1 / v0);
  const simA = Math.min(dur, (v0 * chase / lr) * (Math.exp((lr * chase) / chase) - 1));
  const rest = Math.max(0, dur - simA);
  const c = rest - v1 * run; // extra beyond a steady v1x run
  return (t) => {
    if (t <= 0) return 0;
    if (t < chase) return Math.min(dur, (v0 * chase / lr) * (Math.exp((lr * t) / chase) - 1));
    const u = clamp01((t - chase) / run);
    if (c > 0) return Math.min(dur, simA + v1 * run * u + c * u * u);
    return simA + rest * u;
  };
}

/** Label opacity from camera distance: fades in below `max`, out when the camera is on top of it. */
export function labelAlpha(dist, { min = 0, max = 60000 } = {}) {
  if (!(dist >= 0)) return 0;
  return clamp01((max - dist) / (max * 0.3)) * clamp01((dist - min) / Math.max(1, min * 0.6));
}
