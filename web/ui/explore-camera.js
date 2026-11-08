// Camera placement for Explore: where to stand so jets are in frame. Pure maths on local-frame points
// (x east, y up, z -north); pitch is degrees looking DOWN, matching free-fly and the orbit rig.
import { toLocal, FT } from "../geo.js";

const R2D = 180 / Math.PI;
export const localOf = (a) => toLocal(a.lat, a.lon, Math.max(0, a.altFt) * FT);
const hz = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

/** Jets with terrain under them (data spans the country) as {a, p}, nearest to `from` first. */
export function nearby(acts, from = { x: 0, z: 0 }, maxM = 600000) {
  return acts.map((a) => ({ a, p: localOf(a) })).filter((x) => hz(x.p, { x: 0, z: 0 }) < maxM)
    .sort((x, y) => hz(x.p, from) - hz(y.p, from));
}

/** Pose looking from `cam` at `target`. */
export function lookPose(cam, target) {
  const d = Math.hypot(target.x - cam.x, target.z - cam.z);
  return { x: cam.x, y: cam.y, z: cam.z, headingDeg: Math.atan2(target.x - cam.x, -(target.z - cam.z)) * R2D, pitchDeg: Math.atan2(cam.y - target.y, Math.max(1, d)) * R2D };
}

/** Frame the tightest group of up to `want` jets: stand on the Paine Field side, back far enough to fit them all. */
export function openingPose(list, groundAt = () => 0, want = 3, aspect = 1.6) {
  if (!list.length) return null;
  const k = Math.min(want, list.length);
  let best = null;
  for (const c of list) {
    const r = list.map((o) => hz(o.p, c.p)).sort((a, b) => a - b)[k - 1];
    if (!best || r < best.r) best = { c, r };
  }
  const group = list.filter((o) => hz(o.p, best.c.p) <= Math.max(best.r, 1) * 1.15);
  const mid = group.reduce((m, o) => ({ x: m.x + o.p.x / group.length, y: m.y + o.p.y / group.length, z: m.z + o.p.z / group.length }), { x: 0, y: 0, z: 0 });
  const spread = Math.max(...group.map((o) => hz(o.p, mid)));
  const narrow = Math.min(2.6, Math.max(1, 1.3 / aspect)); // portrait screens see less sideways, so stand further back
  const back = Math.min(60000, Math.max(6000, (spread * 1.6 + 3000) * narrow));
  const len = Math.hypot(mid.x, mid.z);
  const dir = len > 2000 ? { x: -mid.x / len, z: -mid.z / len } : { x: 0.3, z: 0.95 };
  const cam = { x: mid.x + dir.x * back, z: mid.z + dir.z * back };
  cam.y = Math.max(mid.y + 500, (groundAt(cam.x, cam.z) || 0) + 350);
  const pose = lookPose(cam, mid);
  pose.pitchDeg += 9; // aim below the jets so the horizon and terrain fill the lower frame
  return { pose, group: group.length };
}
