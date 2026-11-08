"""Country of registry from an ICAO 24-bit address (Annex 10 Vol III, Table 9-1)."""
import bisect

from .icao_table import TABLE

_BLOCKS = []
for _line in TABLE.strip().splitlines():
    _lo, _hi, _name = _line.split(" ", 2)
    _BLOCKS.append((int(_lo, 16), int(_hi, 16), _name))
_BLOCKS.sort()
_STARTS = [b[0] for b in _BLOCKS]


def country(hex_id):
    """State of registry for a 6-digit hex address, or None when unknown/invalid."""
    try:
        n = int(str(hex_id).strip().lstrip("~"), 16)
    except (TypeError, ValueError):
        return None
    if not 0 <= n <= 0xFFFFFF:
        return None
    i = bisect.bisect_right(_STARTS, n) - 1
    if i >= 0 and _BLOCKS[i][0] <= n <= _BLOCKS[i][1]:
        return _BLOCKS[i][2]
    return None
