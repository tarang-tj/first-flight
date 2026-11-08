import test from "node:test";
import assert from "node:assert/strict";
import { tileXY, lonToU, latToV, uToLon, vToLat, decodeTerrarium, sampleField, tilesCovering, usgsUrl } from "../web/world/tile-math.js";
import { JET_DIMS, variantFor, autoScale } from "../web/world/jet-dims.js";
import { mergeTrails, alongValues } from "../web/world/trail-merge.js";

test("tile math: known tile and round trips", () => {
  // Paine Field at z10 (u = 0.1603, v = 0.3487; Seattle 47.6 is 357).
  assert.deepEqual(tileXY(47.9063, -122.2816, 10), { x: 164, y: 356 });
  assert.ok(Math.abs(uToLon(lonToU(-122.28)) + 122.28) < 1e-9);
  assert.ok(Math.abs(vToLat(latToV(47.9)) - 47.9) < 1e-9);
  assert.match(usgsUrl(15, 5, 7), /tile\/15\/7\/5$/, "USGS is z/y/x");
});

test("terrarium decode", () => {
  assert.equal(decodeTerrarium(128, 0, 0), 0);
  assert.equal(decodeTerrarium(128, 10, 128), 10.5);
  assert.equal(decodeTerrarium(0, 0, 0), -32768);
});

test("tilesCovering and bilinear sampling", () => {
  const r = { u0: 0.25, v0: 0.25, u1: 0.5, v1: 0.5 };
  assert.deepEqual(tilesCovering(r, 2), { x0: 1, x1: 1, y0: 1, y1: 1 });
  const w = 256, data = new Float32Array(w * w);
  for (let y = 0; y < w; y++) for (let x = 0; x < w; x++) data[y * w + x] = x; // ramp
  const field = { z: 0, x0: 0, y0: 0, w, h: w, data };
  assert.ok(Math.abs(sampleField(field, 0.5, 0.5) - 127.5) < 1e-6);
});

test("jet dimensions are the true published values", () => {
  assert.equal(JET_DIMS["737-8"].length, 39.5);
  assert.equal(JET_DIMS["737-8"].span, 35.9);
  assert.equal(JET_DIMS["737-10"].length, 43.8);
  assert.equal(JET_DIMS["767"].length, 54.9);
  assert.equal(JET_DIMS["767"].span, 47.6);
  assert.equal(JET_DIMS["777F"].length, 63.7);
  assert.equal(JET_DIMS["777F"].span, 64.8);
  assert.equal(JET_DIMS["777-9"].length, 76.7);
  assert.equal(JET_DIMS["777-9"].span, 71.8);
  assert.equal(JET_DIMS["777-9"].foldTips, true);
  assert.equal(variantFor("777X"), "777-9");
  assert.equal(variantFor("737"), "737-8");
  assert.equal(variantFor("767"), "767");
});

test("autoScale: true size when close, grows with distance, capped", () => {
  assert.equal(autoScale(100, 39.5), 1);
  const s = autoScale(20000, 39.5);
  assert.ok(s > 5 && s < 20, `scale ${s}`);
  assert.equal(autoScale(1e9, 39.5), 400);
});

test("trail merge: one vertex block per segment, ranges line up, along is 0..1", () => {
  const mk = (n, dx) => Array.from({ length: n }, (_, i) => ({ x: i * 100 + dx, y: i * 10, z: 0 }));
  const m = mergeTrails([{ points: mk(5, 0), color: [1, 0.4, 0.1] }, { points: mk(3, 500), color: [1, 1, 1] }, { points: mk(1, 0), color: [1, 1, 1] }]);
  assert.equal(m.vertexCount, (4 + 2) * 4);
  assert.deepEqual(m.ranges, [[0, 16], [16, 8], [24, 0]]);
  assert.equal(m.index.length, 6 * 6);
  assert.equal(m.trail[16], 1);
  assert.equal(Math.max(...m.along), 1);
  assert.equal(Math.min(...m.along), 0);
  const a = alongValues([{ x: 0, y: 0, z: 0 }, { x: 10, y: 0, z: 0 }, { x: 40, y: 0, z: 0 }]);
  assert.deepEqual(Array.from(a), [0, 0.25, 1]);
});

test("weather parsing validates and clamps Open-Meteo output", async () => {
  const { parseWeather } = await import("../web/world/weather.js");
  assert.deepEqual(parseWeather({ current: { cloud_cover: 140, visibility: 24140, precipitation: 0.2 } }), { cloudCover: 100, visibilityM: 24140, precip: 0.2 });
  assert.equal(parseWeather({ current: { cloud_cover: "x" } }), null);
  assert.equal(parseWeather(null), null);
  assert.equal(parseWeather({ current: { cloud_cover: 10, visibility: -5 } }).visibilityM, 40000);
});
