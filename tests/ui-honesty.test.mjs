import test from "node:test";
import assert from "node:assert/strict";
import { fmtDay, monthKey, hexOfPickId } from "../web/ui/format.js";
import { recordKind, airframeRows } from "../web/ui/jet-card.js";
import { headlineFor, trafficLine } from "../web/ui/live-panel.js";
import { buildSeries, summarize, gapSentence, unknownSeen, unknownLine, warmupLine, countedFromDate } from "../web/ui/ledger-model.js";
import { countsAt, timelineBounds } from "../web/ui/year-model.js";
import { ageSeconds } from "../web/ui/live-state.js";
import { startLive } from "../web/air/live-feed.js";

const T = Date.parse("2026-11-05T12:00:00Z") / 1000;
const base = { hex: "abc123", program: "737", born: "KRNT", flights: 1, firstFlight: { t: T } };

test("#3 uncounted airframes are never called born or first flight", () => {
  const labels = (a) => airframeRows(a).map((r) => r[0]);
  assert.ok(labels({ ...base, counted: true }).includes("Born at"));
  assert.ok(labels({ ...base, counted: true }).includes("First flight"));
  for (const a of [{ ...base, counted: false }, { ...base, counted: false, flightTest: true }, { ...base }]) {
    const l = labels(a);
    assert.ok(!l.includes("Born at") && !l.includes("First flight"), l.join());
    assert.ok(l.includes("First seen in our data") && l.includes("First seen at"));
    assert.equal(recordKind(a).title, "Aircraft record");
  }
  assert.equal(recordKind({ ...base, counted: false, flightTest: true }).note, "Boeing flight-test jet");
  assert.equal(recordKind({ ...base, counted: true }).title, "Birth certificate");
});

test("#9 year counters count only counted airframes", () => {
  const ledger = { coverage: { firstDay: "2026-01-01", lastDay: "2026-06-30" }, months: [{ month: "2026-01" }] };
  const b = timelineBounds(ledger, 0);
  const t = Date.parse("2026-05-01T00:00:00Z") / 1000;
  const mk = (hex, counted) => ({ hex, program: "737", flightTest: false, counted, firstFlight: { t } });
  const out = countsAt([mk("a", true), mk("b", false), mk("c", undefined)], t + 10, ledger, b);
  assert.equal(out["737"], 1);
});

test("#2 gap sentence and unknown count", () => {
  const ledger = { coverage: { firstDay: "2025-01-01" }, months: [
    { month: "2025-01", firstFlights: { "737": 1, unknown: 9 }, reported: { "737": 5 } },
    { month: "2025-03", firstFlights: { "737": 4, unknown: 3 }, reported: { "737": 8 } },
  ] };
  assert.equal(unknownSeen(ledger), 3); // warm-up month excluded
  assert.match(unknownLine(3), /not known yet: 3/);
  const s = summarize(buildSeries(ledger, "737"));
  assert.match(gapSentence("737", s, 3), /3 more first flights of unknown type are excluded from the per-program comparison/);
  assert.doesNotMatch(gapSentence("737", s, 0), /unknown/);
  assert.equal(unknownSeen({ months: [{ month: "2025-01", firstFlights: { "737": 1 } }] }), null);
});

test("#17 partial month uses countedFrom, is excluded, and the date is stated", () => {
  const ledger = { coverage: { firstDay: "2026-11-03" }, months: [
    { month: "2026-11", partial: true, countedFrom: "2026-12-03", warmup: false, firstFlights: { "737": 2 }, reported: { "737": 30 } },
    { month: "2026-12", firstFlights: { "737": 5 }, reported: { "737": 40 } },
  ] };
  const series = buildSeries(ledger, "737");
  assert.equal(series[0].warmup, true);
  assert.equal(series[0].countedFrom, "2026-12-03");
  assert.equal(summarize(series).seen, 5);
  assert.equal(countedFromDate(ledger), "2026-12-03");
  assert.match(warmupLine(ledger), /Counting starts on Dec 3, 2026/);
});

test("#17 BOE wording only for BOE callsigns", () => {
  const r = (callsign) => ({ isNewJet: false, callsign, from: "KBFI", to: "KBFI", t0: T, pts: [[0, 1, 1, 0], [60, 1, 2, 0]] });
  assert.match(headlineFor(r("BOE12"), T * 1000), /^Latest Boeing test flight:/);
  assert.match(headlineFor(r("ASA17"), T * 1000), /^Latest production or test flight:/);
  assert.match(trafficLine(2, 5), /production or test flights/);
});

test("#4 dates are Pacific, month buckets are Pacific", () => {
  const t = Date.parse("2026-04-01T00:30:00Z") / 1000; // Mar 31, 5:30 PM PDT
  assert.equal(fmtDay(t), "Mar 31, 2026");
  assert.equal(monthKey(t), "2026-03");
});

test("#13 pick ids resolve to the hex", () => {
  assert.equal(hexOfPickId("replay:a2c39e:0"), "a2c39e");
  assert.equal(hexOfPickId("live:A2C39E"), "a2c39e");
  assert.equal(hexOfPickId("ride:a2c39e"), "a2c39e");
  assert.equal(hexOfPickId("a2c39e"), "a2c39e");
});

test("#14 badge age is measured from the feed's own timestamp", async () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const body = { now: now - 15000, ac: [] };
  const metas = [];
  const h = startLive({ proxy: "https://p.example", onUpdate: (_a, m) => metas.push(m), onStatus() {}, now: () => now,
    fetchImpl: async () => ({ status: 200, json: async () => body }), schedule: () => 1, cancel() {}, hidden: () => false });
  await new Promise((r) => setImmediate(r));
  h.stop();
  assert.equal(metas[0].feedAt, now - 15000);
  assert.equal(ageSeconds({ feedAt: metas[0].feedAt, fetchedAt: metas[0].fetchedAt }, now), 15);
  assert.equal(ageSeconds({ fetchedAt: now - 3000 }, now), 3);
});

// The ledger build writes `warmupPartial` (tools/ledger/outputs.py); the UI must read it.
import { isPartial } from "../web/ui/ledger-model.js";
test("ledger model reads the partial-month field the ledger build writes", () => {
  const ledger = { months: [{ month: "2025-01", warmup: true, warmupPartial: true, countedFrom: "2025-01-31" }] };
  assert.equal(isPartial(ledger.months[0]), true);
  assert.equal(countedFromDate(ledger), "2025-01-31");
});
