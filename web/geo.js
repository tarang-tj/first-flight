// Shared local frame. Origin: Paine Field 16R/34L runway centre. East-North-Up metres mapped to
// three.js x = east, y = up, z = -north. Earth curvature is exact on a sphere: points far away
// drop below the tangent plane, so Mt Rainier at ~125 km sits at its true angle above the horizon.
//
// Vertical datum: altM is metres above MSL (ADS-B baro feet * FT is fine). The origin ground is
// 184.7 m MSL (Paine Field elevation 606 ft), and that is subtracted so the runway is y = 0.

export const FT = 0.3048;
export const ORIGIN = Object.freeze({ lat: 47.9063, lon: -122.2816 });
export const ORIGIN_ELEV_M = 184.7;
export const EARTH_R = 6371008.8;

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;
const sLat0 = Math.sin(ORIGIN.lat * D2R), cLat0 = Math.cos(ORIGIN.lat * D2R);
const sLon0 = Math.sin(ORIGIN.lon * D2R), cLon0 = Math.cos(ORIGIN.lon * D2R);

/** lat/lon/alt (MSL metres) to local {x,y,z} (east, up, -north). */
export function toLocal(latDeg, lonDeg, altM = 0) {
  const la = latDeg * D2R, lo = lonDeg * D2R;
  const r = EARTH_R + altM;
  const ex = r * Math.cos(la) * Math.cos(lo);
  const ey = r * Math.cos(la) * Math.sin(lo);
  const ez = r * Math.sin(la);
  // rotate ECEF (sphere) into ENU at the origin
  const e = -sLon0 * ex + cLon0 * ey;
  const n = -sLat0 * cLon0 * ex - sLat0 * sLon0 * ey + cLat0 * ez;
  const u = cLat0 * cLon0 * ex + cLat0 * sLon0 * ey + sLat0 * ez - EARTH_R;
  return { x: e, y: u - ORIGIN_ELEV_M, z: -n };
}

/** Local x (east) and z (-north) to lat/lon of the ground point beneath (inverse of toLocal at sea level). */
export function fromLocal(x, z) {
  const e = x, n = -z;
  const rr = EARTH_R * EARTH_R - e * e - n * n;
  const u = Math.sqrt(Math.max(rr, 1)) ; // distance from earth centre along the up axis, sphere surface
  const ex = -sLon0 * e - sLat0 * cLon0 * n + cLat0 * cLon0 * u;
  const ey = cLon0 * e - sLat0 * sLon0 * n + cLat0 * sLon0 * u;
  const ez = cLat0 * n + sLat0 * u;
  return { lat: Math.atan2(ez, Math.hypot(ex, ey)) * R2D, lon: Math.atan2(ey, ex) * R2D };
}

/** Straight-line ground distance in metres between two local points. */
export const dist2d = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
