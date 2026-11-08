import test from "node:test";
import assert from "node:assert/strict";
import { createSkyClock, RATES } from "../web/air/sky-clock.js";
import { monthKeyPT, shiftMonth, monthsFor, tailSeconds, posAt, stateAt, activeFlights, tailPoints, createSkyFeed, nearCount, memoryFlights } from "../web/air/sky-feed.js";

const SPAN = [1000, 2000];

test("clock: rates, play/pause and clamping", () => {
  const c = createSkyClock({ span: SPAN, t: 1000, rate: 600 });
  c.tick(0.5);
  assert.equal(c.t, 1300);
  c.pause(); c.tick(5);
  assert.equal(c.t, 1300);
  c.play(); c.setRate(60); c.tick(1);
  assert.equal(c.t, 1360);
  assert.equal(c.setRate(7), 60, "unknown rate ignored");
  assert.equal(c.set(-5), 1000);
  assert.equal(c.set(9999), 2000);
  assert.deepEqual(RATES, [1, 60, 600, 3600, 86400]);
});

test("clock: stops at the end and play restarts from the start", () => {
  const c = createSkyClock({ span: SPAN, t: 1990, rate: 3600 });
  c.tick(1);
  assert.equal(c.t, 2000);
  assert.equal(c.playing, false);
  c.play();
  assert.equal(c.t, 1000);
  assert.throws(() => createSkyClock({ span: [5, 5] }));
});

test("month keys are Pacific, and selection spans month boundaries", () => {
  // 2025-02-01 07:30 UTC is still Jan 31 in Pacific
  const t = Date.UTC(2025, 1, 1, 7, 30) / 1000;
  assert.equal(monthKeyPT(t), "2025-01");
  assert.equal(monthKeyPT(t + 3600), "2025-02");
  assert.equal(shiftMonth("2025-01", -1), "2024-12");
  assert.equal(shiftMonth("2025-12", 1), "2026-01");
  const index = { months: ["2025-01", "2025-02", "2025-03"].map((key) => ({ key })) };
  assert.deepEqual(monthsFor(t + 3600, index), { need: ["2025-02", "2025-01"], prefetch: ["2025-03"] });
  assert.deepEqual(monthsFor(t, index), { need: ["2025-01"], prefetch: ["2025-02"] }, "months absent from the index are skipped");
});

const north = { id: "a-100", hex: "a", t0: 100, t1: 220, pts: [[0, 47, -122, 0], [60, 47.01, -122, 3000], [120, 47.02, -122, 6000]] };

test("interpolation: position between points, heading, climb", () => {
  const p = posAt(north.pts, 30);
  assert.ok(Math.abs(p.lat - 47.005) < 1e-9);
  assert.equal(p.altFt, 1500);
  const s = stateAt(north, 100 + 60);
  assert.ok(s.headingDeg < 1 || s.headingDeg > 359, `heading ${s.headingDeg}`);
  assert.ok(s.climbFpm > 2900 && s.climbFpm < 3100, `climb ${s.climbFpm}`);
  assert.ok(s.pitchDeg > 0);
  assert.ok(Math.abs(s.rollDeg) < 1, "straight track does not bank");
  assert.equal(stateAt(north, 99), null);
  assert.equal(stateAt(north, 221), null);
  const east = { ...north, pts: [[0, 47, -122, 0], [60, 47, -121.99, 0], [120, 47, -121.98, 0]] };
  assert.ok(Math.abs(stateAt(east, 160).headingDeg - 90) < 1);
});

test("banks into a turn", () => {
  const pts = [];
  for (let i = 0; i <= 20; i++) { // fast right turn: heading sweeps clockwise
    const a = (i / 20) * Math.PI;
    pts.push([i * 30, 47 + 0.3 * Math.sin(a), -122 + 0.4 * (1 - Math.cos(a)), 5000]);
  }
  const f = { id: "t", t0: 0, t1: 600, pts };
  assert.ok(stateAt(f, 300).rollDeg > 3, `roll ${stateAt(f, 300).rollDeg}`);
});

test("activeFlights and tails", () => {
  const other = { id: "b-500", t0: 500, t1: 600, pts: [[0, 1, 1, 0]] };
  assert.deepEqual(activeFlights([[north], [other]], 150).map((f) => f.id), ["a-100"]);
  assert.equal(activeFlights([[north], [other]], 400).length, 0);
  const tail = tailPoints(north, 100 + 90, 60);
  const near = (a, b) => a.every((v, i) => Math.abs(v - b[i]) < 1e-9);
  assert.ok(near(tail[0], [47.005, -122, 1500]), "tail starts sec behind");
  assert.ok(near(tail[tail.length - 1], [47.015, -122, 4500]), "tail ends at the head");
  assert.equal(tailPoints(north, 100, 600).length, 2, "at takeoff the tail is just the head");
  assert.ok(tailPoints({ ...north, pts: Array.from({ length: 400 }, (_, i) => [i * 30, 47, -122, 0]), t1: 1e5 }, 12000, 1e5, 100).length <= 100);
  assert.ok(tailSeconds(1) < tailSeconds(600) && tailSeconds(86400) <= 10800);
});

test("feed: flight crossing a month end is found via the previous month", async () => {
  const t = Date.UTC(2025, 1, 1, 8, 30) / 1000; // 00:30 Feb 1 Pacific
  const cross = { id: "x-1", hex: "x", t0: t - 1800, t1: t + 1800, pts: [[0, 47, -122, 0], [1800, 47.1, -122, 5000], [3600, 47.2, -122, 9000]] };
  const files = {
    "d/index.json": { months: [{ key: "2025-01" }, { key: "2025-02" }], span: [t - 99999, t + 99999], moments: [] },
    "d/2025-01.json": [cross],
    "d/2025-02.json": [],
  };
  const asked = [];
  const feed = createSkyFeed({ base: "d", load: async (u) => { asked.push(u); return files[u] ?? null; } });
  await feed.loadIndex();
  assert.equal(feed.isReady(t), false);
  assert.equal(await feed.ensure(t), true);
  assert.equal(feed.isReady(t), true);
  const act = feed.activeAt(t);
  assert.equal(act.length, 1);
  assert.equal(act[0].flight.id, "x-1");
  assert.ok(Math.abs(act[0].lat - 47.1) < 1e-6);
  assert.equal(feed.activeAt(t + 7200).length, 0);
  assert.ok(asked.includes("d/2025-01.json") && asked.includes("d/2025-02.json"));
});

test("feed: failed month load is not cached as ready", async () => {
  const feed = createSkyFeed({ base: "d", load: async (u) => (u.endsWith("index.json") ? { months: [{ key: "2025-01" }], span: [0, 10], moments: [] } : null) });
  await feed.loadIndex();
  assert.equal(await feed.ensure(1735689600 + 86400), false);
});

test("nearCount and memoryFlights", () => {
  assert.equal(nearCount([{ lat: 47.9, lon: -122.28 }, { lat: 40, lon: -100 }, { lat: 47.5, lon: -122.3 }]), 2);
  const old = { id: "o", t0: 0, t1: 1000, pts: [[0, 1, 1, 0], [10, 1, 1, 0]] };
  const mem = memoryFlights([[old, { ...old, id: "n", t1: 5000 }]], 6000, 3000);
  assert.deepEqual(mem.map((m) => m.flight.id), ["n"]);
  assert.ok(mem[0].age > 0.3 && mem[0].age < 0.4);
});

test("feed: bestMoment prefers the moment with most jets near Paine Field", async () => {
  const mk = (id, t0, lat) => ({ id, hex: id, t0, t1: t0 + 100, pts: [[0, lat, -122.28, 3000], [100, lat, -122.28, 3000]] });
  const files = {
    "d/index.json": { months: [{ key: "2025-01" }], span: [0, 9e9], moments: [{ t: 1736100060, n: 2 }, { t: 1736100560, n: 2 }, { t: 1736101060, n: 3 }] },
    "d/2025-01.json": [mk("a", 1736100000, 47.9), mk("b", 1736100000, 47.8), mk("c", 1736100500, 47.9), mk("d", 1736100500, 30), mk("e", 1736101000, 10), mk("f", 1736101000, 20), mk("g", 1736101000, 47.9)],
  };
  const feed = createSkyFeed({ base: "d", load: async (u) => files[u] ?? null });
  await feed.loadIndex();
  const best = await feed.bestMoment();
  assert.equal(best.t, 1736100060);
  assert.equal(best.near, 2);
});
