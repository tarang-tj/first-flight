// The Live opening as a short film, one flight at a time. Pure timing and shot maths (no DOM):
//   hero (first cycle only) -> glide to the runway -> chase the takeoff and climb close in ->
//   run the rest of the flight while pulling back -> pull out to the region -> hold on the trail.

import { blendShot, easeInOut, lerp, clamp01 } from "./choreo.js";

export const P = { hero: 8, glide: 3.4, chase: 15, run: 11, pull: 4.5, hold: 5.5, fade: 1 };

/** Phase name and progress k (0..1) at story time t. intro=false skips the hero shot. */
export function phaseAt(t, intro = true, arrive = false) {
  let at = 0;
  const order = arrive ? ["hero", "glide", "run", "chase", "pull", "hold", "fade"] : ["hero", "glide", "chase", "run", "pull", "hold", "fade"];
  for (const name of order) {
    const len = name === "hero" && !intro ? 0 : P[name];
    if (t < at + len) return { name, k: (t - at) / len, start: at };
    at += len;
  }
  return { name: "end", k: 1, start: at };
}

/** Seconds from story start to the moment the flight clock starts (end of the glide). */
export const flightStart = (intro) => (intro ? P.hero : 0) + P.glide;
export const storyLength = (intro) => (intro ? P.hero : 0) + P.glide + P.chase + P.run + P.pull + P.hold + P.fade;

/** First time (flight seconds) the path is within nearM of Paine Field, or null if it never is. */
export function entryTime(points, nearM = 90000) {
  const p = points.find((q) => Math.hypot(q.x, q.z) <= nearM);
  return p ? p.t : null;
}

const at = (jet, d, heading, pitch) => ({ target: { x: jet.x, y: jet.y, z: jet.z }, distance: d, headingDeg: heading, pitchDeg: pitch });
const expLerp = (a, b, k) => Math.exp(lerp(Math.log(a), Math.log(b), k));

/** Close chase: the jet clearly reads as a jet, camera swings from 3/4 rear to the other side. */
export function chaseShot(u, jet, heading, jetLen) {
  const d0 = Math.min(900, Math.max(420, jetLen * 11));
  return at(jet, expLerp(d0, 2000, easeInOut(u)), heading + lerp(28, -32, u), lerp(12, 18, u));
}

/** Pulling back while the flight runs ahead. */
export function runShot(u, jet, heading) {
  return at(jet, expLerp(2000, 3400, easeInOut(u)), heading + lerp(-32, -10, u), lerp(18, 34, easeInOut(u)));
}

/** The terrain ends about 250 km out. As the jet nears that edge, swing to the region view so the
 *  camera never stares at empty haze; the glowing trail keeps drawing in frame. */
function farBlend(shot, env) {
  const far = clamp01((Math.hypot(env.jet.x, env.jet.z) - 100000) / 70000);
  return far > 0 ? blendShot(shot, env.final, easeInOut(far)) : shot;
}

/**
 * Wanted shot for the current phase. An arrival (a flight that starts out beyond the terrain) plays
 * the run first and the close chase last, so the camera is close for the landing.
 * env: { hero(k), from, jet {x,y,z}, heading, jetLen, final, startJet, startHeading, arrive }
 */
export function shotFor(ph, env) {
  const run = (u, j, h) => farBlend(runShot(env.arrive ? 1 - u : u, j, h), env);
  const chase = (u, j, h) => farBlend(chaseShot(env.arrive ? 1 - u : u, j, h, env.jetLen), env);
  switch (ph.name) {
    case "hero": return env.hero(ph.k);
    case "glide": {
      const s = env.arrive ? runShot(1, env.startJet, env.startHeading) : chaseShot(0, env.startJet, env.startHeading, env.jetLen);
      return blendShot(env.from, s, easeInOut(ph.k), 1.0);
    }
    case "chase": return chase(ph.k, env.jet, env.heading);
    case "run": return run(ph.k, env.jet, env.heading);
    case "pull": return blendShot(env.arrive ? chase(1, env.jet, env.heading) : run(1, env.jet, env.heading), env.final, easeInOut(ph.k), 0.15);
    default: return { ...env.final, headingDeg: env.final.headingDeg + 5 * clamp01(ph.name === "hold" ? ph.k : 1) };
  }
}
