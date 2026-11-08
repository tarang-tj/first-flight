import test from "node:test";
import assert from "node:assert/strict";
import { samplePathSmooth, groundSpeedKt, arcFractionAt } from "../web/air/path-player.js";
import { fmtClock } from "../web/ui/format.js";

// Due north at ~0.001 deg lat per 10 s (111 m / 10 s = 11.1 m/s = 21.6 kt), then a 90 degree turn east.
const L = [[0, 47.0, -122.0, 0], [10, 47.001, -122.0, 0], [20, 47.002, -122.0, 0], [30, 47.002, -121.9985, 0], [40, 47.002, -121.997, 0]];

test("ground speed comes from the recorded points", () => {
  const kt = groundSpeedKt(L, 5, 5);
  assert.ok(Math.abs(kt - 21.6) < 0.5, `got ${kt}`);
  assert.equal(groundSpeedKt([[0, 47, -122, 0]], 0), 0);
  assert.equal(groundSpeedKt(L, 500, 5) >= 0, true);
});

test("smoothed heading turns gradually through a corner instead of snapping", () => {
  const before = samplePathSmooth(L, 14, 8).headingDeg;
  const at = samplePathSmooth(L, 20, 8).headingDeg;
  const after = samplePathSmooth(L, 26, 8).headingDeg;
  assert.ok(before < 20, `north before the corner, got ${before}`);
  assert.ok(at > 30 && at < 70, `mid-turn at the corner, got ${at}`);
  assert.ok(after > 70, `heading east after, got ${after}`);
});

test("arc fraction follows distance flown, not time", () => {
  assert.equal(arcFractionAt(L, 0), 0);
  assert.ok(Math.abs(arcFractionAt(L, 40) - 1) < 1e-9);
  const f = arcFractionAt(L, 20);
  assert.ok(f > 0.4 && f < 0.6, `halfway in time on a uniform path, got ${f}`);
  // a path that dawdles then sprints: halfway in time is far from halfway in distance
  const lag = [[0, 47, -122, 0], [100, 47.0001, -122, 0], [110, 47.01, -122, 0]];
  assert.ok(arcFractionAt(lag, 100) < 0.05);
});

test("stopwatch format", () => {
  assert.equal(fmtClock(754), "12:34");
  assert.equal(fmtClock(4000), "1:06:40");
  assert.equal(fmtClock(-3), "0:00");
});
