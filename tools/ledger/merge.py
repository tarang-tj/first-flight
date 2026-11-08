"""Join flights that the archive cut at a UTC midnight into one leg."""
import math

DAY = 86400
MAX_GAP_S = 600          # end of day N to start of day N+1
SLACK_KM = 5.0           # position slack on top of distance at jet speed
MAX_KMS = 0.3            # km per second, faster than any airliner


def _km(a, b):
    p1, p2 = math.radians(a[1]), math.radians(b[1])
    dl = math.radians(b[2] - a[2])
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 12742.0 * math.asin(math.sqrt(min(1.0, h)))


def is_split(a, b):
    """True when leg b continues leg a across a UTC day boundary."""
    if a.get("end") is None or b.get("start") is None:
        return False
    gap = b["start"] - a["end"]
    if gap < 0 or gap > MAX_GAP_S or a["end"] // DAY == b["start"] // DAY:
        return False
    # Real flight cut by the archive: it was in the air and is still in the air.
    if a.get("to") is not None or b.get("from") is not None:
        return False
    pa, pb = a.get("path"), b.get("path")
    if pa and pb:
        return _km(pa[-1], pb[0]) <= SLACK_KM + MAX_KMS * gap
    return True


def join(a, b):
    out = dict(a)
    out["end"] = b["end"]
    out["to"] = b.get("to")
    calls = list(a.get("callsigns") or [])
    for c in b.get("callsigns") or []:
        if not calls or calls[-1] != c:
            calls.append(c)
    out["callsigns"] = calls
    out["touched"] = sorted(set(a.get("touched") or []) | set(b.get("touched") or []))
    out["maxAlt"] = max(a.get("maxAlt") or 0, b.get("maxAlt") or 0)
    out["boeingOp"] = bool(a.get("boeingOp") or b.get("boeingOp"))
    for k in ("reg", "type", "desc", "ownOp", "year"):
        if not out.get(k) and b.get(k):
            out[k] = b[k]
    out["untyped"] = not out.get("type")
    paths = [p for p in (a.get("path"), b.get("path")) if p]
    out["path"] = [pt for p in paths for pt in p] if paths else None
    return out


def merge_midnight_splits(legs):
    """`legs` sorted by start for one hex; returns a new list with splits joined."""
    out = []
    for g in legs:
        if out and is_split(out[-1], g):
            out[-1] = join(out[-1], g)
        else:
            out.append(g)
    return out
