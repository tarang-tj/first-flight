"""Read data/history/YYYY/YYYY-MM-DD.json.gz day files and report coverage."""
import datetime
import gzip
import json
import os
import re
import sys

NAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})\.json(\.gz)?$")


def _read(path):
    opener = gzip.open if path.endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def load_days(root):
    """Return {date: {"ok": bool, "legs": [...]}}. Unreadable files count as failed."""
    days = {}
    if not os.path.isdir(root):
        return days
    for year in sorted(os.listdir(root)):
        ydir = os.path.join(root, year)
        if not os.path.isdir(ydir):
            continue
        for name in sorted(os.listdir(ydir)):
            m = NAME_RE.match(name)
            if not m:
                continue
            date = m.group(1)
            try:
                doc = _read(os.path.join(ydir, name))
                legs = doc.get("legs")
                if doc.get("failed") or doc.get("missing") or not isinstance(legs, list):
                    days[date] = {"ok": False, "legs": []}
                else:
                    days[date] = {"ok": True, "legs": legs}
            except (OSError, ValueError, EOFError) as exc:
                sys.stderr.write("unreadable day %s: %s\n" % (name, exc))
                days[date] = {"ok": False, "legs": []}
    return days


def _d(s):
    return datetime.date.fromisoformat(s)


def coverage(days):
    """firstDay/lastDay of good days, count scanned, and every gap in between."""
    ok = sorted(d for d, v in days.items() if v["ok"])
    if not ok:
        return {"firstDay": None, "lastDay": None, "daysScanned": 0, "daysMissing": []}
    first, last = _d(ok[0]), _d(ok[-1])
    okset = set(ok)
    missing, cur = [], first
    while cur <= last:
        if cur.isoformat() not in okset:
            missing.append(cur.isoformat())
        cur += datetime.timedelta(days=1)
    return {"firstDay": ok[0], "lastDay": ok[-1], "daysScanned": len(ok), "daysMissing": missing}
