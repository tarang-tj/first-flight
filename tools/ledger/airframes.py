"""Group legs by airframe; find first flights, deliveries, programs."""
import datetime

from .icao import country
from .merge import merge_midnight_splits
from .legs import (BIRTH_FIELDS, FIELDS, airborne, flight_duration_s, is_boe, is_flight_test,
                   max_alt_ft, program_of)

WARMUP_DAYS = 30


def warmup_end_ts(first_day, days=WARMUP_DAYS):
    """Unix time at which the 30-day warm-up (from the first good day) ends."""
    d = datetime.date.fromisoformat(first_day) + datetime.timedelta(days=days)
    return int(datetime.datetime(d.year, d.month, d.day, tzinfo=datetime.timezone.utc).timestamp())


def group_by_hex(days):
    by = {}
    for date in sorted(days):
        for leg in days[date]["legs"]:
            hx = leg.get("hex")
            if hx and leg.get("start") is not None:
                by.setdefault(hx, []).append(leg)
    for hx in by:
        by[hx].sort(key=lambda g: (g["start"], g.get("end", 0)))
        by[hx] = merge_midnight_splits(by[hx])
    return by


def _returned(legs, after_start):
    """True when a later leg departs from or lands at a Boeing field.

    `touched` is deliberately ignored: Sea-Tac arrivals overfly KBFI low, and
    an overflight is not a return.
    """
    return any(g["start"] > after_start and (g.get("from") in FIELDS or g.get("to") in FIELDS)
               for g in legs)


def find_delivery(legs, first_boe_start):
    """Departure from a Boeing field, non-BOE callsign, never seen back."""
    for g in legs:
        if g["start"] <= first_boe_start or g.get("from") not in FIELDS or not airborne(g):
            continue
        calls = [c for c in g.get("callsigns") or [] if c and not str(c).startswith("BOE")]
        if calls and not is_boe(g) and not _returned(legs, g["start"]):
            return {"t": g["start"], "callsign": calls[0]}
    return None


def build_airframes(by_hex, warm_end):
    """One record per airframe that has a BOE callsign flight in the air."""
    out = []
    for hx, legs in by_hex.items():
        boe_air = [g for g in legs if is_boe(g) and airborne(g)]
        if not boe_air:
            continue
        flown = [g for g in legs if airborne(g)]
        first = flown[0]
        reg = next((g["reg"] for g in reversed(legs) if g.get("reg")), None)
        own = next((g["ownOp"] for g in reversed(legs) if g.get("ownOp")), None)
        types = [g["type"] for g in legs if g.get("type")]
        born = first.get("from") if first.get("from") in FIELDS else None
        test = is_flight_test(reg, own, types[-1] if types else None)
        boe_call = next((c for c in first.get("callsigns") or [] if str(c).startswith("BOE")), None)
        counted = (is_boe(first) and born in BIRTH_FIELDS and not test and first["start"] >= warm_end)
        out.append({
            "hex": hx, "reg": reg, "country": country(hx),
            "program": program_of(born, types), "born": born,
            "firstFlight": {
                "t": first["start"],
                "callsign": boe_call or next(iter(first.get("callsigns") or []), None),
                "from": first.get("from"), "to": first.get("to"),
                "durationS": flight_duration_s(first),
                "maxAltFt": max_alt_ft(first),
            },
            "flights": len(flown), "lastSeen": max(g.get("end", g["start"]) for g in legs),
            "delivery": None if test else find_delivery(legs, boe_air[0]["start"]),
            "flightTest": test, "counted": counted,
        })
    out.sort(key=lambda a: (a["firstFlight"]["t"], a["hex"]))
    return out
