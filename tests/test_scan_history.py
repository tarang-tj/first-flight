"""Scanner tests on a synthetic readsb tar shaped like a real globe_history day."""
import gzip
import io
import json
import os
import sys
import tarfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "tools"))
import scan_history as sh  # noqa: E402

T0 = 1794100000.0


def trace_doc(icao, t, rows, r="N1234B"):
    return {"icao": icao, "r": r, "t": t, "desc": "BOEING", "timestamp": T0, "trace": rows}


def row(sec, lat, lon, alt, flags=0, flight=None):
    extra = {"type": "adsb_icao", "flight": flight + "  "} if flight else None
    return [sec, lat, lon, alt, 150.0, 340.0, flags, 0, extra, "adsb_icao", None, None, None, None]


def make_tar(docs, gz=True):
    buf = io.BytesIO()
    with tarfile.open(fileobj=buf, mode="w") as tar:
        for name, doc in docs:
            data = json.dumps(doc).encode()
            if gz:
                data = gzip.compress(data)
            info = tarfile.TarInfo(name)
            info.size = len(data)
            tar.addfile(info, io.BytesIO(data))
    buf.seek(0)
    return buf


PAE = sh.AIRFIELDS["KPAE"]
# A 777F test flight: on the ground at Paine, climbs out over the Sound, lands back.
TEST_FLIGHT = [
    row(0, PAE[0], PAE[1], "ground", flight="BOE123"),
    row(30, PAE[0] + 0.02, PAE[1], 1500),
    row(60, 48.2, -122.6, 15000),
    row(3600, 48.5, -123.0, 39000, flight="BOE123"),
    row(7000, PAE[0] + 0.01, PAE[1], 800),
    row(7100, PAE[0], PAE[1], "ground"),
]


class ScanTests(unittest.TestCase):
    def test_keeps_boeing_leg_at_paine_and_drops_others(self):
        tar = make_tar([
            ("traces/23/trace_full_a12345.json", trace_doc("a12345", "B77L", TEST_FLIGHT)),
            # An Airbus at Paine is not Boeing production.
            ("traces/99/trace_full_c00001.json", trace_doc("c00001", "A320", TEST_FLIGHT)),
            # A Boeing that never touches a watched airfield.
            ("traces/77/trace_full_b00002.json", trace_doc("b00002", "B738", [row(0, 40.0, -100.0, 35000)])),
            ("heatmap/01.bin.ttf", {"x": 1}),
        ])
        out = sh.scan(tar, "2026-11-05")
        self.assertEqual(out["scanned"], 3)
        self.assertEqual(out["boeing"], 2)
        self.assertEqual(len(out["legs"]), 1)
        leg = out["legs"][0]
        self.assertEqual(leg["hex"], "a12345")
        self.assertEqual(leg["callsigns"], ["BOE123"])
        self.assertEqual((leg["from"], leg["to"]), ("KPAE", "KPAE"))
        self.assertEqual(leg["maxAlt"], 39000)
        self.assertEqual(leg["start"], round(T0))
        self.assertEqual(leg["end"], round(T0 + 7100))
        self.assertTrue(leg["boeingOp"])
        self.assertGreaterEqual(len(leg["path"]), 6)

    def test_airline_legs_keep_summary_only(self):
        rows = [r[:8] + [{"flight": "ASA12  "}] + r[9:] if r[8] else r for r in TEST_FLIGHT]
        tar = make_tar([("traces/01/trace_full_a0000b.json", trace_doc("a0000b", "B39M", rows))])
        leg = sh.scan(tar, None)["legs"][0]
        self.assertFalse(leg["boeingOp"])
        self.assertIsNone(leg["path"])
        self.assertEqual(leg["callsigns"], ["ASA12"])

    def test_new_leg_flag_splits_flights(self):
        rows = TEST_FLIGHT + [row(9000, PAE[0], PAE[1], "ground", flags=2, flight="BOE7"),
                              row(9100, 48.0, -122.0, 20000)]
        tar = make_tar([("traces/01/trace_full_a00009.json", trace_doc("a00009", "B763", rows))])
        legs = sh.scan(tar, None)["legs"]
        self.assertEqual(len(legs), 2)
        self.assertEqual(legs[1]["callsigns"], ["BOE7"])
        self.assertEqual(legs[1]["from"], "KPAE")
        self.assertIsNone(legs[1]["to"])

    def test_plain_json_members_also_parse(self):
        tar = make_tar([("traces/01/trace_full_a0000a.json", trace_doc("a0000a", "B38M", TEST_FLIGHT))], gz=False)
        self.assertEqual(len(sh.scan(tar, None)["legs"]), 1)

    def test_untyped_new_airframe_is_kept(self):
        doc = trace_doc("a99999", None, [row(0, 47.4931, -122.2158, "ground", flight="BOE451"), row(30, 47.52, -122.22, 2000), row(900, 47.53, -122.30, "ground")], r=None)
        del doc["t"]
        tar = make_tar([("traces/99/trace_full_a99999.json", doc)])
        out = sh.scan(tar, None)
        self.assertEqual(len(out["legs"]), 1)
        leg = out["legs"][0]
        self.assertTrue(leg["untyped"])
        self.assertTrue(leg["boeingOp"])
        self.assertEqual((leg["from"], leg["to"]), ("KRNT", "KBFI"))

    def test_type_filter(self):
        for t in ["B762", "B77L", "B778", "B779", "B38M", "B39M", "B3XM", "B37M", "P8", "B748"]:
            self.assertTrue(sh.is_boeing_type(t), t)
        for t in ["A320", "", None, "C25B", "B350", "BE20"]:
            self.assertFalse(sh.is_boeing_type(t), t)

    def test_airfield_needs_low_altitude(self):
        self.assertEqual(sh.airfield_at(PAE[0], PAE[1], "ground"), "KPAE")
        self.assertIsNone(sh.airfield_at(PAE[0], PAE[1], 20000))
        self.assertEqual(sh.airfield_at(PAE[0] + 0.018, PAE[1], 500), "KPAE")  # 2 km out, climbing
        self.assertIsNone(sh.airfield_at(47.7, -122.28, "ground"))  # 23 km south


if __name__ == "__main__":
    unittest.main()
