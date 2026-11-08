"""Scan one day of adsb.lol globe_history (a readsb tar stream on stdin) and
keep only Boeing jets that touched a Boeing airfield in Washington.

Output (stdout): one JSON object
  {"date": "YYYY-MM-DD", "scanned": N, "boeing": M, "legs": [...]}
Each leg is one flight (split on the readsb "new leg" flag) that started or
ended at a watched airfield:
  {hex, reg, type, desc, ownOp, callsign, start, end, from, to, maxAlt, path}
`path` is decimated to about one point per 20 s: [unixSec, lat, lon, altFt].

Data: adsb.lol globe_history, ODbL 1.0. Standard library only, so the CI job
needs no installs. Format: github.com/wiedehopf/readsb README-json.md.
"""
import gzip
import json
import math
import re
import sys
import tarfile
import zlib

# Boeing airfields in Washington plus the Moses Lake flight test center.
AIRFIELDS = {
    "KPAE": (47.9063, -122.2816),  # Paine Field, Everett (767, 777, 777X)
    "KRNT": (47.4931, -122.2158),  # Renton (737)
    "KBFI": (47.5300, -122.3019),  # Boeing Field, Seattle (737 flight line)
    "KMWH": (47.2077, -119.3200),  # Grant County, Moses Lake (flight test)
}
NEAR_KM = 4.0          # within this of the runway centre counts as "at" it
LOW_FT = 3000          # and below this altitude (or on the ground)
DECIMATE_S = 20.0
TYPE_RE = re.compile(rb'"t"\s*:\s*"([^"]*)"')


def km(lat1, lon1, lat2, lon2):
    """Great-circle distance in km (haversine)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 12742.0 * math.asin(math.sqrt(min(1.0, a)))


def airfield_at(lat, lon, alt):
    """Name of the watched airfield this point sits on, or None."""
    if lat is None or lon is None:
        return None
    if not (alt == "ground" or alt is None or (isinstance(alt, (int, float)) and alt < LOW_FT)):
        return None
    for code, (alat, alon) in AIRFIELDS.items():
        if abs(lat - alat) < 0.08 and abs(lon - alon) < 0.12 and km(lat, lon, alat, alon) <= NEAR_KM:
            return code
    return None


def is_boeing_type(t):
    """ICAO designators of Boeing airliners (B7xx, B3xM MAX) and the P-8."""
    return bool(t) and (t.startswith("B7") or re.fullmatch(r"B3[789X]M", t) is not None or t == "P8")


def raw_bytes(blob):
    """Trace files are gzip json even when named .json; accept plain too."""
    return gzip.decompress(blob) if blob[:2] == b"\x1f\x8b" else blob


def peek_type(blob):
    """Read the "t" field from the first bytes only, without a full parse."""
    head = blob[:2048]
    if head[:2] == b"\x1f\x8b":
        try:
            head = zlib.decompressobj(16 + zlib.MAX_WBITS).decompress(blob, 4096)
        except zlib.error:
            return None
    m = TYPE_RE.search(head[:4096])
    return m.group(1).decode("ascii", "replace") if m else None


def split_legs(trace):
    """Split trace rows into legs on the readsb new-leg flag (flags & 2)."""
    legs, cur = [], []
    for row in trace:
        flags = row[6] if len(row) > 6 and isinstance(row[6], int) else 0
        if flags & 2 and cur:
            legs.append(cur)
            cur = []
        cur.append(row)
    if cur:
        legs.append(cur)
    return legs


def leg_record(doc, rows):
    """Summarise one leg, or None when it never touched a watched airfield."""
    t0 = float(doc["timestamp"])
    pts, callsigns, last_kept = [], [], -1e9
    touched = []
    max_alt = 0
    for row in rows:
        sec, lat, lon, alt = row[0], row[1], row[2], row[3]
        ap = airfield_at(lat, lon, alt)
        if ap:
            touched.append(ap)
        if isinstance(alt, (int, float)):
            max_alt = max(max_alt, alt)
        extra = row[8] if len(row) > 8 and isinstance(row[8], dict) else None
        if extra and extra.get("flight"):
            cs = extra["flight"].strip()
            if cs and (not callsigns or callsigns[-1] != cs):
                callsigns.append(cs)
        if sec - last_kept >= DECIMATE_S and lat is not None:
            pts.append([round(t0 + sec), round(lat, 5), round(lon, 5), 0 if alt == "ground" else alt])
            last_kept = sec
    if not touched or not pts:
        return None
    last = rows[-1]
    if last[1] is not None and last[2] is not None:
        pts.append([round(t0 + last[0]), round(last[1], 5), round(last[2], 5), 0 if last[3] == "ground" else last[3]])
    first_ap = airfield_at(rows[0][1], rows[0][2], rows[0][3])
    last_ap = airfield_at(last[1], last[2], last[3])
    # Full paths only for Boeing-operated flights (BOE callsigns or a Boeing
    # owner); airline legs keep the summary, which keeps a year of days small.
    # Untyped jets departing or landing at a Boeing field are kept in full too:
    # they are the likeliest new airframes on first flights.
    boeing_op = (any(c.startswith("BOE") for c in callsigns)
                 or "boeing" in (doc.get("ownOp") or "").lower()
                 or (not doc.get("t") and (first_ap or last_ap) is not None))
    return {
        "hex": doc.get("icao"),
        "reg": doc.get("r"),
        "type": doc.get("t"),
        "desc": doc.get("desc"),
        "ownOp": doc.get("ownOp"),
        "year": doc.get("year"),
        "callsigns": callsigns,
        "start": pts[0][0],
        "end": pts[-1][0],
        "from": first_ap,
        "to": last_ap,
        "touched": sorted(set(touched)),
        "maxAlt": max_alt,
        "boeingOp": boeing_op,
        "untyped": not doc.get("t"),
        "path": pts if boeing_op else None,
    }


def scan(stream, date):
    scanned = boeing = 0
    legs = []
    with tarfile.open(fileobj=stream, mode="r|*") as tar:
        for member in tar:
            if not member.isfile() or "trace_full_" not in member.name:
                continue
            f = tar.extractfile(member)
            if f is None:
                continue
            blob = f.read()
            scanned += 1
            # "~" ids are TIS-B/non-ICAO targets (often ground vehicles or GA): skip.
            if "trace_full_~" in member.name:
                continue
            # Brand-new airframes are often not in the aircraft database yet,
            # so they carry no type at all: keep untyped traces too.
            t = peek_type(blob)
            if t is not None and not is_boeing_type(t):
                continue
            try:
                doc = json.loads(raw_bytes(blob))
            except (ValueError, OSError, EOFError):
                continue
            boeing += 1
            for rows in split_legs(doc.get("trace") or []):
                rec = leg_record(doc, rows)
                if rec:
                    legs.append(rec)
    legs.sort(key=lambda r: r["start"])
    return {"date": date, "scanned": scanned, "boeing": boeing, "legs": legs}


if __name__ == "__main__":
    out = scan(sys.stdin.buffer, sys.argv[1] if len(sys.argv) > 1 else None)
    if out["scanned"] == 0:
        sys.stderr.write("no trace files in the stream\n")
        sys.exit(2)
    json.dump(out, sys.stdout, separators=(",", ":"))
