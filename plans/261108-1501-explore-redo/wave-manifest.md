# Wave manifest: explore redo phase 1

| lane | goal | owns | gate | status |
|---|---|---|---|---|
| S (lead) | sky data builder | tools/ledger/sky.py, tools/build_ledger.py, web/data/sky/** | npm run test:py | done, tests/test_sky.py green on 3.12 and 3.9 |
| F | free flight + places + touch controls | web/world/free-fly.js, web/world/places.js, web/world/camera-rig.js, web/world/index.js (only the freeFly wiring lines), web/ui/fly-controls.js, web/ui/fly.css, tests/world-free-fly.test.mjs | node --test tests/*.test.mjs | done with concerns (place facts unsourced, touch untested) |
| T | time machine + Explore UI | web/air/sky-feed.js, web/air/sky-clock.js, web/world/sky-traffic.js, web/ui/explore-mode.js, web/ui/time-dial.js, web/ui/explore.css, web/main.js, web/ui/chrome.js, tests/air-sky.test.mjs | node --test tests/*.test.mjs | pending |
| lead | index.html css links, verify-boot explore mode, screenshots, commit | index.html, scripts/verify-boot.mjs | npm run gate | pending |

Resume: plan.md has the interfaces. Lanes never commit.
