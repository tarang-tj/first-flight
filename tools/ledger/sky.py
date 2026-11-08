"""The time machine's data: every airborne Boeing-operated flight with a path,
bucketed by Pacific month, plus the busiest instants worth jumping to.

web/data/sky/index.json  {months: [{key, flights, peak, peakT}], moments: [{t, n, label}]}
web/data/sky/YYYY-MM.json [{id, hex, reg, cs, program, ff, t0, t1, pts: [[dt, lat, lon, altFt]]}]

A flight lands in the month its takeoff falls in; the viewer loads the month
before too, so a flight that crosses midnight at a month end is never lost.
"""
import heapq

from .legs import airborne, flight_path, is_boe
from .outputs import month_of

SKY_STEP_S = 30     # keep one point per 30 s; the viewer interpolates between them
MOMENTS_N = 12
MOMENT_GAP_S = 6 * 3600  # two busy moments must be at least this far apart


def thin(path, step=SKY_STEP_S):
    """One point per `step` seconds (always first and last): [dt, lat, lon, altFt]."""
    if not path:
        return []
    t0, kept, last = path[0][0], [], None
    for i, p in enumerate(path):
        if last is None or p[0] - last >= step or i == len(path) - 1:
            kept.append([int(p[0] - t0), round(p[1], 4), round(p[2], 4), int(p[3] or 0)])
            last = p[0]
    return kept


def sky_flights(by_hex, airframes):
    """One record per airborne pathed leg of a Boeing-operated or BOE-callsign flight."""
    info = {a["hex"]: a for a in airframes}
    firsts = {(a["hex"], a["firstFlight"]["t"]) for a in airframes if a.get("firstFlight") and a.get("counted")}
    out = []
    for hx, legs in by_hex.items():
        a = info.get(hx, {})
        for g in legs:
            if not g.get("path") or not (g.get("boeingOp") or is_boe(g)) or not airborne(g):
                continue
            p = flight_path(g)
            if not p or len(p) < 2:
                continue
            pts = thin(p)
            cs = next((c for c in g.get("callsigns") or [] if c), "")
            out.append({
                "id": "%s-%d" % (hx, p[0][0]), "hex": hx, "reg": g.get("reg") or a.get("reg") or "",
                "cs": cs, "type": g.get("type") or "", "program": a.get("program") or "unknown",
                "ff": (hx, g["start"]) in firsts, "t0": int(p[0][0]), "t1": int(p[-1][0]), "pts": pts,
            })
    out.sort(key=lambda f: f["t0"])
    return out


def airborne_counts(flights):
    """Sweep: list of (t, n) after each takeoff, n = flights in the air."""
    events = sorted([(f["t0"], 1) for f in flights] + [(f["t1"], -1) for f in flights], key=lambda e: (e[0], e[1]))
    n, out = 0, []
    for t, d in events:
        n += d
        if d > 0:
            out.append((t, n))
    return out


def busiest_moments(flights, k=MOMENTS_N, gap=MOMENT_GAP_S):
    """Up to k takeoff instants with the most jets aloft, at least `gap` apart."""
    chosen = []
    for n, t in heapq.nlargest(len(flights), ((n, t) for t, n in airborne_counts(flights))):
        if all(abs(t - c["t"]) >= gap for c in chosen):
            chosen.append({"t": t, "n": n})
            if len(chosen) == k:
                break
    return sorted(chosen, key=lambda c: c["t"])


def make_sky(flights):
    """(index, {month: [flight...]})"""
    months = {}
    for f in flights:
        months.setdefault(month_of(f["t0"]), []).append(f)
    rows = []
    for key in sorted(months):
        counts = airborne_counts(months[key])
        peak_t, peak = max(counts, key=lambda c: c[1]) if counts else (None, 0)
        rows.append({"key": key, "flights": len(months[key]), "peak": peak, "peakT": peak_t})
    span = [flights[0]["t0"], max(f["t1"] for f in flights)] if flights else [None, None]
    return {"months": rows, "span": span, "moments": busiest_moments(flights)}, months
