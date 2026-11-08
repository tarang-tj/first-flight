"""Turn data/history/*.json.gz into the files the site reads (web/data/*).

Usage: python3 tools/build_ledger.py [--history DIR] [--out DIR]
Python 3.9+ and standard library only.
"""
import argparse
import datetime
import glob
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(HERE)
sys.path.insert(0, HERE)

from ledger import airframes as af  # noqa: E402
from ledger import history, outputs  # noqa: E402


def run(history_dir, out_dir, now=None, warmup_days=af.WARMUP_DAYS):
    """Build every output file; returns (ledger, airframes)."""
    now = now or datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    days = history.load_days(history_dir)
    cov = history.coverage(days)
    if not cov["firstDay"]:
        raise SystemExit("no readable history days in %s" % history_dir)
    with open(os.path.join(out_dir, "deliveries.json"), encoding="utf-8") as f:
        deliveries = json.load(f)["rows"]
    warm_end = af.warmup_end_ts(cov["firstDay"], warmup_days)
    by_hex = af.group_by_hex(days)
    frames = af.build_airframes(by_hex, warm_end)
    pairs = outputs.first_flight_legs(by_hex, frames)

    ledger = outputs.make_ledger(frames, cov, deliveries, warm_end, now)
    outputs.write_json(os.path.join(out_dir, "ledger.json"), ledger)
    outputs.write_json(os.path.join(out_dir, "airframes.json"), frames)
    outputs.write_json(os.path.join(out_dir, "latest.json"), outputs.make_latest(by_hex, frames, pairs))

    trails_dir = os.path.join(out_dir, "trails")
    trails = outputs.make_trails(pairs)
    for stale in glob.glob(os.path.join(trails_dir, "*.json")):
        os.remove(stale)
    # One file per ledger month, even when empty: the year view fetches every
    # month and a 404 would surface as a browser console error.
    for month in [m["month"] for m in ledger["months"]]:
        trails.setdefault(month, [])
    for month, items in trails.items():
        outputs.write_json(os.path.join(trails_dir, month + ".json"), items)
    return ledger, frames


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--history", default=os.path.join(ROOT, "data", "history"))
    ap.add_argument("--out", default=os.path.join(ROOT, "web", "data"))
    ap.add_argument("--warmup-days", type=int, default=af.WARMUP_DAYS, help="debug only; the site uses 30")
    args = ap.parse_args(argv)
    ledger, frames = run(args.history, args.out, warmup_days=args.warmup_days)
    cov = ledger["coverage"]
    counted = sum(1 for a in frames if a["counted"])
    print("days %s..%s scanned=%d missing=%d airframes=%d counted=%d" % (
        cov["firstDay"], cov["lastDay"], cov["daysScanned"], len(cov["daysMissing"]), len(frames), counted))


if __name__ == "__main__":
    main()
