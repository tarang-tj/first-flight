import test from "node:test";
import assert from "node:assert/strict";

// Minimal DOM: just enough for dom.js h()/clear().
function el() {
  const n = { nodeType: 1, children: [], firstChild: null, classList: { add() {} }, removed: false,
    setAttribute() {}, addEventListener() {}, set textContent(v) {}, remove() { n.removed = true; },
    append(...k) { n.children.push(...k); n.firstChild = n.children[0] ?? null; },
    removeChild(c) { n.children = n.children.filter((x) => x !== c); n.firstChild = n.children[0] ?? null; } };
  return n;
}
globalThis.document = { createElement: el, createTextNode: (t) => ({ nodeType: 3, t }) };
globalThis.innerWidth = 1280;
const { createRide } = await import("../web/ui/ride.js");

const flight = [[0, 47.9, -122.2, 0], [30, 47.9, -122.2, 2000], [60, 47.9, -122.2, 5000], [90, 47.9, -122.2, 2000], [120, 47.9, -122.2, 0]];
const af = (hex) => ({ hex, program: "737", reg: null, firstFlight: { t: 100, callsign: "BOE1" } });

function rig(pathFor) {
  const log = { jets: 0, disposed: 0, tickers: 0, offs: 0, suspends: 0, resumes: 0, bars: [] };
  const rideHost = el();
  const orig = rideHost.append;
  rideHost.append = (b) => { log.bars.push(b); orig(b); };
  const ctx = {
    world: { addJet: () => { log.jets++; return { setHighlight() {}, setPose() {}, dispose() { log.disposed++; } }; }, addTrail: () => ({ dispose() {}, setProgress() {} }) },
    geo: { FT: 0.3048, toLocal: (a, b, c) => ({ x: a, y: c, z: b }) },
    ticker: { add: () => { log.tickers++; return () => { log.offs++; }; } },
    chrome: { rideHost }, camera: { drive() {}, release() {}, setFraming() {}, step() {} },
    legs: [], loadMonth: pathFor,
    suspendMode: () => { log.suspends++; }, resumeMode: () => { log.resumes++; },
  };
  return { ride: createRide(ctx), log, ctx };
}
const month = (hexes) => async () => hexes.map((hex) => ({ hex, pts: flight }));
const tick = () => new Promise((r) => setImmediate(r));

test("#10 a double start leaves exactly one live ride", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ride, log } = rig(async () => { await gate; return [{ hex: "aaaaaa", pts: flight }, { hex: "bbbbbb", pts: flight }]; });
  const p1 = ride.start(af("aaaaaa"), () => {});
  const p2 = ride.start(af("bbbbbb"), () => {});
  release();
  await Promise.all([p1, p2]);
  assert.equal(log.jets, 1);
  assert.equal(log.tickers, 1);
  assert.equal(log.bars.length, 1);
  ride.stop();
  assert.equal(log.offs, 1);
  assert.equal(log.disposed, 1);
  assert.ok(log.bars[0].removed);
});

test("#16 a failed start after an active ride restores the previous mode", async () => {
  const { ride, log } = rig(month(["aaaaaa"]));
  await ride.start(af("aaaaaa"), () => {});
  assert.equal(log.suspends, 1);
  let msg = null;
  await ride.start(af("cccccc"), (m) => { msg = m; }); // no path for cccccc
  assert.match(msg, /No recorded path/);
  assert.equal(log.resumes, 1); // mode restored, stage not left empty
  assert.equal(ride.active, false);
  assert.equal(log.offs, 1);
});

test("#10 a stop while the path loads cancels the pending start", async () => {
  let release;
  const gate = new Promise((r) => { release = r; });
  const { ride, log } = rig(async () => { await gate; return [{ hex: "aaaaaa", pts: flight }]; });
  const p = ride.start(af("aaaaaa"), () => {});
  ride.stop(true);
  release();
  await p;
  assert.equal(log.jets, 0);
  assert.equal(ride.active, false);
});

test("a throwing world cleans up and restores the mode", async () => {
  const { ride, log, ctx } = rig(month(["aaaaaa"]));
  ctx.world.addTrail = () => { throw new Error("boom"); };
  let msg = null;
  await ride.start(af("aaaaaa"), (m) => { msg = m; });
  assert.match(msg, /could not start/);
  assert.equal(log.disposed, 1);
  assert.equal(log.resumes, 1);
  assert.equal(ride.active, false);
});
