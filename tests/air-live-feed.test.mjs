import test from "node:test";
import assert from "node:assert/strict";
import { startLive } from "../web/air/live-feed.js";

// A manual scheduler: records each requested delay, runs only when told to.
function fakeClock() {
  const q = [];
  return {
    delays: [],
    schedule(fn, ms) { this.delays.push(ms); q.push(fn); return q.length; },
    cancel() { q.length = 0; },
    async tick() { const fn = q.shift(); if (fn) await fn(); await new Promise((r) => setImmediate(r)); },
    pending: () => q.length,
  };
}

const ok = (body) => async () => ({ status: 200, json: async () => body });
const quiet = () => { const w = console.warn; console.warn = () => {}; return () => { console.warn = w; }; };

test("proxy null: offline, zero fetch calls, nothing scheduled", () => {
  let calls = 0; const statuses = [];
  const clock = fakeClock();
  startLive({ proxy: null, onUpdate() {}, onStatus: (s) => statuses.push(s), fetchImpl: () => { calls++; }, schedule: clock.schedule.bind(clock) });
  assert.deepEqual(statuses, ["offline"]);
  assert.equal(calls, 0);
  assert.equal(clock.pending(), 0);
});

test("polls every 5 s while healthy and reports live", async () => {
  const clock = fakeClock(); const statuses = []; const updates = [];
  const nowMs = 1_700_000_000_000;
  startLive({
    proxy: "https://p.example/", onUpdate: (ac, m) => updates.push([ac.length, m.ageMs]), onStatus: (s) => statuses.push(s),
    fetchImpl: ok({ ac: [{ hex: "a" }], now: nowMs - 3000 }), schedule: clock.schedule.bind(clock), cancel: clock.cancel, now: () => nowMs, hidden: () => false,
  });
  await new Promise((r) => setImmediate(r));
  await clock.tick();
  assert.deepEqual(clock.delays, [5000, 5000]);
  assert.deepEqual(statuses, ["live"]);
  assert.equal(updates[0][0], 1);
  assert.equal(updates[0][1], 3000);
});

test("non-200 backs off 60 s, then recovers to 5 s", async () => {
  const restore = quiet();
  const clock = fakeClock(); const statuses = []; let n = 0;
  startLive({
    proxy: "https://p.example", onUpdate() {}, onStatus: (s) => statuses.push(s),
    fetchImpl: async () => (n++ === 0 ? { status: 503, json: async () => ({}) } : { status: 200, json: async () => ({ ac: [], now: Date.now() }) }),
    schedule: clock.schedule.bind(clock), cancel: clock.cancel, hidden: () => false,
  });
  await new Promise((r) => setImmediate(r));
  assert.equal(clock.delays[0], 60000);
  await clock.tick();
  assert.equal(clock.delays[1], 5000);
  assert.deepEqual(statuses, ["offline", "live"]);
  restore();
});

test("network error after a success reports stale and backs off", async () => {
  const restore = quiet();
  const clock = fakeClock(); const statuses = []; let n = 0;
  startLive({
    proxy: "https://p.example", onUpdate() {}, onStatus: (s) => statuses.push(s),
    fetchImpl: async () => { if (n++ === 0) return { status: 200, json: async () => ({ ac: [], now: Date.now() }) }; throw new TypeError("network down"); },
    schedule: clock.schedule.bind(clock), cancel: clock.cancel, hidden: () => false,
  });
  await new Promise((r) => setImmediate(r));
  await clock.tick();
  assert.deepEqual(statuses, ["live", "stale"]);
  assert.equal(clock.delays.at(-1), 60000);
  restore();
});

test("malformed body counts as a failure", async () => {
  const restore = quiet();
  const clock = fakeClock(); const statuses = [];
  startLive({ proxy: "https://p.example", onUpdate() {}, onStatus: (s) => statuses.push(s), fetchImpl: ok({ nope: 1 }), schedule: clock.schedule.bind(clock), hidden: () => false });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(statuses, ["offline"]);
  assert.equal(clock.delays[0], 60000);
  restore();
});

test("old feed timestamp reports stale; stop() ends polling", async () => {
  const clock = fakeClock(); const statuses = [];
  const h = startLive({
    proxy: "https://p.example", onUpdate() {}, onStatus: (s) => statuses.push(s),
    fetchImpl: ok({ ac: [], now: 1_700_000_000_000 }), schedule: clock.schedule.bind(clock), cancel: clock.cancel, now: () => 1_700_000_000_000 + 120_000, hidden: () => false,
  });
  await new Promise((r) => setImmediate(r));
  assert.deepEqual(statuses, ["stale"]);
  h.stop();
  assert.equal(clock.pending(), 0);
});
