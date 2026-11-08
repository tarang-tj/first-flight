"""Ground time before takeoff is not flight time (BOE472 sat 14.5 h at Renton)."""
import os
import sys
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from tools.ledger.legs import flight_duration_s, flight_path  # noqa: E402


class FlightSpan(unittest.TestCase):
    def test_long_ground_wait_is_trimmed(self):
        t = 1_790_000_000
        path = [[t, 47.49, -122.21, 0], [t + 870 * 60, 47.49, -122.21, 0], [t + 870 * 60 + 40, 47.50, -122.21, 900],
                [t + 870 * 60 + 3600, 47.2, -119.3, 30000], [t + 870 * 60 + 7200, 47.2, -119.3, 1200], [t + 870 * 60 + 7230, 47.2, -119.3, 0]]
        leg = {"start": t, "end": path[-1][0], "path": path}
        self.assertEqual(flight_duration_s(leg), 7230)
        self.assertEqual(flight_path(leg)[0][0], t + 870 * 60)

    def test_no_path_falls_back_to_leg_times(self):
        self.assertEqual(flight_duration_s({"start": 10, "end": 70, "path": None}), 60)


if __name__ == "__main__":
    unittest.main()
