# Code review: commit 909d823 (Explore mode)

Scope: web/ui/explore-mode.js, time-dial.js, jet-markers.js, fly-controls.js, explore-camera.js, web/world/free-fly.js, camera-rig.js, sky-traffic.js, web/air/sky-feed.js, sky-clock.js, tools/ledger/sky.py, plus the main.js / world/index.js / data.js call sites they depend on.
Gates run: `node --test tests/air-sky.test.mjs tests/air-sky-skip.test.mjs tests/world-free-fly.test.mjs` 15/15 pass; `pytest tests/test_sky.py` 4/4 pass. No browser run (verify-boot not executed in this review).

## High

### H1. Desktop: clicking a jet never selects it; Follow is unreachable by click
- explore-mode.js:42 sets `root = chrome.stage.parentElement`, which is `#ui-root` (main.js:35). Listeners go on it at :103-104.
- index.html:26-27: `<canvas id="scene">` is a **sibling** of `#ui-root`, not inside it. Canvas pointer events bubble canvas -> body -> document; they never reach `#ui-root`.
- So `hit(e)` at :94 can only match `.fly-look` (inside `#ui-root`, touch only). On desktop, click a jet: explore's `onUp` never runs, no selection card, no Follow button. main.js:113-123 handles the click instead and opens a card only when the hex is a known airframe. For any other sky jet the click does nothing. Clicking empty sky to stop following does nothing too.
- Fix: put the explore listeners on `world.canvas` plus `root` (for `.fly-look`), or on `document`, and keep the `hit()` filter.

### H2. Phone: tapping a jet never opens the airframe card (main.js canvas handler is starved)
- fly.css:38: in explore on narrow screens `.fly-look` is `width:100%`, from `top:130px` down to just above the dial, with `pointer-events:auto`. That covers almost the whole 3D view.
- A tap on a jet lands on `.fly-look`, not the canvas. Explore's own handler selects it (because `hit()` accepts `.fly-look`), but main.js:113 listens on the canvas only, so `openAirframe(hex)` never runs. The comment at explore-mode.js:92 ("the airframe card ... is opened by main.js") is false on phones.
- Also: fly-controls.js:41 calls `preventDefault()` on the look area's pointerdown. It does not block pointerup, so selection still works. It only matters if you later move picking to `click`.
- Fix: in explore's `onUp`, call the same `openAirframe(hexOfPickId(id))` that main.js uses (ctx exposes `openAirframe`). Or forward `.fly-look` taps to the main pick path.

### H3. Month cache is unbounded: scrubbing the full span keeps about 43 MB of JSON parsed in memory
- sky-feed.js:124 `months` never evicts. data.js:7-18 `loadJson` also caches every URL's promise forever, so evicting from `months` alone would not free anything.
- Measured on disk: 23 month files totalling about 43 MB (2026-10.json is 3.2 MB: 774 flights, 101,791 points stored as 4-element arrays). Parsed into V8 arrays, that is several times the file size. One scrub across the slider (each `input` event calls `refresh(true)` -> `ensure`, explore-mode.js:40 and :131) fetches and keeps every month it passes, plus one prefetch each.
- Phone scenario: drag the dial from Nov 2026 back to Jan 2025. The tab ends up holding all 23 months, likely 150 MB+ of heap on top of the WebGL scene. iOS Safari kills tabs at that size.
- Fix: give the feed its own fetch, not the shared `loadJson` cache. Keep an LRU of about 4 months (current, previous, next, plus one). Debounce `ensure` during a scrub (load on `change`, or after the input has been still for about 150 ms).

### H4. A failed month or index load is cached forever; the "retried on next ensure()" comment is false
- sky-feed.js:131 says a failed load is retried. But `load` is `loadJson` (data.js:7), which caches the promise that resolved to `null` and returns it on every later call. `getMonth` deletes `inflight` and skips `months.set`, then calls `loadJson` again and gets the cached null.
- Scenario: one network blip on a 3 MB month on cellular. That month shows "no jets" for the rest of the session: `isReady` stays false at explore-mode.js:139, so the count never renders, and `nextNearTakeoff` ignores the month. Same for `index.json` at :26. One failed index fetch means Explore shows "could not be loaded" on every re-entry until a full reload.
- Fix: same as H3 (feed-owned fetch with no failure caching). Or have `loadJson` delete the cache entry when the result is null.

## Medium

### M1. Teardown skipped if the mode is left during the last `await` in enter()
- explore-mode.js:35-44 creates the traffic ribbon (a GPU mesh added to the scene), the jet-marker layer (`root.prepend`, not in `my.nodes`) and the dial (two window listeners, time-dial.js:41-42). `my.dispose` is only assigned at :175, after `await feed.ensure(clock.t)` at :146.
- If `exit()` runs while that await is pending (user taps another tab, or a ride calls `ctx.suspendMode`), `my.dispose` is undefined. The ribbon mesh (about 40,800 vertices x 13 floats plus a 122,400-entry Uint32 index, roughly 2.6 MB of buffers), the `.jet-layer` div and the dial's window `keydown`/`pointerdown` listeners all leak, once per cycle. The window is short when months are cached. It is real when `best.t - 3600` falls in a month not yet loaded, or when bestMoment returned null.
- Fix: register each teardown in `my.offs` right after creating the thing (`my.offs.push(() => traffic?.dispose())`, the same for markers and dial), or assign `my.dispose` before the first await.

### M2. Held keys come back after Follow / Stop following (camera drifts on its own)
- free-fly.js:112: `onKey` returns early when `!live()`, so keyups are dropped while chase has paused free flight. `pause()` (:73) and `disable()` (:71) never clear `down`.
- Scenario: hold W, click Find a jet (or Follow). Free flight pauses and fly-controls `hide()` zeroes `input.fwd` via `setStick(0,0)`. Release W while chasing; the keyup is ignored and `down` still has `fwd+`. Stop following, then press D: `pushKeys` rebuilds input from the stale `down`, and the camera flies forward and right with no key held until the user presses and releases W again.
- Fix: in `pause()` and `disable()`, call `down.clear(); pushKeys();`. Or process keyups even when not live.

### M3. Phone joystick or look pad can go dead after Follow
- fly-controls.js:30 ignores a new pointerdown while `id !== null`. `hide()` (:74) sets `wrap.hidden` (display:none) but never resets `id` or `lp`.
- Scenario: the left thumb is on the stick and the right thumb taps Follow. `hide()` hides the pad while it holds pointer capture. Capture is lost, and the pointerup goes to whatever is under the finger, so `end()` never runs. After Stop following, `show()` brings back a stick that ignores every touch (`id` is still set). The look pad (`lp`, :41) has the same problem.
- Fix: in `hide()`, reset `id = null; lp = null; knob.style.transform = ""`. Also listen for `lostpointercapture` and handle it like `end`/`lend`.

### M4. Stale "jump" reframe can hijack the camera after the user acts
- explore-mode.js:40: on "jump"/"now", `feed.ensure(clock.t).then(() => my.alive && my.frameJets?.(1800))`. Nothing checks that this is still the latest jump or that the user has not acted since. On a cold month (1-3 MB on a phone) the promise resolves seconds later.
- Scenario A: jump, then tap a Place chip before the data arrives. The place glide starts, then `frameJets` calls `fly.goTo`, which cancels it and swings the camera elsewhere.
- Scenario B: jump, then Find a jet before data arrives (or after, while the old month is still loading). `cameraTo` -> `goTo` -> `resume()` takes the camera back from the chase. But `my.followed` is still set, the rate stays locked at 1x, the card still says "Stop following", and on a phone the fly controls stay hidden (no joystick) until the user finds Stop following.
- Fix: keep a `jumpSeq` counter and only frame if it has not changed and `!my.followed`. Clear it on any place click or follow.

### M5. A followed jet that changes flight leaves the chase locked on a disposed mesh
- sky-traffic.js:114-117: when the same hex shows a new flight id (`e.fid !== f.id`), the old jet is disposed and a new one created under the same pick id. The id is in `seen`, so it is not in `gone`, and explore-mode.js:137 never unfollows. The rig keeps `chased` = the old wrapper (camera-rig.js:59 copies `chased.pos` every frame). That position is frozen where the old flight ended.
- Scenario: follow a jet and scrub the dial forward (scrub does not unfollow, :40) to that airframe's next flight. The camera stares at an empty spot while the HUD says you are following.
- Fix: have `sync` return the replaced ids too, or call `world.rig.chase(newHandle)` when the replaced id is the followed one.

### M6. Quiet-hour skip can jump over a month that is still loading
- explore-mode.js:160: `quietS` builds up whenever `my.near === 0`. That includes the time when the current month is not loaded yet (no actives, so near is 0). `nextNearTakeoff` (sky-feed.js:165) then searches only the loaded months among need and prefetch.
- Scenario at 600x or faster: viewing month M+2 loaded M+2 and M+1. Scrub to the start of M; M and M-1 start loading. On a phone the fetch takes more than 3 s. The skip fires, finds the first near takeoff in the loaded M+1 (the prefetch), and jumps there. All of month M is skipped with a "Skipped quiet hours" toast.
- Fix: add `feed.isReady(clock.t)` to the `quietS` condition.

### M7. Jet markers force a layout per jet per frame
- jet-markers.js:31 calls `world.project` per jet, which calls `canvas.getBoundingClientRect()` (world-probe.js:7) right after the previous iteration wrote `style.transform`, class and opacity. Each call forces a style and layout flush. With about 50 jets aloft at busy moments, that is about 50 flushes per frame on top of `offsetWidth` reads for new markers (:36). Visible as frame drops on mid-range phones.
- Fix: read the canvas rect once per `update()`, and pass it in or cache it in `project`. Batch reads before writes.

## Low

- L1. Bank angle is 1.5x too big. sky-feed.js:73-76: `hA` is the bearing over [dt-40, dt-20] and `hB` over [dt+20, dt+40]. Their midpoints are 60 s apart, but the turn rate divides by `SPAN_S*2 = 40`. Steady turns show 1.5x the turn rate, so too much bank (clamped at 35 deg). Divide by `SPAN_S * 3`.
- L2. Scrubber thumb freezes after a desktop drag. time-dial.js:60 skips `range.value = t` while the range has focus, and a range input keeps focus after mouseup. While the clock plays, the thumb stays still but the `--p` fill moves, until the user clicks elsewhere. WASD also stops working while it has focus (free-fly.js:110 treats INPUT as typing). Blur the range on `change`/`pointerup`.
- L3. densityBars month bounds are off by an hour. time-dial.js:16 hard-codes UTC-8 (`Date.UTC(..., 8)`), so April to October month edges are 1 h off in PDT. Cosmetic only (bar weights).
- L4. Play at the end of the data rewinds 22 months. sky-clock.js:26: after "Now" (sets t1 and pauses), Play jumps to Jan 2025, a month that is not loaded. That puts the user in a cold load at 600x. Probably not intended; consider rewinding to `best.t` or doing nothing.
- L5. findJet clears memory paths. explore-mode.js:87 calls `traffic.sync(acts, id)` with no `memory`. sky-traffic.js:136 then drops every cached memory path, and the next frame rebuilds them all (up to a full day of flights). A one-frame glow flicker plus wasted work. Pass the current memory.
- L6. Bad span throws. If `sky_flights` is empty, sky.py:88 writes `span: [None, None]`. sky-feed.js:141 accepts it (it is an array), and `createSkyClock` throws at sky-clock.js:8. enter() rejects, and the user sees an empty stage with no message. Validate finite span numbers in `loadIndex`.
- L7. `stateAt` writes `f._h` onto the shared month record (sky-feed.js:72). Harmless now, but the heading depends on which instants were sampled before (scrubbing back gives a different parked heading). Note only.

## Checked and fine
- Ticker callback, dial listeners, fly-controls window listeners, rig/free-fly canvas listeners: all removed on a normal exit. No rAF of their own (everything rides `world.onFrame`).
- Jet meshes: disposed when they leave the sky and on `clear()`. Ribbon geometry and material disposed on `dispose()`. `paths` cache pruned every sync. `colors` bounded by the number of programs.
- Async month loading: renders always read by the current `clock.t`, so out-of-order resolution cannot draw a stale month. Inflight requests are de-duplicated.
- monthKeyPT (Intl, America/Los_Angeles) matches sky.py `month_of` (LA tz). DST is handled on both sides. The prev-month window covers flights that cross month ends, and the memory window (24 h) fits inside the need set.
- Free-flight floor: applied during glides too (free-fly.js:164-166). The camera cannot end below ground+12 m. `groundAt` returns 0 outside the terrain (no NaN). Clamp, glide and lookPose maths are finite for the inputs seen.
- Quiet skip has no loop: it needs a 1800 s gap, resets the counter, and stays off while following.
- Exit while following: `follow(null)` -> `chase(null)` -> `resume`, then `disable` -> `handBack`, so the orbit rig is handed a consistent pose.

## Priority order
1. H1, H2 (picking is broken on both form factors)
2. H3, H4 (one fetch layer owned by the feed: LRU, no failure caching, debounced scrub)
3. M1 (register teardown before awaits), M2, M3 (stuck input)
4. M4, M5, M6
5. M7, then the Low items

## Unresolved questions
- Was click-to-select tested on desktop after the listeners moved to `#ui-root`? verify-boot only checks that jets exist, not picking. Adding a boot probe that clicks a projected jet would catch H1.

**Status:** DONE_WITH_CONCERNS
**Summary:** Reviewed 909d823 against code and call sites; unit gates green (15 node, 4 py). Found 4 high (jet picking broken on desktop and starved on phone, unbounded month cache, failed loads cached forever), 7 medium, 7 low.
**Concerns:** H1/H2 are DOM-structure findings verified by reading index.html, style.css and fly.css, not by a browser run. Memory size in H3 is estimated from the on-disk JSON, not measured as heap.
