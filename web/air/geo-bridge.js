// Local-frame conversion. Uses lane B's web/geo.js (toLocal with earth-curvature
// drop). If it cannot load, a flat tangent-plane fallback keeps the UI alive.

const ORIGIN = { lat: 47.9063, lon: -122.2816 };
const R = 6371000;
const rad = (d) => (d * Math.PI) / 180;
const FT = 0.3048;

const fallback = {
  FT,
  toLocal(lat, lon, altM = 0) {
    const x = rad(lon - ORIGIN.lon) * Math.cos(rad(ORIGIN.lat)) * R;
    const north = rad(lat - ORIGIN.lat) * R;
    return { x, y: altM - 184.7, z: -north };
  },
};

export async function loadGeo() {
  try {
    const m = await import("../geo.js");
    if (typeof m.toLocal === "function") return { toLocal: m.toLocal, FT: m.FT ?? FT };
  } catch (err) {
    console.warn(`[geo] web/geo.js unavailable, using flat fallback: ${err?.message || err}`);
  }
  return fallback;
}

/** pts [[dt, lat, lon, altFt]] -> [{x,y,z,t}] for world.addTrail. */
export function toTrailPoints(geo, pts) {
  return pts.map((p) => ({ ...geo.toLocal(p[1], p[2], Math.max(0, p[3] || 0) * geo.FT), t: p[0] }));
}

export function boundsOf(points) {
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity, maxY = 0;
  for (const p of points) {
    minX = Math.min(minX, p.x); maxX = Math.max(maxX, p.x);
    minZ = Math.min(minZ, p.z); maxZ = Math.max(maxZ, p.z);
    maxY = Math.max(maxY, p.y);
  }
  return { cx: (minX + maxX) / 2, cz: (minZ + maxZ) / 2, cy: maxY / 3, span: Math.max(maxX - minX, maxZ - minZ, 1) };
}

/** Local position for a samplePath() result. */
export function poseLocal(geo, s) {
  return geo.toLocal(s.lat, s.lon, Math.max(0, s.altFt) * geo.FT);
}

/** Framing for the opening camera: the part of a path within nearKm of the origin, so a
 *  flight that wanders 500 km away still opens on Puget Sound. */
export function frameNear(points, nearKm = 100, headingDeg = 20, wide = true) {
  const near = points.filter((p) => Math.hypot(p.x, p.z) <= nearKm * 1000);
  const b = boundsOf(near.length >= 5 ? near : points);
  const distance = Math.min(110000, Math.max(b.span * 1.5, 22000));
  // Keep the action clear of the UI: the panel sits bottom-left on wide screens, bottom on phones.
  const h = (headingDeg * Math.PI) / 180;
  const fwd = { x: Math.sin(h), z: -Math.cos(h) }, right = { x: Math.cos(h), z: Math.sin(h) };
  const sx = wide ? -right.x * 0.2 : -fwd.x * 0.22, sz = wide ? -right.z * 0.2 : -fwd.z * 0.22;
  return { target: { x: b.cx + sx * distance, y: Math.min(b.cy, 3000), z: b.cz + sz * distance }, distance };
}
