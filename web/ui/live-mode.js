// Live mode: never empty. Replays the newest new-jet first flight on a loop,
// then layers live traffic on top when the feed answers.

import { h, clear } from "./dom.js";
import { routeText, relativeAgo, fmtDuration, fmtAlt, monthKey } from "./format.js";
import { samplePath, pathDuration, maxAltFt, trimToFlight } from "../air/path-player.js";
import { toTrailPoints, frameNear, poseLocal } from "../air/geo-bridge.js";
import { pickReplay, newestJets } from "../air/data.js";
import { classify } from "../air/classify.js";

const REPLAY_S = 22; // real seconds for the flight to draw
const HOLD_S = 4;    // real seconds the finished trail glows before the loop

export function headlineFor(replay, nowMs) {
  const what = replay.isNewJet ? "Latest new Boeing" : "Latest Boeing test flight";
  const id = replay.callsign || (replay.hex || "").toUpperCase();
  return `${what}: ${id}, ${routeText(replay.from, replay.to)}, ${relativeAgo(nowMs, replay.t0 + pathDuration(replay.pts))}`;
}

export function createLiveMode(ctx) {
  const { world, geo, ticker, chrome, data } = ctx;
  let run = null;

  function renderPanel(replay, status) {
    const host = chrome.stage;
    clear(host);
    if (!replay) {
      host.append(h("section.panel.hero", {},
        h("p.kicker", { text: "Waiting for data" }),
        h("h1.headline", { text: "No recorded flights loaded yet" }),
        h("p.lede", { text: "The flight data files are not available, so there is nothing to replay. The 3D world is still live to explore." })));
      return {};
    }
    const headline = h("h1.headline", { text: headlineFor(replay, Date.now()) });
    const traffic = h("p.traffic.mono", { "aria-live": "off" });
    const facts = [
      replay.program && replay.program !== "unknown" && `${replay.program}`,
      fmtDuration(pathDuration(replay.pts)),
      `up to ${fmtAlt(maxAltFt(replay.pts))}`,
    ].filter(Boolean).join("  ·  ");
    const actions = h("div.actions", {},
      replay.airframe && h("button.btn.primary", { type: "button", onclick: () => ctx.rideAirframe(replay.airframe) }, "Ride along"),
      replay.airframe && h("button.btn", { type: "button", onclick: () => ctx.openAirframe(replay.airframe.hex) }, "Birth certificate"));
    const counted = data.airframes.filter((a) => a.counted === true);
    const listTitle = counted.length ? "Newest jets" : "Recently seen";
    const list = h("ul.newest", { "aria-label": listTitle },
      newestJets(counted.length ? counted : data.airframes, 5).map((a) =>
        h("li", {}, h("button.row-btn", { type: "button", onclick: () => ctx.openAirframe(a.hex) },
          h("span.mono.cs", { text: a.firstFlight.callsign || a.reg || a.hex }),
          h("span.prog", { text: a.program === "unknown" ? "type n/a" : a.program }),
          h("span.ago", { text: relativeAgo(Date.now(), a.firstFlight.t) })))));
    host.append(h("section.panel.hero", {},
      h("p.kicker", { text: replay.isNewJet ? "New jet, first flight, replayed" : "Boeing test flight, replayed" }),
      headline, h("p.facts.mono", { text: facts }), actions, traffic,
      list.childNodes.length ? h("details.newest-wrap", {}, h("summary", { text: listTitle }), list) : null));
    return { headline, traffic, replay };
  }

  function trafficLine(ac) {
    const test = ac.filter((a) => classify(a) === "test").length;
    return `On the radar now: ${test} Boeing test ${test === 1 ? "flight" : "flights"}, ${ac.length - test} other aircraft.`;
  }

  async function enter() {
    const my = { alive: true, offs: [] };
    run = my;
    const legs = data.legs;
    const replay = await pickReplay({ airframes: data.airframes, legs, loadMonth: ctx.loadMonth, monthOf: monthKey });
    if (!my.alive) return;
    const ui = renderPanel(replay);
    const traffic = ctx.traffic;
    // Live layer: sync now if we already have data, and on every update.
    const showTraffic = () => {
      if (!ui.traffic) return;
      ui.traffic.textContent = ctx.live.status === "live" && ctx.live.ac.length ? trafficLine(ctx.live.ac) : "";
    };
    my.offs.push(ctx.live.subscribe((ac, fetchedAt) => { traffic?.sync(ac, fetchedAt); showTraffic(); }));
    if (ctx.live.ac.length) traffic?.sync(ctx.live.ac, ctx.live.fetchedAt);
    showTraffic();
    if (!replay) return;

    const path = trimToFlight(replay.pts);
    const points = toTrailPoints(geo, path);
    const dur = pathDuration(path);
    let jet = null, trail = null;
    try {
      jet = world?.addJet?.(`replay:${replay.hex || "x"}`, (replay.program && replay.program !== "unknown") ? replay.program : "737");
      jet?.setHighlight?.("test");
      trail = world?.addTrail?.(`replay:${replay.hex || "x"}`, points, { color: "#ff6a1a", glow: 1 });
    } catch (err) {
      console.warn(`[live] replay scene failed: ${err?.message || err}`);
    }
    if (world?.flyTo) {
      const f = frameNear(points, 100, 20, innerWidth >= 820);
      try { world.flyTo({ ...f, headingDeg: 20, pitchDeg: 30 }, 2600); }
      catch (err) { console.warn(`[live] camera move failed: ${err?.message || err}`); }
    }
    let clock = 0, lastText = 0;
    my.offs.push(ticker.add((dt, nowMs) => {
      clock = (clock + dt) % (REPLAY_S + HOLD_S);
      const p = Math.min(1, clock / REPLAY_S);
      const eased = p < 1 ? p : 1;
      const s = samplePath(path, eased * dur);
      if (s && jet) jet.setPose(poseLocal(geo, s), s.headingDeg, s.pitchDeg, 0);
      trail?.setProgress?.(eased);
      const fade = clock > REPLAY_S + HOLD_S - 1 ? Math.max(0, REPLAY_S + HOLD_S - clock) : 1;
      trail?.setOpacity?.(fade);
      traffic?.frame(Date.now());
      if (nowMs - lastText > 20000 && ui.headline) { lastText = nowMs; ui.headline.textContent = headlineFor(replay, Date.now()); }
    }));
    my.dispose = () => { trail?.dispose?.(); jet?.dispose?.(); };
  }

  function exit() {
    if (!run) return;
    run.alive = false;
    run.offs.forEach((f) => f());
    run.dispose?.();
    ctx.traffic?.clear();
    clear(chrome.stage);
    run = null;
  }

  return { enter, exit };
}
