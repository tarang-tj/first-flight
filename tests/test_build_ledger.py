"""Ledger builder tests on synthetic history days shaped like scanner output."""
import datetime
import gzip
import json
import os
import shutil
import sys
import tempfile
import unittest

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, os.path.join(ROOT, "tools"))
import build_ledger as bl  # noqa: E402
from ledger import airframes as af  # noqa: E402
from ledger import history, outputs  # noqa: E402
from ledger.icao import country  # noqa: E402


def ts(date, hour=12):
    y, m, d = map(int, date.split("-"))
    return int(datetime.datetime(y, m, d, hour, tzinfo=datetime.timezone.utc).timestamp())


def climb(t0, n=12, peak=8000, lat=47.5, lon=-122.2, step=20):
    """n path points up to `peak` ft, one every `step` s."""
    return [[t0 + i * step, lat + i * 0.0123456, lon + i * 0.0123456, int(peak * i / (n - 1))] for i in range(n)]


def leg(hx, start, frm="KRNT", to="KBFI", calls=("BOE603",), path="climb", **kw):
    p = climb(start) if path == "climb" else path
    rec = {"hex": hx, "reg": None, "type": None, "desc": None, "ownOp": None, "year": None,
           "callsigns": list(calls), "start": start, "end": (p[-1][0] if p else start + 3000),
           "from": frm, "to": to, "touched": [x for x in (frm, to) if x], "maxAlt": max([q[3] for q in p or []] or [0]),
           "boeingOp": True, "untyped": True, "path": p}
    rec.update(kw)
    return rec


def write_days(root, days):
    """days: {date: legs | 'failed' | 'missing' | 'corrupt'}."""
    for date, legs in days.items():
        d = os.path.join(root, date[:4])
        os.makedirs(d, exist_ok=True)
        path = os.path.join(d, date + ".json.gz")
        if legs == "corrupt":
            with open(path, "wb") as f:
                f.write(b"not gzip")
            continue
        doc = {"date": date, "failed": True} if legs == "failed" else \
              {"date": date, "missing": True} if legs == "missing" else \
              {"date": date, "scanned": 1, "boeing": 1, "legs": legs}
        with gzip.open(path, "wt") as f:
            json.dump(doc, f)


class LedgerCase(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.hist = os.path.join(self.tmp, "history")
        self.out = os.path.join(self.tmp, "out")
        os.makedirs(self.out)
        shutil.copy(os.path.join(ROOT, "web", "data", "deliveries.json"), self.out)
        self.addCleanup(shutil.rmtree, self.tmp, True)

    def build(self, days):
        write_days(self.hist, days)
        ledger, frames = bl.run(self.hist, self.out, now="2025-04-01T00:00:00Z")
        return ledger, {a["hex"]: a for a in frames}

    def total(self, ledger, key="firstFlights"):
        return sum(sum(m[key].values()) for m in ledger["months"])


class FirstFlightRules(LedgerCase):
    def test_warmup_excludes_early_first_flights(self):
        ledger, fr = self.build({
            "2025-01-01": [], "2025-01-10": [leg("aaaaa1", ts("2025-01-10"))],
            "2025-03-01": [leg("aaaaa2", ts("2025-03-01"))]})
        self.assertFalse(fr["aaaaa1"]["counted"])
        self.assertTrue(fr["aaaaa2"]["counted"])
        self.assertEqual(self.total(ledger), 1)
        jan = ledger["months"][0]
        self.assertTrue(jan["warmup"] and jan["warmupPartial"])
        self.assertEqual(jan["countedFrom"], "2025-01-30")
        self.assertEqual(sum(jan["firstFlights"].values()), 0)

    def test_ground_runs_and_altitude_spikes_never_count(self):
        run = [[ts("2025-03-01") + i * 20, 47.49, -122.21, 0] for i in range(15)]
        spike = [list(p) for p in run]
        spike[7][3] = 48500  # one bogus sample on an otherwise ground leg
        ledger, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("bbbbb1", ts("2025-03-01"), "KRNT", "KRNT", ("BOE123",), path=run, maxAlt=0),
                           leg("bbbbb2", ts("2025-03-01", 14), "KRNT", "KRNT", ("BOE124",), path=spike, maxAlt=48500)]})
        self.assertEqual(fr, {})
        self.assertEqual(self.total(ledger), 0)

    def test_flight_test_fleet_is_excluded(self):
        ledger, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("ccccc1", ts("2025-03-01"), reg="N779XY", type="B779", callsigns=["BOE001"]),
                           leg("ccccc2", ts("2025-03-02"), reg="N27751", type="B3XM", callsigns=["BOE101"]),
                           leg("ccccc3", ts("2025-03-03"), reg=None, type=None, callsigns=["BOE602"])]})
        self.assertTrue(fr["ccccc1"]["flightTest"] and fr["ccccc2"]["flightTest"])
        self.assertFalse(fr["ccccc3"]["flightTest"])
        self.assertEqual(self.total(ledger), 1)

    def test_reflown_airframe_counts_once(self):
        ledger, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("ddddd1", ts("2025-03-01"))],
            "2025-03-05": [leg("ddddd1", ts("2025-03-05"), "KBFI", "KRNT"),
                           leg("ddddd1", ts("2025-03-05", 18), "KRNT", "KBFI")]})
        self.assertEqual(self.total(ledger), 1)
        self.assertEqual(fr["ddddd1"]["flights"], 3)
        self.assertEqual(fr["ddddd1"]["firstFlight"]["t"], ts("2025-03-01"))

    def test_first_sighting_from_other_field_is_not_a_birth(self):
        ledger, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("eeeee1", ts("2025-03-01"), "KBFI", "KBFI")]})
        self.assertFalse(fr["eeeee1"]["counted"])
        self.assertEqual(self.total(ledger), 0)

    def test_program_inference(self):
        _, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("fffff1", ts("2025-03-01"), "KPAE", "KPAE", ("BOE335",)),
                           leg("fffff2", ts("2025-03-02"), "KPAE", "KPAE", ("BOE336",)),
                           leg("fffff3", ts("2025-03-03"), "KPAE", "KPAE", ("BOE337",), type="B779")],
            "2025-03-10": [leg("fffff2", ts("2025-03-10"), "KPAE", "KPAE", ("BOE337",), type="B762")]})
        self.assertEqual((fr["fffff1"]["program"], fr["fffff2"]["program"], fr["fffff3"]["program"]),
                         ("unknown", "767", "777X"))


class MidnightAndMonths(LedgerCase):
    def test_overflight_of_kbfi_is_not_a_return(self):
        """Sea-Tac arrivals pass low over KBFI: touched, but no takeoff or landing there."""
        fly = climb(ts("2025-03-12"), peak=30000)
        over = leg("33333a", ts("2025-03-12"), None, None, ("ASA405",), path=fly, boeingOp=False,
                   touched=["KBFI"])
        _, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("33333a", ts("2025-03-01"), "KRNT", "KBFI")],
            "2025-03-09": [leg("33333a", ts("2025-03-09"), "KBFI", "KFOO", ("ASA17",), boeingOp=False,
                               path=climb(ts("2025-03-09"), peak=30000))],
            "2025-03-12": [over]})
        self.assertEqual(fr["33333a"]["delivery"], {"t": ts("2025-03-09"), "callsign": "ASA17"})

    def test_landing_at_boeing_field_still_voids_a_delivery(self):
        _, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("44444a", ts("2025-03-01"), "KRNT", "KBFI")],
            "2025-03-09": [leg("44444a", ts("2025-03-09"), "KBFI", "KFOO", ("ASA17",), boeingOp=False,
                               path=climb(ts("2025-03-09"), peak=30000))],
            "2025-03-12": [leg("44444a", ts("2025-03-12"), None, "KBFI", ("ASA17",), boeingOp=False, path=None, maxAlt=30000)]})
        self.assertIsNone(fr["44444a"]["delivery"])

    def _split(self, gap=20, p2_from=None):
        mid = ts("2025-03-02", 0)
        p1 = [[mid - 600 + i * 20, 47.9 + i * 0.01, -122.3, 1000 + i * 600] for i in range(30)]
        p1.append([mid - 20, 47.9 + 0.3, -122.3, 19000])
        p2 = [[mid - 20 + gap + i * 20, 48.21 + i * 0.01, -122.3, 19000 - i * 100] for i in range(12)]
        a = leg("55555a", p1[0][0], "KPAE", None, ("BOE301",), path=p1)
        b = leg("55555a", p2[0][0], p2_from, "KPAE", ("BOE301",), path=p2)
        return a, b

    def test_flight_split_at_utc_midnight_is_one_flight(self):
        a, b = self._split()
        ledger, fr = self.build({"2025-01-01": [], "2025-03-01": [a], "2025-03-02": [b]})
        ff = fr["55555a"]
        self.assertEqual(fr["55555a"]["flights"], 1)
        self.assertEqual(ff["firstFlight"]["to"], "KPAE")
        self.assertEqual(ff["firstFlight"]["durationS"], b["end"] - a["start"])
        self.assertTrue(ff["counted"])
        self.assertEqual(self.total(ledger), 1)

    def test_split_part_one_that_is_not_airborne_alone_is_still_a_first_flight(self):
        mid = ts("2025-03-02", 0)
        p1 = [[mid - 300 + i * 20, 47.9063, -122.28, 0] for i in range(14)] + [[mid - 20, 47.91, -122.28, 900]]
        p2 = [[mid + i * 20, 47.95 + i * 0.01, -122.28, 2000 + i * 900] for i in range(14)]
        a = leg("66666a", p1[0][0], "KPAE", None, ("BOE302",), path=p1)
        b = leg("66666a", p2[0][0], None, "KPAE", ("BOE302",), path=p2)
        ledger, fr = self.build({"2025-01-01": [], "2025-03-01": [a], "2025-03-02": [b]})
        self.assertTrue(fr["66666a"]["counted"])
        self.assertEqual(fr["66666a"]["born"], "KPAE")

    def test_distant_or_late_legs_are_not_merged(self):
        a, b = self._split(gap=3000)
        _, fr = self.build({"2025-01-01": [], "2025-03-01": [a], "2025-03-02": [b]})
        self.assertEqual(fr["55555a"]["flights"], 2)
        a, b = self._split()
        for p in b["path"]:
            p[1] += 3.0  # 330 km away: a different flight
        _, fr = self.build({"2025-01-01": [], "2025-03-01": [a], "2025-03-02": [b]})
        self.assertEqual(fr["55555a"]["flights"], 2)

    def test_months_are_pacific_time(self):
        # 2025-03-31 17:30 PDT is 2025-04-01 00:30 UTC: still March.
        t = int(datetime.datetime(2025, 4, 1, 0, 30, tzinfo=datetime.timezone.utc).timestamp())
        self.assertEqual(outputs.month_of(t), "2025-03")
        ledger, fr = self.build({"2025-01-01": [], "2025-04-01": [leg("77777a", t)]})
        self.assertTrue(fr["77777a"]["counted"])
        by = {m["month"]: m for m in ledger["months"]}
        self.assertEqual(sum(by["2025-03"]["firstFlights"].values()), 1)
        self.assertEqual(sum(by["2025-04"]["firstFlights"].values()), 0)
        self.assertEqual(ledger["timezone"], "America/Los_Angeles")
        self.assertTrue(any("Pacific" in n for n in ledger["notes"]))

    def test_no_sliver_month_before_coverage(self):
        # Day 1 UTC is the evening of Dec 31 in Pacific time: no 2024-12 row.
        ledger, _ = self.build({"2025-01-01": [], "2025-02-01": []})
        self.assertEqual(ledger["months"][0]["month"], "2025-01")

    def test_unknown_program_is_carried_explicitly(self):
        ledger, _ = self.build({"2025-01-01": [], "2025-03-01": [
            leg("88888a", ts("2025-03-01"), "KPAE", "KPAE", ("BOE335",)),
            leg("88888b", ts("2025-03-02"), "KPAE", "KPAE", ("BOE336",), type="B762")]})
        mar = [m for m in ledger["months"] if m["month"] == "2025-03"][0]
        self.assertEqual(mar["unknown"], {"firstFlights": 1, "deliveriesSeen": 0})
        self.assertEqual(ledger["unknownProgram"]["firstFlights"], 1)

    def test_partial_warmup_month_says_when_counting_starts(self):
        # Coverage from 2025-01-15: warm-up ends 2025-02-14 00:00 UTC (Feb 13 Pacific).
        ledger, _ = self.build({"2025-01-15": [], "2025-04-01": []})
        by = {m["month"]: m for m in ledger["months"]}
        self.assertTrue(by["2025-01"]["warmup"] and not by["2025-01"].get("warmupPartial"))
        self.assertTrue(by["2025-02"]["warmup"] and by["2025-02"]["warmupPartial"])
        self.assertEqual(by["2025-02"]["countedFrom"], "2025-02-13")
        self.assertNotIn("warmup", by["2025-03"])
        self.assertEqual(ledger["warmupDays"], 30)
        self.assertEqual(ledger["warmupEndsAt"], ts("2025-02-14", 0))


class DeliveryAndCoverage(LedgerCase):
    def test_delivery_detected_only_without_return(self):
        later = lambda hx, calls, to: leg(hx, ts("2025-03-09"), "KPAE", to, calls, path=climb(ts("2025-03-09"), peak=30000), boeingOp=False)
        ledger, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("11111a", ts("2025-03-01"), "KRNT", "KBFI"),
                           leg("11111b", ts("2025-03-01", 15), "KRNT", "KBFI", ("BOE604",))],
            "2025-03-09": [later("11111a", ["DLH1234"], "KFOO"),      # leaves, never seen again
                           later("11111b", ["UAL22"], "KFOO")],       # leaves, comes back
            "2025-03-12": [leg("11111b", ts("2025-03-12"), None, "KBFI", ("UAL22",), path=None, maxAlt=30000, boeingOp=False)]})
        self.assertEqual(fr["11111a"]["delivery"], {"t": ts("2025-03-09"), "callsign": "DLH1234"})
        self.assertIsNone(fr["11111b"]["delivery"])
        march = [m for m in ledger["months"] if m["month"] == "2025-03"][0]
        self.assertEqual(march["deliveriesSeen"]["737"], 1)

    def test_flight_test_never_delivered(self):
        _, fr = self.build({
            "2025-01-01": [],
            "2025-03-01": [leg("22222a", ts("2025-03-01"), reg="N779XY", type="B779"),
                           leg("22222a", ts("2025-03-09"), "KPAE", "KFOO", ("N779XY",), boeingOp=False,
                               path=climb(ts("2025-03-09"), peak=30000))]})
        self.assertIsNone(fr["22222a"]["delivery"])

    def test_missing_days_are_reported(self):
        ledger, _ = self.build({
            "2025-01-01": [], "2025-01-02": "failed", "2025-01-03": [], "2025-01-04": "missing",
            "2025-01-05": "corrupt", "2025-01-07": [leg("33333a", ts("2025-01-07"))]})
        cov = ledger["coverage"]
        self.assertEqual((cov["firstDay"], cov["lastDay"], cov["daysScanned"]), ("2025-01-01", "2025-01-07", 3))
        self.assertEqual(cov["daysMissing"], ["2025-01-02", "2025-01-04", "2025-01-05", "2025-01-06"])

    def test_reported_deliveries_attach_to_months(self):
        ledger, _ = self.build({"2025-01-01": [], "2025-03-31": []})
        by = {m["month"]: m for m in ledger["months"]}
        self.assertEqual(by["2025-01"]["reported"], {"737": 40, "767": 0, "777": 1})
        self.assertTrue(by["2025-01"]["reportedSource"].startswith("https://"))
        self.assertEqual(sorted(by), ["2025-01", "2025-02", "2025-03"])


class Outputs(LedgerCase):
    def test_trails_decimated_and_rounded(self):
        path = climb(ts("2025-03-01"), n=60, peak=9000)  # 20 s spacing
        self.build({"2025-01-01": [], "2025-03-01": [leg("44444a", ts("2025-03-01"), path=path)]})
        with open(os.path.join(self.out, "trails", "2025-03.json")) as f:
            trail = json.load(f)
        self.assertEqual(len(trail), 1)
        pts = trail[0]["pts"]
        self.assertLess(len(pts), 45)
        self.assertEqual(pts[0][0], 0)
        self.assertEqual(trail[0]["t0"], path[0][0])
        for p in pts:
            self.assertEqual(p[1], round(p[1], 4))
            self.assertLessEqual(len(repr(p[2]).split(".")[1]), 4)
        self.assertTrue(all(b[0] - a[0] >= 30 for a, b in zip(pts[:-2], pts[1:-1])))
        self.assertEqual(pts[-1][0], path[-1][0] - path[0][0])
        # Every ledger month gets a trail file, even with no first flights.
        for month in ("2025-01", "2025-02"):
            with open(os.path.join(self.out, "trails", month + ".json")) as f:
                self.assertEqual(json.load(f), [])

    def test_latest_has_twelve_and_pins_newest_first_flight(self):
        legs = [leg("55555a", ts("2025-03-01"))]  # the only counted first flight, oldest
        for i in range(15):
            legs.append(leg("5555b%d" % i, ts("2025-03-02") + i * 7200, reg="N779X%s" % "ABCDEFGHIJKLMNO"[i],
                            type="B779", callsigns=["BOE00%d" % i]))
        self.build({"2025-01-01": [], "2025-03-01": legs})
        with open(os.path.join(self.out, "latest.json")) as f:
            latest = json.load(f)
        self.assertEqual(len(latest), 12)
        self.assertTrue(any(x["firstFlight"] for x in latest))
        self.assertEqual([x["t0"] for x in latest], sorted((x["t0"] for x in latest), reverse=True))
        self.assertEqual(latest[0]["pts"][0][0], 0)

    def test_ledger_and_airframe_shapes(self):
        ledger, fr = self.build({"2025-01-01": [], "2025-03-01": [leg("66666a", ts("2025-03-01"))]})
        self.assertEqual(sorted(ledger), ["countedFrom", "coverage", "generatedAt", "months", "notes", "programs",
                                         "timezone", "unknownProgram", "warmupDays", "warmupEndsAt"])
        self.assertEqual(sorted(ledger["months"][0]["firstFlights"]), ["737", "767", "777", "777X", "unknown"])
        a = fr["66666a"]
        for key in ("hex", "reg", "country", "program", "born", "firstFlight", "flights", "lastSeen", "delivery", "flightTest"):
            self.assertIn(key, a)
        self.assertEqual(sorted(a["firstFlight"]), ["callsign", "durationS", "from", "maxAltFt", "t", "to"])


class Helpers(unittest.TestCase):
    def test_country_lookup(self):
        self.assertEqual(country("a2c39e"), "United States")
        self.assertEqual(country("4CA7FC"), "Ireland")
        self.assertEqual(country("780000"), "China")
        self.assertEqual(country("c00001"), "Canada")
        self.assertEqual(country("f00001"), None)   # ICAO-reserved block
        self.assertIsNone(country("zzzzzz"))
        self.assertIsNone(country(None))

    def test_country_table_covers_top_blocks(self):
        from ledger.icao_table import TABLE
        self.assertGreaterEqual(len(TABLE.strip().splitlines()), 40)

    def test_missing_history_dir(self):
        self.assertEqual(history.load_days("/nonexistent-dir-xyz"), {})
        self.assertIsNone(history.coverage({})["firstDay"])

    def test_decimate_empty(self):
        self.assertEqual(outputs.decimate([]), [])

    def test_warmup_is_thirty_days(self):
        self.assertEqual(af.warmup_end_ts("2025-01-01"), ts("2025-01-31", 0))


class DeliveriesFile(unittest.TestCase):
    def setUp(self):
        with open(os.path.join(ROOT, "web", "data", "deliveries.json")) as f:
            self.doc = json.load(f)

    def test_each_quarter_equals_sum_of_its_months(self):
        rows = {r["month"]: r for r in self.doc["rows"]}
        self.assertEqual(len(self.doc["quarters"]), 7)
        for q in self.doc["quarters"]:
            year, qn = q["quarter"].split("-Q")
            months = ["%s-%02d" % (year, (int(qn) - 1) * 3 + i) for i in (1, 2, 3)]
            for key in ("737", "767", "777", "787", "total"):
                self.assertEqual(sum(rows[m][key] for m in months), q[key], (q["quarter"], key))

    def test_rows_are_consistent_and_sourced(self):
        self.assertEqual(len(self.doc["rows"]), 21)
        for r in self.doc["rows"]:
            self.assertEqual(r["737"] + r["767"] + r["777"] + r["787"], r["total"], r["month"])
            self.assertTrue(r["source"].startswith("https://"), r["month"])
        derived = [r["month"] for r in self.doc["rows"] if r["derived"]]
        # 2025-03 767 is Q1 minus Jan and Feb (verifier, 2026-11-08); 2025-12 is Q4 minus Oct and Nov.
        self.assertEqual(derived, ["2025-03", "2025-12"])
        for q in self.doc["quarters"]:
            self.assertTrue(q["source"].startswith("https://boeing.mediaroom.com/"))


if __name__ == "__main__":
    unittest.main()
