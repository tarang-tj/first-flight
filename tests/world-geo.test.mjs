import test from "node:test";
import assert from "node:assert/strict";
import { toLocal, fromLocal, FT, ORIGIN, ORIGIN_ELEV_M } from "../web/geo.js";
import { solarPosition } from "../web/world/sun.js";

const RAINIER = { lat: 46.8523, lon: -121.7603, alt: 4392 };

test("origin maps to (0, -elev + alt, 0)", () => {
  const p = toLocal(ORIGIN.lat, ORIGIN.lon, ORIGIN_ELEV_M);
  assert.ok(Math.abs(p.x) < 1e-3 && Math.abs(p.y) < 1e-3 && Math.abs(p.z) < 1e-3);
  assert.equal(FT, 0.3048);
});

test("Rainier lands SSE of Paine Field at the real distance", () => {
  const p = toLocal(RAINIER.lat, RAINIER.lon, RAINIER.alt);
  const d = Math.hypot(p.x, p.z);
  assert.ok(d > 120000 && d < 150000, `distance ${d}`);
  assert.ok(p.x > 0, "east of origin");
  assert.ok(p.z > 0, "south of origin (z = -north)");
  const bearing = (Math.atan2(p.x, -p.z) * 180) / Math.PI;
  assert.ok(bearing > 140 && bearing < 170, `bearing ${bearing}`);
});

test("curvature drop is about d^2 / 2R", () => {
  const p = toLocal(RAINIER.lat, RAINIER.lon, 0);
  const d = Math.hypot(p.x, p.z);
  const drop = (d * d) / (2 * 6371008.8);
  assert.ok(Math.abs(p.y + ORIGIN_ELEV_M + drop) < drop * 0.02 + 5, `y ${p.y} drop ${drop}`);
});

test("Rainier summit stays above the horizon from a 300 m camera", () => {
  const cam = { x: 0, y: 300, z: 0 };
  const p = toLocal(RAINIER.lat, RAINIER.lon, RAINIER.alt);
  const d = Math.hypot(p.x, p.z);
  const elevationAngle = Math.atan2(p.y - cam.y, d);
  // Sea-level horizon dip for the camera: acos(R/(R+h)); the summit must clear it.
  const horizonDip = -Math.acos(6371008.8 / (6371008.8 + 300 + ORIGIN_ELEV_M));
  assert.ok(elevationAngle > horizonDip, "summit below the sea-level horizon");
  assert.ok(elevationAngle > 0.005, `summit angle ${elevationAngle} rad above flat`);
});

test("fromLocal inverts toLocal on the ground", () => {
  for (const [lat, lon] of [[47.9226, -122.2749], [47.4931, -122.2158], [47.2077, -119.32]]) {
    const p = toLocal(lat, lon, 0);
    const b = fromLocal(p.x, p.z);
    assert.ok(Math.abs(b.lat - lat) < 1e-6 && Math.abs(b.lon - lon) < 1e-6, `${lat},${lon} -> ${b.lat},${b.lon}`);
  }
});

test("Seattle solar noon elevation on 2026-06-21 is about 66 deg", () => {
  // Local solar noon in Seattle is near 20:10 UTC.
  let best = -90;
  for (let m = 19 * 60; m < 21 * 60 + 30; m += 5) {
    const d = new Date(Date.UTC(2026, 5, 21, 0, m));
    best = Math.max(best, solarPosition(d, 47.6062, -122.3321).elevationDeg);
  }
  assert.ok(Math.abs(best - 65.9) < 0.6, `max elevation ${best}`);
});

test("sun is due south at solar noon and below the horizon at local midnight", () => {
  const noon = solarPosition(new Date(Date.UTC(2026, 5, 21, 20, 10)), 47.6062, -122.3321);
  assert.ok(Math.abs(noon.azimuthDeg - 180) < 3, `azimuth ${noon.azimuthDeg}`);
  const mid = solarPosition(new Date(Date.UTC(2026, 11, 21, 8, 0)), 47.9, -122.3);
  assert.ok(mid.elevationDeg < -20);
});
