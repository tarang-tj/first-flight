// Interpolate a recorded path at time t. pts = [[dtSeconds, lat, lon, altFt], ...]
// (sorted by dt). Heading and pitch come from the segment the sample sits on, so
// they are defined at both ends of the path.

const R = 6371000;
const FT = 0.3048;
const rad = (d) => (d * Math.PI) / 180;
const deg = (r) => (r * 180) / Math.PI;

export function bearingDeg(lat1, lon1, lat2, lon2) {
  const p1 = rad(lat1), p2 = rad(lat2), dl = rad(lon2 - lon1);
  const y = Math.sin(dl) * Math.cos(p2);
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl);
  return (deg(Math.atan2(y, x)) + 360) % 360;
}

export function groundDistanceM(lat1, lon1, lat2, lon2) {
  const dLat = rad(lat2 - lat1);
  const dLon = rad(lon2 - lon1) * Math.cos(rad((lat1 + lat2) / 2));
  return R * Math.hypot(dLat, dLon);
}

export function pathDuration(pts) {
  return pts && pts.length ? pts[pts.length - 1][0] - pts[0][0] : 0;
}

export function maxAltFt(pts) {
  return (pts || []).reduce((m, p) => Math.max(m, p[3] || 0), 0);
}

function segmentAttitude(a, b) {
  const dist = groundDistanceM(a[1], a[2], b[1], b[2]);
  const heading = dist < 1 ? null : bearingDeg(a[1], a[2], b[1], b[2]);
  const pitch = dist < 1 ? 0 : deg(Math.atan2(((b[3] || 0) - (a[3] || 0)) * FT, dist));
  return { heading, pitch };
}

/** Index i such that pts[i][0] <= t < pts[i+1][0], clamped to a valid segment. */
function findSegment(pts, t) {
  let lo = 0, hi = pts.length - 2;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (pts[mid][0] <= t) lo = mid; else hi = mid - 1;
  }
  return lo;
}

/**
 * @returns {{lat:number, lon:number, altFt:number, headingDeg:number, pitchDeg:number, done:boolean}|null}
 */
export function samplePath(pts, t) {
  if (!Array.isArray(pts) || pts.length === 0) return null;
  if (pts.length === 1) {
    const p = pts[0];
    return { lat: p[1], lon: p[2], altFt: p[3] || 0, headingDeg: 0, pitchDeg: 0, done: true };
  }
  const first = pts[0], last = pts[pts.length - 1];
  const tt = Math.min(Math.max(t, first[0]), last[0]);
  let i = findSegment(pts, tt);
  const a = pts[i], b = pts[i + 1];
  const span = b[0] - a[0];
  const f = span > 0 ? (tt - a[0]) / span : 0;
  let att = segmentAttitude(a, b);
  // A stationary segment has no heading: borrow the nearest moving one.
  for (let k = 1; att.heading === null && (i - k >= 0 || i + k < pts.length - 1); k++) {
    if (i + k < pts.length - 1) att = segmentAttitude(pts[i + k], pts[i + k + 1]);
    if (att.heading === null && i - k >= 0) att = segmentAttitude(pts[i - k], pts[i - k + 1]);
  }
  return {
    lat: a[1] + (b[1] - a[1]) * f,
    lon: a[2] + (b[2] - a[2]) * f,
    altFt: (a[3] || 0) + ((b[3] || 0) - (a[3] || 0)) * f,
    headingDeg: att.heading ?? 0,
    pitchDeg: att.pitch,
    done: t >= last[0],
  };
}

/**
 * Drop long taxi/ground time at both ends, keeping padS seconds around the airborne part,
 * and re-zero time. Returns the input unchanged if the path never leaves the ground.
 */
export function trimToFlight(pts, thresholdFt = 300, padS = 45) {
  if (!Array.isArray(pts) || pts.length < 3) return pts;
  const up = pts.findIndex((p) => (p[3] || 0) > thresholdFt);
  if (up < 0) return pts;
  let down = pts.length - 1;
  while (down > up && (pts[down][3] || 0) <= thresholdFt) down--;
  const t0 = pts[up][0] - padS, t1 = pts[down][0] + padS;
  let a = up, b = down;
  while (a > 0 && pts[a - 1][0] >= t0) a--;
  while (b < pts.length - 1 && pts[b + 1][0] <= t1) b++;
  a = Math.max(0, a - (a > 0 ? 1 : 0));
  const base = pts[a][0];
  return pts.slice(a, b + 1).map((p) => [p[0] - base, p[1], p[2], p[3]]);
}
