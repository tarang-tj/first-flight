"""Turn airframes and legs into ledger, trails and latest-flight files."""
import datetime
import json
import os

from .legs import airborne, is_boe

PROGRAMS = ["737", "767", "777", "777X"]
KEYS = PROGRAMS + ["unknown"]
TRAIL_STEP_S = 30
LATEST_N = 12

NOTES = [
    "A first flight is the first airborne leg (above 1,500 ft) with a BOE callsign of an airframe not seen airborne before, departing KRNT or KPAE. Ground runs and altitude spikes never count.",
    "The first 30 days of history are a warm-up: airframes first seen then are not counted, because we cannot tell new jets from old ones yet.",
    "Boeing's own flight-test fleet (for example N779X*, N2775x, N836BA, and typed Boeing-owned jets) is excluded from production counts.",
    "Program comes from the birth field and ICAO type code: Renton is 737; Paine Field jets use their type code, else 'unknown'. 737 MAX 10s at Paine Field are read as 737 because the 737 North Line in Everett began low-rate production in July 2026.",
    "Deliveries seen are departures from a Boeing field under a non-BOE callsign with no return in the history. They are a sky estimate, not Boeing's delivery count.",
    "Reported deliveries are Boeing's monthly figures as relayed by Forecast International, checked against Boeing's quarterly releases. Boeing's 737 count includes P-8 and 737-800A airframes; its 767 count includes the KC-46 airframe.",
    "Receiver coverage is uneven and the scanner drops days it cannot read. Missing days are listed in coverage and the sky count is a floor, not a census.",
]


def month_of(ts):
    return datetime.datetime.fromtimestamp(ts, datetime.timezone.utc).strftime("%Y-%m")


def month_range(first_day, last_day):
    y, m = int(first_day[:4]), int(first_day[5:7])
    end = (int(last_day[:4]), int(last_day[5:7]))
    out = []
    while (y, m) <= end:
        out.append("%04d-%02d" % (y, m))
        y, m = (y + 1, 1) if m == 12 else (y, m + 1)
    return out


def make_ledger(airframes, cov, deliveries_rows, warm_end, now):
    rep = {r["month"]: r for r in deliveries_rows}
    months = {}
    if cov["firstDay"]:
        for mo in month_range(cov["firstDay"], cov["lastDay"]):
            months[mo] = {"month": mo, "firstFlights": dict.fromkeys(KEYS, 0),
                          "deliveriesSeen": dict.fromkeys(KEYS, 0)}
    for a in airframes:
        if a["flightTest"]:
            continue
        if a["counted"]:
            months[month_of(a["firstFlight"]["t"])]["firstFlights"][a["program"]] += 1
        d = a["delivery"]
        if d and d["t"] >= warm_end:
            months[month_of(d["t"])]["deliveriesSeen"][a["program"]] += 1
    rows = []
    for mo in sorted(months):
        r = rep.get(mo)
        row = dict(months[mo])
        row["reported"] = {k: r[k] for k in ("737", "767", "777")} if r else None
        row["reportedSource"] = r["source"] if r else None
        if mo <= month_of(warm_end - 1):
            row["warmup"] = True
        rows.append(row)
    return {"generatedAt": now, "coverage": cov, "programs": PROGRAMS,
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
            {"hex": a["hex"], "program": a["program"], "t0": leg["path"][0][0], "pts": decimate(leg["path"])})
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
        t0 = g["path"][0][0]
        pts = [[int(p[0] - t0), round(p[1], 4), round(p[2], 4), int(p[3] or 0)] for p in g["path"]]
        out.append({"hex": hx, "reg": a["reg"], "program": a["program"],
                    "callsign": next((c for c in g["callsigns"] if str(c).startswith("BOE")), None),
                    "from": g.get("from"), "to": g.get("to"), "t0": t0,
                    "durationS": g["end"] - g["start"], "maxAltFt": max(p[3] for p in pts),
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
