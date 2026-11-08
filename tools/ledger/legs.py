"""Leg-level rules: what counts as airborne, a ground run, a test-fleet jet."""
import re

FIELDS = ("KRNT", "KPAE", "KBFI")
BIRTH_FIELDS = ("KRNT", "KPAE")
AIRBORNE_FT = 1500
MIN_AIR_POINTS = 3
TEST_REG_RE = re.compile(r"^(N779X[A-Z0-9]|N2775\d|N836BA)$")

PROGRAM_BY_TYPE = {
    "B762": "767", "B763": "767", "B764": "767",
    "B772": "777", "B773": "777", "B77L": "777", "B77W": "777",
    "B778": "777X", "B779": "777X",
    "B37M": "737", "B38M": "737", "B39M": "737", "B3XM": "737",
    "P8": "737", "B737": "737", "B738": "737",
}


def is_boe(leg):
    return any(str(c).startswith("BOE") for c in leg.get("callsigns") or [])


def airborne(leg):
    """True flight, not a ground run or a bogus altitude spike.

    Needs at least 3 path points above 1,500 ft and at least a fifth of the
    path up there; maxAlt alone is never trusted. Legs without a path (airline
    summaries) fall back to a long duration plus a high maxAlt.
    """
    path = leg.get("path")
    if path:
        high = sum(1 for p in path if isinstance(p[3], (int, float)) and p[3] > AIRBORNE_FT)
        return high >= MIN_AIR_POINTS and high * 5 >= len(path)
    return (leg.get("maxAlt") or 0) > AIRBORNE_FT and (leg.get("end", 0) - leg.get("start", 0)) >= 600


def max_alt_ft(leg):
    """Highest path altitude, dropping a single spike far above its neighbours."""
    alts = sorted((p[3] for p in leg.get("path") or [] if isinstance(p[3], (int, float))), reverse=True)
    if not alts:
        return int(leg.get("maxAlt") or 0)
    if len(alts) >= 3 and alts[0] - alts[1] > 8000:
        return int(alts[1])
    return int(alts[0])


AIRLINE_CS_RE = re.compile(r"^[A-Z]{3}\d")


def flew_as_airline(legs):
    """True if the airframe ever used an airline-style callsign (SWA2208,
    UAL737), other than Boeing's own BOE and RDN."""
    for g in legs:
        for c in g.get("callsigns") or []:
            c = str(c)
            if AIRLINE_CS_RE.match(c) and not c.startswith(("BOE", "RDN")):
                return True
    return False


def is_flight_test(reg, own_op, typ, airline_seen=False, seen_before_warmup=True):
    """Boeing's own test fleet: known test registrations, or a typed
    Boeing-owned jet that never flew for an airline and was already flying
    when our history starts.

    The aircraft database keeps "BOEING CO" as owner on many delivered jets
    (Southwest, United and American 737s), so ownership alone is not enough:
    a jet that later flies as SWA2208 is a delivered production jet. Brand-new
    jets are usually untyped, so an untyped Boeing-owned jet is not test fleet.
    """
    if reg and TEST_REG_RE.match(reg):
        return True
    boeing_owned = bool(own_op) and str(own_op).upper().startswith("BOEING") and bool(typ)
    return boeing_owned and not airline_seen and seen_before_warmup


def program_of(born, types):
    """Program from the birth field and any type code seen on the airframe."""
    if born == "KRNT":
        return "737"
    for t in types:
        if t in PROGRAM_BY_TYPE:
            return PROGRAM_BY_TYPE[t]
    return "unknown"


def flight_span(path, pad_s=300):
    """Indices (i0, i1) of the airborne part of a path: first to last point
    above the ground, plus one ground point on each side when it is within
    pad_s. A jet can sit on the ground transmitting for hours before takeoff;
    that time is not flight time."""
    air = [i for i, p in enumerate(path) if (p[3] or 0) > 0]
    if not air:
        return 0, len(path) - 1
    i0, i1 = air[0], air[-1]
    if i0 > 0 and path[i0][0] - path[i0 - 1][0] <= pad_s:
        i0 -= 1
    if i1 < len(path) - 1 and path[i1 + 1][0] - path[i1][0] <= pad_s:
        i1 += 1
    return i0, i1


def flight_path(leg):
    """The leg's path trimmed to its airborne span (or None without a path)."""
    path = leg.get("path")
    if not path:
        return None
    i0, i1 = flight_span(path)
    return path[i0:i1 + 1]


def flight_duration_s(leg):
    """Airborne duration in seconds; falls back to end - start without a path."""
    path = flight_path(leg)
    if not path:
        return leg.get("end", leg["start"]) - leg["start"]
    return int(path[-1][0] - path[0][0])
