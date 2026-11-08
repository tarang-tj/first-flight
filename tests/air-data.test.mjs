import test from "node:test";
import assert from "node:assert/strict";
import { normalizeLegs, pickReplay, newestJets, loadJson } from "../web/air/data.js";
import { routeText } from "../web/ui/format.js";

const pts = (n) => Array.from({ length: n }, (_, i) => [i * 30, 47.9 + i * 0.001, -122.2, i * 100]);
const leg = (o) => ({ hex: "a", callsign: "BOE1", from: "KRNT", to: "KBFI", t0: 100, pts: pts(5), ...o });

test("normalizeLegs: accepts array or wrapped, drops pathless, newest first", () => {
  const legs = normalizeLegs([leg({ t0: 1 }), leg({ t0: 9, hex: "b" }), { hex: "c", pts: [] }]);
  assert.deepEqual(legs.map((l) => l.hex), ["b", "a"]);
  assert.equal(normalizeLegs({ legs: [leg()] }).length, 1);
  assert.deepEqual(normalizeLegs(null), []);
});

test("pickReplay: a flagged first-flight leg is called a new jet; otherwise never", async () => {
  const noMonth = async () => null;
  const flagged = normalizeLegs([leg({ t0: 5, firstFlight: true }), leg({ t0: 9, hex: "z" })]);
  const r1 = await pickReplay({ airframes: [], legs: flagged, loadMonth: noMonth, monthOf: () => "x" });
  assert.equal(r1.isNewJet, true);
  assert.equal(r1.t0, 5);
  const plain = normalizeLegs([leg({ t0: 9 })]);
  const r2 = await pickReplay({ airframes: [{ hex: "a", counted: false, firstFlight: { t: 9 } }], legs: plain, loadMonth: noMonth, monthOf: () => "x" });
  assert.equal(r2.isNewJet, false, "warm-up airframes must not be called new");
  assert.equal(await pickReplay({ airframes: [], legs: [], loadMonth: noMonth, monthOf: () => "x" }), null);
});

test("pickReplay prefers a leg worth watching over a hop", async () => {
  const hop = leg({ t0: 20, hex: "h", durationS: 120, maxAltFt: 500 });
  const real = leg({ t0: 10, hex: "r", durationS: 3000, maxAltFt: 20000 });
  const r = await pickReplay({ airframes: [], legs: normalizeLegs([hop, real]), loadMonth: async () => null, monthOf: () => "x" });
  assert.equal(r.hex, "r");
});

test("newestJets skips the flight-test fleet; loadJson returns null and warns on failure", async () => {
  const air = [{ hex: "1", flightTest: true, firstFlight: { t: 9 } }, { hex: "2", firstFlight: { t: 3 } }, { hex: "3", firstFlight: { t: 5 } }];
  assert.deepEqual(newestJets(air, 5).map((a) => a.hex), ["3", "2"]);
  const w = console.warn; let warned = 0; console.warn = () => { warned++; };
  assert.equal(await loadJson("nope-1", async () => ({ ok: false, status: 404 })), null);
  assert.equal(await loadJson("nope-2", async () => { throw new Error("down"); }), null);
  console.warn = w;
  assert.equal(warned, 2);
});

test("routeText covers missing ends", () => {
  assert.equal(routeText("KRNT", "KBFI"), "Renton to Boeing Field");
  assert.equal(routeText("KBFI", "KBFI"), "local flight from Boeing Field");
  assert.equal(routeText(null, "KRNT"), "into Renton");
  assert.equal(routeText(null, null), "route not recorded");
});
