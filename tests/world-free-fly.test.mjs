import test from "node:test";
import assert from "node:assert/strict";
import { speedForHeight, floorY, clampToGround, glidePose, glideMs, wrapDelta, MIN_AGL_M } from "../web/world/free-fly.js";
import { PLACES, placePose } from "../web/world/places.js";
import { toLocal } from "../web/geo.js";

test("speed grows with height above ground, slow at the apron and fast at 30,000 ft", () => {
  assert.ok(speedForHeight(15) < 25, "precise near the ground");
  assert.ok(speedForHeight(-50) === speedForHeight(0), "negative height treated as ground");
  let prev = 0;
  for (const h of [0, 50, 500, 3000, 9144, 20000]) { const s = speedForHeight(h); assert.ok(s >= prev); prev = s; }
  assert.ok(speedForHeight(9144) > 1500 && speedForHeight(9144) <= 3200, "30,000 ft is fast");
  assert.equal(speedForHeight(1e7), 3200, "capped");
});

test("ground floor clamp keeps the camera above terrain, including rising ground ahead", () => {
  assert.equal(clampToGround(100, 100), 100 + MIN_AGL_M);
  assert.equal(clampToGround(900, 100), 900, "high enough stays put");
  assert.equal(clampToGround(100, 100, 300), 300 + MIN_AGL_M * 0.8, "a hill ahead raises the floor");
  assert.ok(floorY(0) >= MIN_AGL_M);
});

test("glide: endpoints exact, heading takes the short way, long hops arc up, short hops do not", () => {
  const a = { x: 0, y: 500, z: 0, headingDeg: 350, pitchDeg: 5 };
  const far = { x: 60000, y: 800, z: -40000, headingDeg: 10, pitchDeg: 9 };
  const g0 = glidePose(a, far, 0), g1 = glidePose(a, far, 1), mid = glidePose(a, far, 0.5);
  assert.deepEqual([g0.x, g0.y, g0.z], [0, 500, 0]);
  assert.deepEqual([g1.x, g1.y, g1.z, g1.pitchDeg], [60000, 800, -40000, 9]);
  assert.ok(Math.abs(wrapDelta(g1.headingDeg, 10)) < 1e-9);
  assert.ok(mid.headingDeg > 350 || mid.headingDeg < 10, "turns through north, not the long way");
  assert.ok(mid.y > 3000, "arcs well above both ends");
  const near = glidePose(a, { ...a, x: 800 }, 0.5);
  assert.equal(near.y, 500, "no arc on a short hop");
  assert.ok(glideMs(100000) > glideMs(1000) && glideMs(1e9) <= 9000);
});

test("places: all six exist, are inside the world, and each pose points at its place", () => {
  assert.deepEqual(PLACES.map((p) => p.key), ["renton", "everett", "bfi", "moses", "seattle", "rainier"]);
  for (const p of PLACES) {
    assert.ok(p.blurb.length > 20 && !p.blurb.includes(String.fromCharCode(0x2014)), `${p.key} blurb is plain`);
    const c = placePose(p), t = toLocal(p.lat, p.lon, p.elevM);
    assert.ok([c.x, c.y, c.z].every(Number.isFinite));
    assert.ok(Math.hypot(c.x, c.z) < 250000, `${p.key} within the world`);
    const d = Math.hypot(t.x - c.x, t.z - c.z);
    const bearing = ((Math.atan2(t.x - c.x, -(t.z - c.z)) * 180) / Math.PI + 360) % 360;
    assert.ok(Math.abs(wrapDelta(bearing, c.headingDeg)) < 0.5, `${p.key} heading faces the place`);
    const rayY = c.y - Math.tan((c.pitchDeg * Math.PI) / 180) * d;
    assert.ok(Math.abs(rayY - t.y) < 0.2 * d * Math.tan((c.pitchDeg * Math.PI) / 180) + 150, `${p.key} pitch lands on the place (miss ${Math.round(rayY - t.y)} m)`);
    assert.ok(p.altM > p.elevM + 100, `${p.key} camera clear of its own ground`);
  }
});
