// Explore mode: fly freely, pick any moment in the data span, and the sky fills with the Boeing jets
// that were really aloft then. Lane F supplies free flight, places and fly controls; every piece of
// that is optional here so the mode still boots (orbit camera, no places bar) if it is missing.
import { h } from "./dom.js";
import { attachPick } from "./explore-pick.js";
import { createTimeDial } from "./time-dial.js";
import { createJetMarkers } from "./jet-markers.js";
import { nearby, openingPose, screenJetsOf } from "./explore-camera.js";
import { createSkyClock } from "../air/sky-clock.js";
import { createSkyFeed, tailSeconds, nearCount } from "../air/sky-feed.js";
import { createSkyTraffic } from "../world/sky-traffic.js";

const KT = 1.94384, FT_PER_M = 3.28084, MEMORY_RATE = 600;

export function createExploreMode(ctx) {
  const { world, ticker, chrome } = ctx;
  let run = null;
  const feed = createSkyFeed();

  const optional = async (path) => {
    try { return await import(path); } catch (err) { console.warn(`[explore] ${path} unavailable: ${err?.message || err}`); return null; }
  };

  async function enter() {
    const my = { alive: true, offs: [], nodes: [], count: 0, near: 0, selected: null, followed: null, fc: null, visited: new Set(), rateBefore: 1 };
    run = my;
    const index = await feed.loadIndex();
    if (!my.alive) return;
    if (!index) { chrome.stage.append(h("p.lede", { text: "The flight history could not be loaded. Charts in the other tabs still work." })); return; }
    const fallbackT = Math.max(...(index.moments.length ? index.moments.map((m) => m.t) : [index.span[1]]));
    const best = await feed.bestMoment(); // newest busy moment with the most jets near Puget Sound
    if (!my.alive) return;
    // Open fast (the memory layer draws the region) but an hour before the peak, paused until the world is up.
    const clock = createSkyClock({ span: index.span, t: (best?.t ?? fallbackT) - 3600, rate: 600, playing: false, restartAt: (best?.t ?? fallbackT) - 3600 });
    my.clock = clock;
    const traffic = world ? createSkyTraffic(world) : null;
    my.traffic = traffic;
    my.offs.push(() => traffic?.dispose()); // register each teardown as the thing is created, so a leave during an await still cleans up
    const fly = world?.freeFly;

    const sel = h("div.ex-sel", { hidden: true });
    let jumpSeq = 0, scrubTimer = 0;
    const settle = () => { my.scrubbing = false; lastEnsure = clock.t; return feed.ensure(clock.t); };
    const dial = createTimeDial({ clock, index, onChange: (why) => {
      my.touched = true; jumpSeq++;
      tickSun(true);
      if (why === "scrub") { // load months only once the slider has been still for a moment
        my.scrubbing = true; clearTimeout(scrubTimer); scrubTimer = setTimeout(settle, 150);
      } else if (why === "jump" || why === "now") {
        follow(null); select(null);
        const seq = jumpSeq;
        settle().then(() => my.alive && seq === jumpSeq && !my.followed && my.frameJets?.(1800));
      }
      refresh(false);
    } });
    my.offs.push(() => { clearTimeout(scrubTimer); dial.dispose(); });
    chrome.stage.append(h("div.ex-wrap", {}, sel, dial.el));
    const root = chrome.stage.parentElement;
    const hud = h("div.ex-hud", { "aria-hidden": "true" });
    const markers = world ? createJetMarkers({ root, world }) : null;
    my.offs.push(() => markers?.dispose());
    root.append(hud);
    my.nodes.push(hud);

    const cameraTo = (pose, ms = 0) => {
      try {
        if (fly?.goTo) { fly.enable?.(); return fly.goTo(pose, ms); }
        return world?.rig?.snapTo?.({ target: { x: pose.x, y: pose.y, z: pose.z }, distance: 3000, headingDeg: pose.headingDeg, pitchDeg: pose.pitchDeg });
      } catch (err) { console.warn(`[explore] camera placement failed: ${err?.message || err}`); }
    };

    function select(id) {
      my.selected = id;
      sel.replaceChildren();
      const info = id && traffic?.infoOf(id);
      sel.hidden = !info;
      if (!info) return;
      const following = my.followed === id;
      sel.append(
        h("span.ex-sel-name", { text: info.cs || info.reg || info.hex }),
        h("span.ex-sel-meta", { text: [info.reg, info.type, info.ff ? "first flight" : info.program !== "unknown" ? `${info.program} program` : ""].filter(Boolean).join("  ·  ") }),
        h("button.ex-btn.is-primary", { type: "button", text: following ? "Stop following" : "Follow", onclick: () => follow(following ? null : id) }),
        h("button.ex-btn", { type: "button", "aria-label": "Clear selection", text: "x", onclick: () => { follow(null); select(null); } }));
    }
    function follow(id) {
      const handle = id ? traffic?.handleOf(id) : null;
      if (!handle && !my.followed) return;
      try {
        world?.rig?.chase?.(handle);
        if (handle) { if (!my.followed) my.rateBefore = clock.rate; clock.setRate(1); my.fc?.hide?.(); } else { clock.setRate(my.rateBefore); my.fc?.show?.(); }
      } catch (err) { console.warn(`[explore] follow failed: ${err?.message || err}`); }
      my.followed = handle ? id : null;
      select(my.selected);
      dial.update(my.count, my.near);
    }
    const here = () => (world?.camera ? { x: world.camera.position.x, z: world.camera.position.z } : { x: 0, z: 0 });
    function findJet() {
      const all = nearby(feed.activeAt(clock.t, 0), here()).filter((x) => x.a.altFt > 300);
      if (!all.length) return;
      let list = all.filter((x) => !my.visited.has(x.a.flight.hex));
      if (!list.length) { my.visited.clear(); list = all; }
      const pick = list[0], id = `sky:${pick.a.flight.hex}`;
      my.visited.add(pick.a.flight.hex);
      jumpSeq++;
      select(id);
      follow(id);
    }

    my.offs.push(attachPick({ world, ctx, chrome, onSelect: select, onClear: () => { follow(null); select(null); } }));

    try { fly?.enable?.(); } catch (err) { console.warn(`[explore] freeFly.enable failed: ${err?.message || err}`); }
    optional("./fly-controls.js").then((m) => {
      if (!my.alive || !m?.createFlyControls) return;
      try { my.fc = m.createFlyControls(root, world); if (!my.followed) my.fc?.show?.(); } catch (err) { console.warn(`[explore] fly controls failed: ${err?.message || err}`); }
    });
    optional("../world/places.js").then((m) => {
      if (!my.alive || !m?.PLACES || !fly?.goTo) return;
      const bar = h("nav.ex-places", { "aria-label": "Places" }, [
        h("button.ex-chip.is-jet", { type: "button", text: "Find a jet", onclick: findJet }),
        ...m.PLACES.map((p) => h("button.ex-chip", { type: "button", title: p.blurb || "", text: p.label, onclick: () => { jumpSeq++; follow(null); select(null); cameraTo(m.placePose(p), 2600); } })),
      ]);
      root.append(bar);
      my.nodes.push(bar);
    });

    // Sim loop
    let sunAt = 0, lastEnsure = -1, ready = false, lastHud = 0;
    function tickSun(force) {
      const now = performance.now();
      if (!force && now - sunAt < 500) return;
      sunAt = now;
      try { world?.setSun?.(new Date(clock.t * 1000)); } catch (err) { console.warn(`[explore] setSun failed: ${err?.message || err}`); }
    }
    function refresh(force) {
      if (!my.scrubbing && (force || Math.abs(clock.t - lastEnsure) > 3600)) { lastEnsure = clock.t; feed.ensure(clock.t); }
      const acts = feed.activeAt(clock.t, tailSeconds(clock.rate));
      const memory = clock.rate >= MEMORY_RATE ? feed.memoryAt(clock.t) : [];
      const gone = traffic ? traffic.sync(acts, my.selected, memory) : [];
      my.count = acts.length;
      my.near = nearCount(acts);
      if (gone.includes(my.selected)) { if (my.followed === my.selected) follow(null); select(null); }
      if (traffic && markers) markers.update(traffic.entries(), my.selected, innerWidth < 820 ? 110 : 120, innerWidth < 820 ? 240 : 190);
      dial.update(feed.isReady(clock.t) ? my.count : undefined, my.near);
    }
    function frameJets(ms) {
      const open = openingPose(nearby(feed.activeAt(clock.t, 0)).filter((x) => Math.hypot(x.p.x, x.p.z) < 150000), world?.groundAt?.bind(world), 3, innerWidth / innerHeight);
      if (open) cameraTo(open.pose, ms);
    }
    my.frameJets = frameJets;
    await feed.ensure(clock.t);
    if (!my.alive) return;
    ready = true;
    tickSun(true);
    frameJets(0);
    refresh(true);
    // Start the clock once imagery is in (or after 8 s), so nobody misses the busy hour while tiles stream.
    Promise.race([world?.imageryReady, new Promise((r) => setTimeout(r, 8000))]).catch(() => {}).then(() => { if (my.alive && !my.touched && !clock.playing && clock.t < clock.span[1]) clock.play(); });
    let quietS = 0;

    my.offs.push(ticker.add((dt, nowMs) => {
      if (!ready) return;
      clock.tick(dt);
      // Skip quiet hours at fast rates: after 3 real seconds with nothing near Puget Sound, jump to just before the next takeoff there.
      quietS = clock.playing && clock.rate >= MEMORY_RATE && my.near === 0 && !my.followed && feed.isReady(clock.t) ? quietS + dt : 0;
      if (quietS > 3) {
        quietS = 0;
        const next = feed.nextNearTakeoff(clock.t);
        if (next && next - clock.t > 1800) { clock.set(next - 600); dial.flash?.("Skipped quiet hours"); refresh(true); }
      }
      tickSun(false);
      refresh(false);
      if (nowMs - lastHud > 250) {
        lastHud = nowMs;
        const alt = fly?.altM, spd = fly?.speedMs;
        hud.textContent = "";
        if (Number.isFinite(alt) && fly.active) hud.append("ALT ", h("b", { text: Math.round(alt * FT_PER_M).toLocaleString("en-US") }), " ft", h("br"), "SPEED ", h("b", { text: String(Math.round((spd || 0) * KT)) }), " kt");
      }
    }));
    my.dispose = () => follow(null);
  }

  function exit() {
    if (!run) return;
    const my = run;
    run = null;
    my.alive = false;
    my.offs.forEach((f) => f());
    try { my.dispose?.(); } catch (err) { console.warn(`[explore] teardown: ${err?.message || err}`); }
    try { (my.fc?.dispose || my.fc?.destroy)?.call(my.fc); } catch (err) { console.warn(`[explore] fly controls teardown: ${err?.message || err}`); }
    my.nodes.forEach((n) => n.remove());
    try { world?.freeFly?.disable?.(); world?.rig?.chase?.(null); world?.setSun?.(new Date()); } catch (err) { console.warn(`[explore] restore failed: ${err?.message || err}`); }
    chrome.stage.replaceChildren();
  }

  return { enter, exit, activeCount: () => run?.count ?? 0, screenJets: () => screenJetsOf(world, run?.traffic) };
}
