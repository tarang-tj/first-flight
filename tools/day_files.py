"""Helpers for the stored day files in data/history/YYYY/YYYY-MM-DD.json.gz.

  python3 tools/day_files.py pending --history DIR [--today YYYY-MM-DD]
      Print the days the daily scan should (re)try: every day in the last 7
      whose stored file is a missing/failed marker or unreadable, plus any of
      the last 3 days with no file at all. Yesterday is always the newest.
  python3 tools/day_files.py store SRC.json DEST_ROOT
      Gzip a scanner output into DEST_ROOT/YYYY/DATE.json.gz, but never
      replace a good stored day with a missing/failed marker.

Python 3.9+, standard library only.
"""
import argparse
import datetime
import gzip
import json
import os
import re
import sys

DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")
MARKER_LOOKBACK = 7
ABSENT_LOOKBACK = 3


def valid_date(s):
    if not DATE_RE.match(s or ""):
        return False
    try:
        datetime.date.fromisoformat(s)
    except ValueError:
        return False
    return True


def stored_path(root, day):
    return os.path.join(root, day[:4], day + ".json.gz")


def is_good(doc):
    return (isinstance(doc, dict) and isinstance(doc.get("legs"), list)
            and not doc.get("failed") and not doc.get("missing"))


def read_doc(path):
    """The stored document, or None when it cannot be read."""
    try:
        with gzip.open(path, "rt", encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError, EOFError):
        return None


def pending_days(root, today):
    """Days to scan, oldest first. `today` is a datetime.date (UTC)."""
    out = []
    for back in range(MARKER_LOOKBACK, 0, -1):
        day = (today - datetime.timedelta(days=back)).isoformat()
        path = stored_path(root, day)
        if os.path.exists(path):
            if not is_good(read_doc(path)):
                out.append(day)
        elif back <= ABSENT_LOOKBACK:
            out.append(day)
    return out


def store(src, dest_root):
    """Returns "stored", "kept" (good day protected from a marker) or raises ValueError."""
    day = os.path.basename(src)[:-5] if src.endswith(".json") else os.path.basename(src)
    if not valid_date(day):
        raise ValueError("bad day name: %r" % day)
    try:
        with open(src, encoding="utf-8") as f:
            doc = json.load(f)
    except (OSError, ValueError):
        doc = {"date": day, "failed": True}
    dest = stored_path(dest_root, day)
    if not is_good(doc) and os.path.exists(dest) and is_good(read_doc(dest)):
        return "kept"
    os.makedirs(os.path.dirname(dest), exist_ok=True)
    tmp = dest + ".tmp"
    with open(tmp, "wb") as raw, gzip.GzipFile(fileobj=raw, mode="wb", mtime=0, compresslevel=9) as gz:
        gz.write(json.dumps(doc, separators=(",", ":")).encode("utf-8"))
    os.replace(tmp, dest)
    return "stored"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    sub = ap.add_subparsers(dest="cmd", required=True)
    p = sub.add_parser("pending")
    p.add_argument("--history", required=True)
    p.add_argument("--today", default=None)
    s = sub.add_parser("store")
    s.add_argument("src")
    s.add_argument("dest_root")
    args = ap.parse_args(argv)
    try:
        if args.cmd == "pending":
            if args.today and not valid_date(args.today):
                raise ValueError("bad --today")
            today = (datetime.date.fromisoformat(args.today) if args.today
                     else datetime.datetime.now(datetime.timezone.utc).date())
            print(" ".join(pending_days(args.history, today)))
        else:
            print("%s: %s" % (os.path.basename(args.src), store(args.src, args.dest_root)))
    except ValueError as exc:
        sys.stderr.write("error: %s\n" % exc)
        return 2
    return 0


if __name__ == "__main__":
    sys.exit(main())
