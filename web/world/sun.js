// Solar position (NOAA low-precision algorithm, good to about 0.01 deg) and the sky palette it drives.

const D2R = Math.PI / 180;
const R2D = 180 / Math.PI;

/** Sun azimuth (deg clockwise from north) and elevation (deg above horizon) for a Date at lat/lon. */
export function solarPosition(date, latDeg, lonDeg) {
  const jd = date.getTime() / 86400000 + 2440587.5;
  const T = (jd - 2451545.0) / 36525;
  const L0 = (280.46646 + T * (36000.76983 + T * 0.0003032)) % 360;
  const M = 357.52911 + T * (35999.05029 - 0.0001537 * T);
  const e = 0.016708634 - T * (0.000042037 + 0.0000001267 * T);
  const Mr = M * D2R;
  const C = Math.sin(Mr) * (1.914602 - T * (0.004817 + 0.000014 * T))
    + Math.sin(2 * Mr) * (0.019993 - 0.000101 * T) + Math.sin(3 * Mr) * 0.000289;
  const trueLong = L0 + C;
  const omega = 125.04 - 1934.136 * T;
  const lambda = trueLong - 0.00569 - 0.00478 * Math.sin(omega * D2R);
  const eps0 = 23 + (26 + (21.448 - T * (46.815 + T * (0.00059 - T * 0.001813))) / 60) / 60;
  const eps = eps0 + 0.00256 * Math.cos(omega * D2R);
  const decl = Math.asin(Math.sin(eps * D2R) * Math.sin(lambda * D2R));
  const y = Math.tan((eps * D2R) / 2) ** 2;
  const eqTime = 4 * R2D * (y * Math.sin(2 * L0 * D2R) - 2 * e * Math.sin(Mr)
    + 4 * e * y * Math.sin(Mr) * Math.cos(2 * L0 * D2R) - 0.5 * y * y * Math.sin(4 * L0 * D2R)
    - 1.25 * e * e * Math.sin(2 * Mr)); // minutes
  const utcMin = date.getUTCHours() * 60 + date.getUTCMinutes() + date.getUTCSeconds() / 60;
  const tst = (utcMin + eqTime + 4 * lonDeg) % 1440; // true solar time, minutes
  const ha = (tst / 4 < 0 ? tst / 4 + 180 : tst / 4 - 180) * D2R;
  const lat = latDeg * D2R;
  const cosZ = Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha);
  const zen = Math.acos(Math.min(1, Math.max(-1, cosZ)));
  const sinZ = Math.sin(zen) || 1e-9;
  let az = Math.acos(Math.min(1, Math.max(-1,
    (Math.sin(lat) * cosZ - Math.sin(decl)) / (Math.cos(lat) * sinZ)))) * R2D;
  az = ha > 0 ? (az + 180) % 360 : (540 - az) % 360;
  return { azimuthDeg: az, elevationDeg: 90 - zen * R2D };
}

/** Unit vector toward the sun in the local frame (x east, y up, z -north). */
export function sunVector(azimuthDeg, elevationDeg) {
  const az = azimuthDeg * D2R, el = elevationDeg * D2R;
  return { x: Math.sin(az) * Math.cos(el), y: Math.sin(el), z: -Math.cos(az) * Math.cos(el) };
}

const lerp = (a, b, t) => a + (b - a) * t;
const mix = (c1, c2, t) => [lerp(c1[0], c2[0], t), lerp(c1[1], c2[1], t), lerp(c1[2], c2[2], t)];
const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Palette keyframes by sun elevation (deg): zenith, horizon (also fog), sun light colour.
const KEYS = [
  { el: -18, zen: [0.02, 0.03, 0.075], hor: [0.07, 0.09, 0.17], sun: [0.4, 0.5, 0.8] },
  { el: -6, zen: [0.04, 0.06, 0.15], hor: [0.32, 0.22, 0.28], sun: [1.0, 0.45, 0.2] },
  { el: 0, zen: [0.12, 0.2, 0.42], hor: [0.95, 0.5, 0.3], sun: [1.0, 0.55, 0.3] },
  { el: 8, zen: [0.2, 0.4, 0.72], hor: [0.85, 0.72, 0.6], sun: [1.0, 0.8, 0.62] },
  { el: 30, zen: [0.17, 0.42, 0.82], hor: [0.66, 0.78, 0.92], sun: [1.0, 0.95, 0.88] },
  { el: 90, zen: [0.14, 0.38, 0.8], hor: [0.62, 0.76, 0.92], sun: [1.0, 0.98, 0.94] },
];

/** Sky colours and light strengths for a sun elevation. All colours are linear-ish RGB 0..1. */
export function skyState(elevationDeg) {
  const el = Math.max(KEYS[0].el, Math.min(90, elevationDeg));
  let i = 0;
  while (i < KEYS.length - 2 && el > KEYS[i + 1].el) i++;
  const a = KEYS[i], b = KEYS[i + 1];
  const t = clamp01((el - a.el) / (b.el - a.el));
  const day = clamp01((elevationDeg + 4) / 14); // 0 at night, 1 in full day
  return {
    zenith: mix(a.zen, b.zen, t),
    horizon: mix(a.hor, b.hor, t),
    sunColor: mix(a.sun, b.sun, t),
    sunIntensity: 2.6 * clamp01((elevationDeg + 2) / 12),
    ambient: lerp(0.28, 0.85, day),
    night: clamp01((-elevationDeg - 2) / 10), // 1 once the sun is well below the horizon
    day,
  };
}
