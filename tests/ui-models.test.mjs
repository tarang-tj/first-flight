import test from "node:test";
import assert from "node:assert/strict";
import { relativeAgo, fmtDuration, monthLabel, monthKey, monthStart, monthRange, airportName, fmtAlt } from "../web/ui/format.js";
import { buildSeries, summarize, gapSentence, warmupEnd, coverageLine } from "../web/ui/ledger-model.js";
import { countsAt, timelineBounds, monthsUpTo, timeToFraction, fractionToTime, SIM_RATE } from "../web/ui/year-model.js";
import { headlineFor } from "../web/ui/live-mode.js";

test("relativeAgo is computed from data", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const t = (h) => now / 1000 - h * 3600;
  assert.equal(relativeAgo(now, t(6)), "6 h ago");
  assert.equal(relativeAgo(now, t(0.5)), "30 min ago");
  assert.equal(relativeAgo(now, t(72)), "3 days ago");
  assert.equal(relativeAgo(now, now / 1000 + 100), "just now");
});

test("small formatters", () => {
  assert.equal(fmtDuration(4320), "1 h 12 min");
  assert.equal(fmtDuration(0), "unknown");
  assert.equal(monthLabel("2025-03"), "Mar 2025");
  assert.equal(monthKey(monthStart("2026-02") + 12 * 3600), "2026-02");
  assert.deepEqual(monthRange(monthStart("2025-11") + 43200, monthStart("2026-02") + 43200), ["2025-11", "2025-12", "2026-01", "2026-02"]);
  assert.equal(airportName("KRNT"), "Renton");
  assert.equal(fmtAlt(24000), "24,000 ft");
});

const ledger = {
  coverage: { firstDay: "2025-01-01", lastDay: "2025-04-30", daysScanned: 118, daysMissing: ["2025-03-02"] },
  months: [
    { month: "2025-01", firstFlights: { "737": 9 }, reported: { "737": 40 } },
    { month: "2025-02", firstFlights: { "737": 20 }, reported: { "737": 30 } },
    { month: "2025-03", firstFlights: { "737": 25 }, reported: { "737": 35 } },
    { month: "2025-04", firstFlights: { "737": 0 }, reported: null },
  ],
};

test("ledger: warm-up month is excluded; months without a reported figure are skipped", () => {
  const s = buildSeries(ledger, "737");
  assert.equal(s[0].warmup, true);
  assert.equal(s[1].warmup, false);
  assert.equal(s[3].reported, null);
  const sum = summarize(s);
  assert.deepEqual([sum.months, sum.seen, sum.reported, sum.gap], [2, 45, 65, 20]);
  assert.match(gapSentence("737", sum), /45 first flights against 65 reported deliveries, 20 fewer \(69% of the reported count\)/);
  assert.match(gapSentence("777X", summarize([])), /nothing to compare/);
  assert.match(coverageLine(ledger), /1 day is missing/);
  assert.equal(warmupEnd(ledger), Date.parse("2025-01-31T00:00:00Z") / 1000);
});

const af = (hex, program, t, flightTest = false) => ({ hex, program, flightTest, counted: !flightTest, firstFlight: { t } });
test("year counters skip warm-up and the flight-test fleet", () => {
  const b = timelineBounds(ledger, 0);
  const air = [af("a", "737", Date.parse("2025-01-10T00:00:00Z") / 1000), af("b", "737", Date.parse("2025-02-10T00:00:00Z") / 1000),
    af("c", "777X", Date.parse("2025-03-10T00:00:00Z") / 1000, true), af("d", "767", Date.parse("2025-03-12T00:00:00Z") / 1000)];
  const at = (iso) => countsAt(air, Date.parse(iso) / 1000, ledger, b);
  assert.deepEqual(at("2025-01-20T00:00:00Z"), { "737": 0, "767": 0, "777": 0, "777X": 0 });
  assert.deepEqual(at("2025-04-01T00:00:00Z"), { "737": 1, "767": 1, "777": 0, "777X": 0 });
});

test("year timeline maths", () => {
  const b = timelineBounds(ledger, 0);
  assert.equal(fractionToTime(0, b), b[0]);
  assert.equal(timeToFraction(b[1] + 99, b), 1);
  assert.deepEqual(monthsUpTo(b, Date.parse("2025-03-05T00:00:00Z") / 1000), ["2025-01", "2025-02", "2025-03"]);
  assert.ok(Math.abs(SIM_RATE * 2 - 30.44 * 86400) < 1);
});

test("headline matches the contract wording", () => {
  const now = Date.parse("2026-11-08T12:00:00Z");
  const t0 = now / 1000 - 6 * 3600 - 1800;
  const r = { isNewJet: true, callsign: "BOE603", from: "KRNT", to: "KBFI", t0, pts: [[0, 1, 1, 0], [1800, 1, 2, 0]] };
  assert.equal(headlineFor(r, now), "Latest new Boeing: BOE603, Renton to Boeing Field, 6 h ago");
});

import { settledGlow, programColor } from "../web/ui/year-model.js";
test("year glow dims with trail count so 600 trails never blow out", () => {
  assert.equal(settledGlow(10), 0.42);
  assert.ok(settledGlow(600) < 0.12, `600 trails glow at ${settledGlow(600)}`);
  assert.ok(settledGlow(600) * 600 < 0.42 * 600 / 3, "total light must grow much slower than the trail count");
  assert.equal(settledGlow(1e9), 0.035);
  assert.notEqual(programColor("737"), programColor("777"));
});
