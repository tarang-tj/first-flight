import test from "node:test";
import assert from "node:assert/strict";
import { classify, programFor } from "../web/air/classify.js";
import { samplePath, pathDuration, maxAltFt, bearingDeg } from "../web/air/path-player.js";

test("classify: BOE callsign and Boeing-owned are test, rest traffic", () => {
  assert.equal(classify({ flight: "BOE603  " }), "test");
  assert.equal(classify({ flight: "boe1" }), "test");
  assert.equal(classify({ flight: "UAL12", ownOp: "THE BOEING COMPANY" }), "test");
  assert.equal(classify({ flight: "DAL9", r: "N779XA" }), "test");
  assert.equal(classify({ flight: "BOEING1" }), "traffic"); // not BOE + digit
  assert.equal(classify({ flight: "ASA22", ownOp: "ALASKA AIRLINES INC" }), "traffic");
  assert.equal(classify({}), "traffic");
  assert.equal(classify(null), "traffic");
});

test("programFor maps type codes", () => {
  assert.equal(programFor("B38M"), "737");
  assert.equal(programFor("B763"), "767");
  assert.equal(programFor("B77W"), "777");
  assert.equal(programFor("B779"), "777X");
  assert.equal(programFor(undefined), "737");
});

const pts = [[0, 47.9, -122.28, 0], [60, 47.9, -122.0, 6000], [120, 48.2, -122.0, 6000]];

test("samplePath: clamps at both ends with a defined heading", () => {
  const a = samplePath(pts, -50);
  assert.equal(a.lon, -122.28);
  assert.equal(a.done, false);
  assert.ok(Math.abs(a.headingDeg - 90) < 1, `east heading, got ${a.headingDeg}`);
  assert.ok(a.pitchDeg > 0);
  const z = samplePath(pts, 999);
  assert.equal(z.lat, 48.2);
  assert.equal(z.done, true);
  assert.ok(Math.abs(z.headingDeg) < 1 || Math.abs(z.headingDeg - 360) < 1, `north heading, got ${z.headingDeg}`);
  assert.ok(Math.abs(z.pitchDeg) < 1e-9);
});

test("samplePath: interpolates mid-segment and switches heading at a vertex", () => {
  const m = samplePath(pts, 30);
  assert.ok(Math.abs(m.altFt - 3000) < 1e-6);
  assert.ok(Math.abs(m.lon - -122.14) < 1e-9);
  const after = samplePath(pts, 61);
  assert.ok(after.headingDeg < 10 || after.headingDeg > 350);
});

test("samplePath: empty, single point and a stationary segment", () => {
  assert.equal(samplePath([], 0), null);
  assert.equal(samplePath(null, 0), null);
  assert.equal(samplePath([[0, 1, 2, 300]], 5).altFt, 300);
  const still = [[0, 47.9, -122.2, 0], [10, 47.9, -122.2, 0], [20, 47.9, -122.1, 0]];
  assert.ok(Math.abs(samplePath(still, 5).headingDeg - 90) < 1);
});

test("duration, max altitude, bearing", () => {
  assert.equal(pathDuration(pts), 120);
  assert.equal(maxAltFt(pts), 6000);
  assert.ok(Math.abs(bearingDeg(0, 0, 1, 0)) < 1e-9);
});

import { trimToFlight } from "../web/air/path-player.js";
test("trimToFlight drops long taxi time and re-zeroes", () => {
  const g = (t) => [t, 47.5, -122.3, 0];
  const pts = [g(0), g(300), g(900), g(1500), [1560, 47.51, -122.29, 800], [1620, 47.6, -122.2, 5000], [1700, 47.7, -122.1, 800], g(1760), g(2300), g(3000)];
  const out = trimToFlight(pts);
  assert.ok(out.length < pts.length);
  assert.equal(out[0][0], 0);
  assert.ok(out.at(-1)[0] < 400, `kept ${out.at(-1)[0]} s`);
  assert.ok(out.some((p) => p[3] === 5000));
  const flat = [g(0), g(10), g(20)];
  assert.equal(trimToFlight(flat), flat);
});
