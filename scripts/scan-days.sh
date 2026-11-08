#!/usr/bin/env bash
# Scan adsb.lol globe_history days into OUT/<day>.json (needs gh + GH_TOKEN).
# Usage: scripts/scan-days.sh OUT 2026-11-07 [2026-11-08 ...]
# Each day is about 3.4 GB; it streams through tools/scan_history.py and is
# never stored. A release that does not exist writes a "missing" marker and a
# download/scan failure writes a "failed" marker, so coverage gaps stay
# visible. Any other GitHub API error (auth, rate limit, outage) stops the run
# with exit 1: it must never pass as a quiet run full of missing days.
set -uo pipefail
out=$1; shift
mkdir -p "$out"

# Prints "<url url ...>\t<total bytes>" for a release tag, nothing if it does
# not exist; exits 1 on any other API error.
release_assets() {
  local repo=$1 tag=$2 body rc
  body=$(gh api "repos/$repo/releases/tags/$tag" 2>&1); rc=$?
  if [ $rc -ne 0 ]; then
    if printf '%s' "$body" | grep -q -E "Not Found|HTTP 404"; then return 0; fi
    echo "::error::gh api failed for $repo $tag: $(printf '%s' "$body" | head -c 300)" >&2
    exit 1
  fi
  # API asset URLs: the browser_download_url route returned 504s on 2026-11-08.
  printf '%s' "$body" | python3 -c '
import json, re, sys
d = json.load(sys.stdin)
parts = sorted((a for a in d.get("assets", []) if re.search(r"\.tar\.a[a-z]$", a["name"])), key=lambda a: a["name"])
print(" ".join(a["url"] for a in parts) + "\t" + str(sum(a["size"] for a in d.get("assets", []))))'
}

for day in "$@"; do
  y=${day%%-*}; tagday=$(echo "$day" | tr '-' '.')
  repo="adsblol/globe_history_$y"
  urls=""
  for flavor in prod staging; do
    info=$(release_assets "$repo" "v$tagday-planes-readsb-$flavor-0") || exit 1
    urls=${info%%$'\t'*}; total=${info##*$'\t'}
    if [ -n "$info" ] && [ -n "$urls" ] && [ "${total:-0}" -gt 1000000000 ]; then echo "$day: $flavor ($total bytes)"; break; fi
    urls=""
  done
  if [ -z "$urls" ]; then
    echo "$day: no usable release"; echo "{\"date\":\"$day\",\"missing\":true}" > "$out/$day.json"; continue
  fi
  if ( for u in $urls; do curl -fsSL --retry 5 --retry-delay 10 -H "Accept: application/octet-stream" -H "Authorization: Bearer $GH_TOKEN" "$u" || exit 1; done ) \
      | python3 tools/scan_history.py "$day" > "$out/$day.json"; then
    python3 -c "import json,sys;d=json.load(open(sys.argv[2]));print(sys.argv[1],'scanned',d['scanned'],'kept',d['boeing'],'legs',len(d['legs']))" "$day" "$out/$day.json"
  else
    echo "$day: scan failed"; echo "{\"date\":\"$day\",\"failed\":true}" > "$out/$day.json"
  fi
done
