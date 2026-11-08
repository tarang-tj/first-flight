"""Pending-day selection and marker-safe storing for the CI workflows."""
import datetime
import gzip
import json
import os
import shutil
import sys
import tempfile
import unittest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "tools"))
import day_files as df  # noqa: E402

TODAY = datetime.date(2026, 11, 9)
GOOD = {"date": "x", "scanned": 5, "boeing": 1, "legs": []}


class DayFiles(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.tmp, True)
        self.hist = os.path.join(self.tmp, "history")

    def put(self, day, doc):
        p = df.stored_path(self.hist, day)
        os.makedirs(os.path.dirname(p), exist_ok=True)
        with gzip.open(p, "wt") as f:
            f.write(doc if isinstance(doc, str) else json.dumps(doc))

    def src(self, day, doc):
        p = os.path.join(self.tmp, day + ".json")
        with open(p, "w") as f:
            f.write(doc if isinstance(doc, str) else json.dumps(doc))
        return p

    def test_markers_and_unreadable_days_are_retried(self):
        self.put("2026-11-02", {"date": "2026-11-02", "failed": True})
        self.put("2026-11-03", {"date": "2026-11-03", "missing": True})
        self.put("2026-11-04", GOOD)
        self.put("2026-11-05", "not json")
        self.put("2026-11-06", GOOD)
        self.put("2026-11-07", GOOD)
        # 2026-11-08 (yesterday) has no file at all.
        self.assertEqual(df.pending_days(self.hist, TODAY), ["2026-11-02", "2026-11-03", "2026-11-05", "2026-11-08"])

    def test_old_markers_beyond_a_week_and_old_absences_are_left_alone(self):
        self.put("2026-10-30", {"failed": True})
        for d in ("2026-11-04", "2026-11-05", "2026-11-06", "2026-11-07", "2026-11-08"):
            self.put(d, GOOD)
        self.assertEqual(df.pending_days(self.hist, TODAY), [])  # 11-02, 11-03 absent but older than 3 days

    def test_good_day_is_never_replaced_by_a_marker(self):
        self.put("2026-11-05", {"date": "2026-11-05", "scanned": 9, "boeing": 2, "legs": [{"hex": "a"}]})
        for marker in ({"date": "2026-11-05", "failed": True}, {"date": "2026-11-05", "missing": True}, "garbage"):
            self.assertEqual(df.store(self.src("2026-11-05", marker), self.hist), "kept")
        self.assertEqual(df.read_doc(df.stored_path(self.hist, "2026-11-05"))["scanned"], 9)

    def test_marker_replaced_by_good_and_new_marker_stored(self):
        self.put("2026-11-05", {"failed": True})
        self.assertEqual(df.store(self.src("2026-11-05", GOOD), self.hist), "stored")
        self.assertTrue(df.is_good(df.read_doc(df.stored_path(self.hist, "2026-11-05"))))
        self.assertEqual(df.store(self.src("2026-11-06", {"missing": True}), self.hist), "stored")
        self.assertFalse(df.is_good(df.read_doc(df.stored_path(self.hist, "2026-11-06"))))

    def test_rejects_bad_names(self):
        with self.assertRaises(ValueError):
            df.store(self.src("x; rm -rf", GOOD), self.hist)
        self.assertEqual(df.main(["pending", "--history", self.hist, "--today", "bad"]), 2)


if __name__ == "__main__":
    unittest.main()
