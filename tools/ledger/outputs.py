"""Turn airframes and legs into ledger, trails and latest-flight files."""
import datetime
import json
import os
from zoneinfo import ZoneInfo

from .legs import airborne, flight_duration_s, flight_path, is_boe

LA = ZoneInfo("America/Los_Angeles")
PROGRAMS = ["737", "767", "777", "777X"]
KEYS = PROGRAMS + ["unknown"]
TRAIL_STEP_S = 30
LATEST_N = 12

NOTES = [
    "A first flight is the first airborne leg (above 1,500 ft) with a BOE callsign of an airframe not seen airborne before, departing KRNT or KPAE. Ground runs and altitude spikes never count.",
    "The first 30 days of history (exactly 30 days from the first scanned day, 00:00 UTC) are a warm-up: airframes first seen then are not counted, because we cannot tell new jets from old ones yet. A month that is only partly inside the warm-up is marked partial and says the date counting starts.",
    "Months are Pacific time (America/Los_Angeles), local time at the factories, so an evening flight on the last day of a month stays in that month.",
    "Jets whose type is not known yet (new Paine Field airframes are often untyped) are counted as 'unknown program'. They are real first flights and deliveries, shown separately, and are not part of any program's 737, 767, 777 or 777X count.",
    "Boeing's own flight-test fleet (for example N779X*, N2775x, N836BA, and typed Boeing-owned jets) is excluded from production counts.",
    "Program comes from the birth field and ICAO type code: Renton is 737; Paine Field jets use their type code, else 'unknown'. 737 MAX 10s at Paine Field are read as 737 because the 737 North Line in Everett began low-rate production in July 2026.",
    "Deliveries seen are departures from a Boeing field under a non-BOE callsign with no return in the history. They are a sky estimate, not Boeing's delivery count.",
    "Reported deliveries are Boeing's monthly figures as relayed by Forecast International, checked against Boeing's quarterly releases. Boeing's 737 count includes P-8 and 737-800A airframes; its 767 count includes the KC-46 airframe.",
    "Receiver coverage is uneven and the scanner drops days it cannot read. Missing days are listed in coverage and the sky count is a floor, not a census.",
]


def month_of(ts):
    """Calendar month (YYYY-MM) of a unix time, in Pacific time."""
    return datetime.datetime.fromtimestamp(ts, LA).strftime("%Y-%m")


def _utc_ts(day):
    d = datetime.date.fromisoformat(day)
    return int(datetime.datetime(d.year, d.month, d.day, tzinfo=datetime.timezone.utc).timestamp())


def _month_start_ts(mo):
    y, m = int(mo[:4]), int(mo[5:7])
    return int(datetime.datetime(y, m, 1, tzinfo=LA).timestamp())


def _next_month(mo):
    y, m = int(mo[:4]), int(mo[5:7])
    return "%04d-%02d" % ((y + 1, 1) if m == 12 else (y, m + 1))


def month_range(first_day, last_day):
    """Pacific months from the start of first_day (UTC) to the end of last_day (UTC)."""
    utc = datetime.timezone.utc
    f = datetime.date.fromisoformat(first_day)
    l = datetime.date.fromisoformat(last_day)
    first = month_of(int(datetime.datetime(f.year, f.month, f.day, tzinfo=utc).timestamp()))
    last = month_of(int(datetime.datetime(l.year, l.month, l.day, tzinfo=utc).timestamp()) + 86399)
    # A first month that holds under a day of coverage (day 1 UTC is the previous
    # evening in Pacific time) is a sliver inside the warm-up: not a month row.
    if _month_start_ts(_next_month(first)) - _utc_ts(first_day) < 86400:
        first = _next_month(first)
    out, cur = [], first
    while cur <= last:
        out.append(cur)
        cur = _next_month(cur)
    return out


def make_ledger(airframes, cov, deliveries_rows, warm_end, now):
    rep = {r["month"]: r for r in deliveries_rows}
    months = {}
    if cov["firstDay"]:
        for mo in month_range(cov["firstDay"], cov["lastDay"]):
            months[mo] = {"month": mo, "firstFlights": dict.fromkeys(KEYS, 0),
                          "deliveriesSeen": dict.fromkeys(KEYS, 0)}
    unknown_air = 0
    for a in airframes:
        if a["flightTest"]:
            continue
        if a["counted"]:
            months[month_of(a["firstFlight"]["t"])]["firstFlights"][a["program"]] += 1
            unknown_air += a["program"] == "unknown"
        d = a["delivery"]
        if d and d["t"] >= warm_end:
            months[month_of(d["t"])]["deliveriesSeen"][a["program"]] += 1
    counted_from = datetime.datetime.fromtimestamp(warm_end, LA).strftime("%Y-%m-%d")
    rows = []
    for mo in sorted(months):
        r = rep.get(mo)
        row = dict(months[mo])
        row["unknown"] = {"firstFlights": row["firstFlights"]["unknown"],
                          "deliveriesSeen": row["deliveriesSeen"]["unknown"]}
        row["reported"] = {k: r[k] for k in ("737", "767", "777")} if r else None
        row["reportedSource"] = r["source"] if r else None
        if _month_start_ts(mo) < warm_end:
            row["warmup"] = True  # any part of the month is in the warm-up: not compared
            if _month_start_ts(_next_month(mo)) > warm_end:
                row["warmupPartial"] = True
                row["countedFrom"] = counted_from
        rows.append(row)
    unk = {"firstFlights": sum(m["unknown"]["firstFlights"] for m in rows),
           "deliveriesSeen": sum(m["unknown"]["deliveriesSeen"] for m in rows)}
    return {"generatedAt": now, "coverage": cov, "programs": PROGRAMS,
            "timezone": "America/Los_Angeles", "warmupDays": (warm_end - _utc_ts(cov["firstDay"])) // 86400 if cov["firstDay"] else None,
            "warmupEndsAt": warm_end, "countedFrom": counted_from,
            "unknownProgram": unk,
            "months": rows, "notes": NOTES}


def decimate(path, step=TRAIL_STEP_S):
    """Keep one point per `step` seconds (always first and last); [dt, lat, lon, alt]."""
    if not path:
        return []
    t0, kept, last = path[0][0], [], None
    for i, p in enumerate(path):
        if last is None or p[0] - last >= step or i == len(path) - 1:
            kept.append([int(p[0] - t0), round(p[1], 4), round(p[2], 4), int(p[3] or 0)])
            last = p[0]
    return kept


def first_flight_legs(by_hex, airframes):
    """(airframe, leg) for each counted first flight."""
    pairs = []
    for a in airframes:
        if a["counted"]:
            leg = next(g for g in by_hex[a["hex"]] if g["start"] == a["firstFlight"]["t"])
            pairs.append((a, leg))
    return pairs


def make_trails(pairs):
    by_month = {}
    for a, leg in pairs:
        if not leg.get("path"):
            continue
        by_month.setdefault(month_of(a["firstFlight"]["t"]), []).append(
            {"hex": a["hex"], "program": a["program"], "t0": flight_path(leg)[0][0], "pts": decimate(flight_path(leg))})
    return by_month


def make_latest(by_hex, airframes, pairs):
    """12 newest airborne BOE legs; the newest counted first flight is always in."""
    info = {a["hex"]: a for a in airframes}
    firsts = {(a["hex"], g["start"]) for a, g in pairs}
    legs = [(g, hx) for hx, gs in by_hex.items() if hx in info for g in gs
            if is_boe(g) and airborne(g) and g.get("path")]
    legs.sort(key=lambda x: -x[0]["start"])
    chosen = legs[:LATEST_N]
    pinned = [x for x in legs if (x[1], x[0]["start"]) in firsts][:1]
    if pinned and pinned[0] not in chosen:
        chosen = chosen[:LATEST_N - 1] + pinned
    out = []
    for g, hx in chosen:
        a = info[hx]
        path = flight_path(g)
        t0 = path[0][0]
        pts = [[int(p[0] - t0), round(p[1], 4), round(p[2], 4), int(p[3] or 0)] for p in path]
        out.append({"hex": hx, "reg": a["reg"], "program": a["program"],
                    "callsign": next((c for c in g["callsigns"] if str(c).startswith("BOE")), None),
                    "from": g.get("from"), "to": g.get("to"), "t0": t0,
                    "durationS": flight_duration_s(g), "maxAltFt": max(p[3] for p in pts),
                    "firstFlight": (hx, g["start"]) in firsts, "flightTest": a["flightTest"], "pts": pts})
    out.sort(key=lambda r: -r["t0"])
    return out


def write_json(path, obj):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(obj, f, separators=(",", ":"), ensure_ascii=False)
        f.write("\n")
    os.replace(tmp, path)
