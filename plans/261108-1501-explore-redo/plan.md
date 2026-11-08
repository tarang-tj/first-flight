# First Flight redo: an explorable sky (track: UI build)

TJ 2026-11-08: "too plain, too boring, too robotic... the realism should come from the data,
the surroundings, the coolness should be in what's possible to explore."

Axis: from a site you watch to a world you explore. Realism = real tracks, real terrain, real sun.
Cool = fly anywhere, scrub any moment in 22 months, click any jet.

## Phase 1 (this wave): walking skeleton of the core flow, shown to TJ before going wide
- DONE (lead): `tools/ledger/sky.py` -> `web/data/sky/index.json` + `web/data/sky/YYYY-MM.json`
  (every airborne Boeing-operated or BOE-callsign flight with a path, 30 s points, Pacific months).
- Lane F: free-flight camera + places + touch controls.
- Lane T: time machine (clock, month streaming, interpolated jets with comet tails) + Explore mode UI.
- Lead: wire, gate, screenshots, show TJ.

## Phase 2 (after TJ reacts): visual level (clouds, contrails, jet detail, landmark buildings, sound)

## Interfaces (fixed; lanes code against these)
Sky data
- index.json: `{months:[{key,flights,peak,peakT}], span:[t0,t1], moments:[{t,n}]}` (unix s)
- YYYY-MM.json: `[{id,hex,reg,cs,type,program,ff,t0,t1,pts:[[dt,lat,lon,altFt]]}]`; program in
  737|767|777|777X|unknown; ff = counted first flight. Altitude is baro feet MSL; use `toLocal(lat,lon,alt*FT)` from web/geo.js.

World API added by lane F (web/world/free-fly.js, places.js; camera-rig.js integration)
- `world.freeFly.enable()`, `.disable()`, `.active` (bool). While active the orbit rig is idle; the
  camera is a free flyer. `world.rig.chase(jet)` still works and suspends free flight; `chase(null)`
  resumes free flight from the current camera pose.
- `world.freeFly.goTo({x,y,z,headingDeg,pitchDeg}, ms)` -> Promise; smooth glide (arcs up for long hops).
- `world.freeFly.speedMs` (read-only current ground speed, for HUD), `world.freeFly.altM` (above MSL).
- `PLACES` export from web/world/places.js: `[{key,label,lat,lon,altM,headingDeg,pitchDeg,blurb}]`
  plus `placePose(place)` -> goTo arg. Keys: renton, everett, bfi, moses, seattle, rainier.

Explore mode (lane T) registers mode key `explore` (new default; live/year/ledger stay as tabs).

## Assumptions ledger
| ID | assumption | basis | blast radius | checked in |
| A1 | 15 MB gz of sky data is fine on Pages (0.3-0.7 MB per month, loaded lazily) | measured 2026-11-08 | slow first scrub on phones | lead screenshots + network |
| A2 | at most ~14 Boeing jets aloft at once, so per-jet meshes are fine (no instancing) | index peak 14 | frame rate | lane T perf check |
| A3 | TJ judges from a screenshot/clip before phase 2 | wave 1 rejections came after full builds | wasted phase 2 | lead |
