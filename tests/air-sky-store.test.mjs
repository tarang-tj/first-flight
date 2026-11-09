import test from "node:test";
import assert from "node:assert/strict";
import { createMonthStore } from "../web/air/sky-store.js";
import { createSkyFeed, stateAt, parkedHeading } from "../web/air/sky-feed.js";
import { createSkyClock } from "../web/air/sky-clock.js";

const keys = (n) => Array.from({ length: n }, (_, i) => `2025-${String(i + 1).padStart(2, "0")}`);
const idx = (n) => ({ months: keys(n).map((key) => ({ key })), span: [0, 9e9], moments: [] });

test("store: LRU keeps at most max months and never evicts a kept one", async () => {
  const store = createMonthStore({ base: "d", max: 3, load: async () => [{ id: "x" }] });
  for (const k of keys(6)) await store.fetch(k);
  store.trim(["2025-01"]);
  assert.equal(store.size, 3);
  assert.ok(store.has("2025-01"), "kept month survives although it is the oldest");
  assert.ok(store.has("2025-06"), "newest survives");
  assert.ok(!store.has("2025-02"));
});

test("store: reading a month marks it recently used", async () => {
  const store = createMonthStore({ base: "d", max: 2, load: async () => [{}] });
  await store.fetch("2025-01"); await store.fetch("2025-02");
  store.get("2025-01");
  await store.fetch("2025-03");
  store.trim();
  assert.deepEqual(store.keys().sort(), ["2025-01", "2025-03"]);
});

test("store: a failed load is not cached, the next fetch retries (month)", async () => {
  let calls = 0;
  const store = createMonthStore({ base: "d", load: async () => (++calls === 1 ? null : [{ id: "a" }]) });
  assert.equal(await store.fetch("2025-01"), null);
  assert.equal(store.has("2025-01"), false);
  assert.deepEqual(await store.fetch("2025-01"), [{ id: "a" }]);
  assert.equal(calls, 2);
  const thrower = createMonthStore({ base: "d", load: async () => { throw new Error("boom"); } });
  assert.equal(await thrower.fetch("2025-01"), null);
});

test("feed: failed month and failed index both retry on the next call; scrubbing stays bounded", async () => {
  let indexCalls = 0, monthCalls = 0;
  const load = async (u) => {
    if (u.endsWith("index.json")) return ++indexCalls === 1 ? null : idx(12);
    return u.endsWith("2025-02.json") && ++monthCalls === 1 ? null : [];
  };
  const feed = createSkyFeed({ base: "d", load, maxMonths: 4 });
  assert.equal(await feed.loadIndex(), null);
  assert.ok(await feed.loadIndex(), "second call retries and succeeds");
  const t = (m) => Date.UTC(2025, m - 1, 15, 20) / 1000;
  assert.equal(await feed.ensure(t(2)), false, "first month fetch failed");
  assert.equal(await feed.ensure(t(2)), true, "retried and loaded");
  for (let m = 3; m <= 12; m++) await feed.ensure(t(m)); // a full scrub across the year
  assert.ok(feed.loadedMonths.length <= 4, `held ${feed.loadedMonths.length} months`);
  assert.ok(feed.isReady(t(12)), "the months the current time needs are kept");
});

test("feed: a span that is not finite numbers is rejected", async () => {
  const bad = { months: [], span: [null, null], moments: [] };
  assert.equal(await createSkyFeed({ load: async () => bad }).loadIndex(), null);
  assert.equal(await createSkyFeed({ load: async () => ({ months: [], span: [5, 5] }) }).loadIndex(), null);
});

test("bank angle matches a steady turn (turn rate divisor is 60 s, not 40 s)", () => {
  const v = 150, omegaDeg = 0.3, R = v / (omegaDeg * Math.PI / 180); // metres
  const lat0 = 47, lon0 = -122, pts = [];
  for (let i = 0; i <= 60; i++) {
    const a = (omegaDeg * i * 30 * Math.PI) / 180; // clockwise turn
    const e = R * (1 - Math.cos(a)), n = R * Math.sin(a);
    pts.push([i * 30, lat0 + n / 111320, lon0 + e / (111320 * Math.cos(lat0 * Math.PI / 180)), 5000]);
  }
  const s = stateAt({ id: "c", t0: 0, t1: 1800, pts }, 900);
  const expect = (Math.atan((v * omegaDeg * Math.PI / 180) / 9.81) * 180) / Math.PI;
  assert.ok(Math.abs(s.rollDeg - expect) < 0.5, `roll ${s.rollDeg.toFixed(2)} vs ${expect.toFixed(2)}`);
});

test("parked heading is the same however the track was sampled before", () => {
  const f = { id: "p", t0: 0, t1: 300, pts: [[0, 47, -122, 0], [30, 47, -122, 0], [60, 47, -122, 0], [90, 47.01, -122, 0], [120, 47.02, -122, 0]] };
  const a = stateAt(f, 100), b = stateAt(f, 10), c = stateAt(f, 100);
  assert.ok(Math.abs(b.headingDeg - a.headingDeg) < 1e-9 || b.headingDeg < 1 || b.headingDeg > 359, "parked jet faces its departure direction");
  assert.equal(a.headingDeg, c.headingDeg);
  assert.ok(parkedHeading(f.pts, 10) < 1 || parkedHeading(f.pts, 10) > 359);
  assert.equal(parkedHeading([[0, 1, 1, 0]], 0), 0);
});

test("clock: Play at the end restarts at restartAt when given, else at the start", () => {
  const c = createSkyClock({ span: [1000, 2000], t: 2000, restartAt: 1500, playing: false });
  c.play();
  assert.equal(c.t, 1500);
  const d = createSkyClock({ span: [1000, 2000], t: 2000, playing: false });
  d.play();
  assert.equal(d.t, 1000);
});
