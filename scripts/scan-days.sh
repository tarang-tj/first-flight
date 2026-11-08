#!/usr/bin/env bash
# Scan adsb.lol globe_history days into OUT/<day>.json (needs gh + GH_TOKEN).
# Usage: scripts/scan-days.sh OUT 2026-11-07 [2026-11-08 ...]
# Each day is about 3.4 GB; it streams through tools/scan_history.py and is
# never stored. A missing or failed day writes a marker file, so coverage
# gaps stay visible instead of silently vanishing.
set -uo pipefail
out=$1; shift
mkdir -p "$out"
for day in "$@"; do
  y=${day%%-*}; tagday=$(echo "$day" | tr '-' '.')
  repo="adsblol/globe_history_$y"
  urls=""
  for flavor in prod staging; do
    tag="v$tagday-planes-readsb-$flavor-0"
    # API asset URLs: the browser_download_url route returned 504s on 2026-11-08.
    urls=$(gh api "repos/$repo/releases/tags/$tag" --jq '[.assets[] | select(.name|test("\\.tar\\.a[a-z]$"))] | sort_by(.name) | map(.url) | join(" ")' 2>/dev/null || true)
    total=$(gh api "repos/$repo/releases/tags/$tag" --jq '[.assets[].size] | add' 2>/dev/null || echo 0)
    if [ -n "$urls" ] && [ "${total:-0}" -gt 1000000000 ]; then echo "$day: $flavor ($total bytes)"; break; fi
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
