"""Time-machine data: every airborne Boeing flight, bucketed by takeoff month."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tools.ledger.sky import airborne_counts, busiest_moments, make_sky, sky_flights, thin  # noqa: E402

T = 1_790_000_000


def leg(start, mins=60, alt=20000, cs="BOE101", boeing=True, path=True):
    pts = [[start + i * 60, 47.5 + i * 0.01, -122.2, (0 if i in (0, mins) else alt)] for i in range(mins + 1)]
    return {"start": start, "end": start + mins * 60, "callsigns": [cs], "boeingOp": boeing, "reg": "N1",
            "type": "B38M", "path": pts if path else None}


class Sky(unittest.TestCase):
    def test_thin_keeps_ends_and_spacing(self):
        p = [[T + i * 5, 47.0, -122.0, 1000] for i in range(100)]
        out = thin(p, step=30)
        self.assertEqual(out[0][0], 0)
        self.assertEqual(out[-1][0], 99 * 5)
        self.assertTrue(all(b[0] - a[0] >= 30 for a, b in zip(out[:-2], out[1:-1])))

    def test_only_airborne_boeing_flights_with_paths(self):
        by_hex = {"a1": [leg(T), leg(T + 9000, alt=500), leg(T + 20000, path=False)],
                  "b2": [leg(T, cs="DAL1", boeing=False), leg(T + 100, cs="BOE7", boeing=False)]}
        frames = [{"hex": "a1", "program": "737", "counted": True, "firstFlight": {"t": T}}]
        out = sky_flights(by_hex, frames)
        self.assertEqual([(f["hex"], f["cs"]) for f in out], [("a1", "BOE101"), ("b2", "BOE7")])
        self.assertTrue(out[0]["ff"])
        self.assertFalse(out[1]["ff"])
        self.assertEqual(out[1]["program"], "unknown")

    def test_counts_and_moments(self):
        flights = [{"t0": T, "t1": T + 100}, {"t0": T + 50, "t1": T + 200}, {"t0": T + 300, "t1": T + 400}]
        self.assertEqual(airborne_counts(flights), [(T, 1), (T + 50, 2), (T + 300, 1)])
        self.assertEqual(busiest_moments(flights, k=2, gap=200), [{"t": T + 50, "n": 2}, {"t": T + 300, "n": 1}])

    def test_months_are_pacific_by_takeoff(self):
        # 2026-11-01 06:00 UTC is 23:00 Oct 31 in Seattle (PDT)
        t = 1_793_512_800
        idx, months = make_sky([{"t0": t, "t1": t + 60}, {"t0": t + 86400, "t1": t + 86460}])
        self.assertEqual(sorted(months), ["2026-10", "2026-11"])
        self.assertEqual(idx["span"], [t, t + 86460])


if __name__ == "__main__":
    unittest.main()
