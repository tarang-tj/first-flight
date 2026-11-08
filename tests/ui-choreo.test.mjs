import test from "node:test";
import assert from "node:assert/strict";
import { blendShot, wrapDelta, makeSimClock, yearShot, labelAlpha, REGION_SHOT, STATE_SHOT } from "../web/ui/choreo.js";
import { phaseAt, storyLength, flightStart, shotFor, entryTime, P } from "../web/ui/live-story.js";
import { labelStep, axisLabel, readoutText, niceMax } from "../web/ui/ledger-chart.js";

const shot = (x, d, h = 0, p = 10) => ({ target: { x, y: 0, z: 0 }, distance: d, headingDeg: h, pitchDeg: p });

test("blendShot: endpoints, shortest heading, and an arc that rises mid-move", () => {
  const a = shot(0, 1000, 350), b = shot(1000, 4000, 10);
  assert.ok(Math.abs(blendShot(a, b, 0).distance - 1000) < 1e-6);
  assert.ok(Math.abs(blendShot(a, b, 1).distance - 4000) < 1e-6);
  assert.equal(wrapDelta(350, 10), 20);
  assert.ok(Math.abs(blendShot(a, b, 0.5).headingDeg - 360) < 1e-9, "350 -> 10 passes through 0/360, not 180");
  const flat = blendShot(a, b, 0.5).distance, arc = blendShot(a, b, 0.5, 1).distance;
  assert.ok(arc > flat * 2.5, "arc bows the camera outward");
});

test("sim clock: slow takeoff, never runs backwards, lands exactly on the flight's end", () => {
  const dur = 3500;
  const at = makeSimClock(dur, { chase: 15, run: 11 });
  assert.equal(at(0), 0);
  assert.ok(at(1) < 8 && at(1) > 4, "about 6x at the start");
  let prev = -1;
  for (let t = 0; t <= 40; t += 0.25) { const s = at(t); assert.ok(s >= prev, `monotonic at ${t}`); prev = s; }
  assert.ok(Math.abs(at(26) - dur) < 1e-6 && at(99) === dur);
  assert.ok(makeSimClock(120)(26) <= 120, "a short hop is clamped to its own length");
});

test("story phases run in order and the intro is skipped after the first flight", () => {
  const names = [];
  for (let t = 0; t < storyLength(true); t += 0.5) { const n = phaseAt(t, true).name; if (names.at(-1) !== n) names.push(n); }
  assert.deepEqual(names, ["hero", "glide", "chase", "run", "pull", "hold", "fade"]);
  assert.equal(phaseAt(0, false).name, "glide");
  assert.equal(storyLength(true) - storyLength(false), P.hero);
  assert.equal(flightStart(true), P.hero + P.glide);
  assert.equal(phaseAt(storyLength(true) + 1).name, "end");
});

test("a jet beyond the terrain edge is not chased: the camera frames the region instead", () => {
  const final = shot(36000, 40000, 20, 44);
  const env = (x) => ({ jet: { x, y: 9000, z: 0 }, heading: 90, jetLen: 70, final });
  const near = shotFor({ name: "run", k: 0.5 }, env(20000));
  assert.equal(near.target.x, 20000, "close in: the jet is the target");
  const far = shotFor({ name: "run", k: 0.5 }, env(300000));
  assert.equal(far.target.x, final.target.x, "far out: the region is the target");
  assert.ok(far.distance > 30000);
  assert.equal(shotFor({ name: "pull", k: 0 }, env(300000)).target.x, final.target.x, "the pull starts where the run ended");
});

test("year film rises from the region to the state view and settles", () => {
  assert.ok(Math.abs(yearShot(0).distance - REGION_SHOT.distance) < 1e-3);
  assert.ok(Math.abs(yearShot(1).distance - STATE_SHOT.distance) < 1e-3);
  let prev = 0;
  for (let f = 0; f <= 1; f += 0.05) { const d = yearShot(f).distance; assert.ok(d >= prev - 1e-6); prev = d; }
  assert.ok(yearShot(1, 0, 0.46).distance < STATE_SHOT.distance, "portrait settles nearer");
});

test("labels fade by camera distance", () => {
  const o = { min: 900, max: 45000 };
  assert.equal(labelAlpha(60000, o), 0);
  assert.equal(labelAlpha(100, o), 0);
  assert.equal(labelAlpha(20000, o), 1);
  const edge = labelAlpha(40000, o);
  assert.ok(edge > 0 && edge < 1);
});

test("ledger chart: labels land on Jan/Apr/Jul... and the readout is plain", () => {
  assert.equal(labelStep(22), 4);
  assert.equal(labelStep(6), 1);
  assert.equal(axisLabel("2025-01", 4), "Jan '25");
  assert.equal(axisLabel("2025-05", 4), "May");
  assert.equal(axisLabel("2025-02", 4), null);
  assert.equal(niceMax(41), 50);
  assert.match(readoutText({ month: "2025-03", seen: 1, reported: 33, warmup: false }), /Mar 2025: 1 first flight seen, Boeing reported 33/);
  assert.match(readoutText({ month: "2025-01", seen: 4, reported: null, warmup: true }), /no Boeing figure.*warm-up/);
});

test("an arrival slows into the landing and puts the close chase last", () => {
  const dur = 1800, T = P.chase + P.run;
  const arr = makeSimClock(dur, { chase: P.chase, run: P.run, reverse: true });
  assert.equal(arr(0), 0);
  assert.ok(Math.abs(arr(T) - dur) < 1e-6);
  assert.ok(dur - arr(T - 1) < 8 && dur - arr(T - 1) > 4, "about 6x just before touchdown");
  const names = [];
  for (let t = 0; t < storyLength(false); t += 0.5) { const n = phaseAt(t, false, true).name; if (names.at(-1) !== n) names.push(n); }
  assert.deepEqual(names, ["glide", "run", "chase", "pull", "hold", "fade"]);
});

test("entry time is when the path first comes within reach of the terrain", () => {
  const pts = [{ x: 400000, z: 0, t: 0 }, { x: 200000, z: 0, t: 300 }, { x: 80000, z: 0, t: 500 }, { x: 0, z: 0, t: 900 }];
  assert.equal(entryTime(pts), 500);
  assert.equal(entryTime([{ x: 400000, z: 0, t: 0 }]), null);
});
