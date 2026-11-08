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


from tools.ledger.legs import flew_as_airline, is_flight_test  # noqa: E402


class FlightTestFleet(unittest.TestCase):
    """The aircraft database keeps BOEING CO as owner on delivered airline jets
    (verifier, 2026-11-08: ac5eb4 N8965Q later flies as SWA2208)."""

    def test_delivered_airline_jet_is_not_test_fleet(self):
        legs = [{"callsigns": ["BOE611"]}, {"callsigns": ["SWA2208"]}]
        self.assertTrue(flew_as_airline(legs))
        self.assertFalse(is_flight_test("N8965Q", "BOEING CO", "B38M", airline_seen=True, seen_before_warmup=False))

    def test_new_jet_first_seen_after_warmup_is_not_test_fleet(self):
        self.assertFalse(is_flight_test("N1234B", "BOEING CO", "B38M", airline_seen=False, seen_before_warmup=False))

    def test_known_test_registrations_and_old_boeing_jets_are_test_fleet(self):
        self.assertTrue(is_flight_test("N779XW", None, None))
        self.assertTrue(is_flight_test("N60659", "BOEING CO", "B738", airline_seen=False, seen_before_warmup=True))
        self.assertFalse(flew_as_airline([{"callsigns": ["BOE1", "RDN814", "N60659"]}]))
