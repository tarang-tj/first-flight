// Live mode: never empty. Opens on the plant, then replays the newest Boeing flights one after
// another as a short film (see live-story.js). Live traffic layers on top when the feed answers.

import { monthKey, fmtAlt, fmtClock } from "./format.js";
import { samplePathSmooth, groundSpeedKt, arcFractionAt, pathDuration, trimToFlight } from "../air/path-player.js";
import { toTrailPoints, frameNear, poseLocal } from "../air/geo-bridge.js";
import { pickReplay } from "../air/data.js";
import { classify } from "../air/classify.js";
import { createLivePanel, trafficLine, headlineFor } from "./live-panel.js";
import { phaseAt, flightStart, storyLength, shotFor, entryTime, P } from "./live-story.js";
import { makeSimClock, heroShot } from "./choreo.js";

export { headlineFor };
const MAX_QUEUE = 4;

function finalShot(points, wide) {
  const f = frameNear(points, 100, 20, wide);
  return { target: f.target, distance: Math.max(f.distance, 34000), headingDeg: 20, pitchDeg: 44 };
}

export function createLiveMode(ctx) {
  const { world, geo, ticker, chrome, data, camera } = ctx;
  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const panel = createLivePanel(ctx);
  let run = null;

  function buildQueue(first) {
    const worth = (l) => pathDuration(l.pts) >= 900 && l.pts.reduce((m, p) => Math.max(m, p[3] || 0), 0) >= 3000 && entryTime(toTrailPoints(geo, l.pts)) !== null;
    const more = ctx.legs.filter((l) => worth(l) && !(l.hex === first.hex && l.t0 === first.t0))
      .map((l) => ({ ...l, isNewJet: false, airframe: data.airframes.find((a) => a.hex === l.hex) || null }));
    return [first, ...more].slice(0, MAX_QUEUE);
  }

  function makeCycle(item, i, prevShot) {
    const path = trimToFlight(item.pts);
    const points = toTrailPoints(geo, path);
    const id = `replay:${item.hex || "x"}:${i}`;
    let jet = null, trail = null;
    try {
      jet = world?.addJet?.(id, item.program && item.program !== "unknown" ? item.program : "737");
      jet?.setHighlight?.("test");
      trail = world?.addTrail?.(id, points, { color: "#ff6a1a", glow: 1.2, width: 4 });
      trail?.setProgress?.(0);
    } catch (err) { console.warn(`[live] replay scene failed: ${err?.message || err}`); }
    const e0 = entryTime(points) ?? 0; // the film joins the flight where it enters the Sound
    const arrive = e0 > 120;
    const first = samplePathSmooth(path, e0);
    const intro = i === 0 && !reduce;
    const clock = makeSimClock(pathDuration(path) - e0, { chase: P.chase, run: P.run, reverse: arrive });
    return {
      item, path, jet, trail, intro, t: 0, dur: pathDuration(path), arrive,
      simAt: (local) => e0 + clock(local),
      final: finalShot(points, innerWidth >= 820),
      from: prevShot || heroShot(1),
      startJet: poseLocal(geo, first), startHeading: first.headingDeg,
      jetLen: jet?.dims?.length || 60,
      dispose() { trail?.dispose?.(); jet?.dispose?.(); },
    };
  }

  async function enter() {
    const my = { alive: true, offs: [] };
    run = my;
    let cur = heroShot(0), cyc = null, lastReadout = 0, idx = 0, queue = [];
    camera.drive(() => cur, { snap: true, rate: 4 });
    camera.setFraming(...(innerWidth >= 820 ? [-0.1, 0.05] : [0, 0.17]));
    my.offs.push(ticker.add((dt, nowMs) => {
      ctx.traffic?.frame(Date.now());
      if (cyc && !reduce) {
        cyc.t += dt;
        if (cyc.t >= storyLength(cyc.intro)) { idx++; start(idx); cyc.t = 0; }
        const ph = phaseAt(cyc.t, cyc.intro, cyc.arrive);
        const simT = cyc.simAt(Math.max(0, cyc.t - flightStart(cyc.intro)));
        const s = samplePathSmooth(cyc.path, simT);
        const pos = poseLocal(geo, s);
        cyc.jet?.setPose(pos, s.headingDeg, s.pitchDeg, 0);
        cyc.trail?.setProgress?.(arcFractionAt(cyc.path, simT));
        cyc.trail?.setOpacity?.(ph.name === "fade" ? 1 - ph.k : 1);
        cur = shotFor(ph, { ...cyc, jet: pos, heading: s.headingDeg, hero: heroShot });
        panel.setCompact(ph.name === "chase" || ph.name === "run");
        if (nowMs - lastReadout > 200) {
          lastReadout = nowMs;
          const flying = ph.name !== "hero" && ph.name !== "glide";
          panel.setReadout(flying ? `T+${fmtClock(simT)}  ·  ${fmtAlt(s.altFt)}  ·  ${Math.round(groundSpeedKt(cyc.path, simT))} kt` : "");
          if (Math.floor(nowMs / 1000) % 20 === 0) panel.refreshHeadline();
        }
      }
      camera.step(dt);
    }));
    const replay = await pickReplay({ airframes: data.airframes, legs: ctx.legs, loadMonth: ctx.loadMonth, monthOf: monthKey });
    if (!my.alive) return;
    if (!replay) panel.empty(); else panel.show(replay);
    const showTraffic = () => {
      if (!panel.traffic) return;
      const ac = ctx.live.ac;
      panel.traffic.textContent = ctx.live.status === "live" && ac.length ? trafficLine(ac.filter((a) => classify(a) === "test").length, ac.length) : "";
    };
    my.offs.push(ctx.live.subscribe((ac, at) => { ctx.traffic?.sync(ac, at); showTraffic(); }));
    if (ctx.live.ac.length) ctx.traffic?.sync(ctx.live.ac, ctx.live.fetchedAt);
    showTraffic();
    if (!replay) return;
    queue = buildQueue(replay);

    function start(i) {
      cyc?.dispose();
      cyc = makeCycle(queue[i % queue.length], i, i === 0 ? null : cur);
      if (i > 0) panel.show(cyc.item);
      showTraffic();
    }
    await ctx.whenReady; // the film starts once the plant has loaded, not on a half-built scene
    if (!my.alive) return;
    start(0);
    my.dispose = () => cyc?.dispose();
    if (reduce) { // no motion: the whole trail, framed in the region, jet at the end
      cyc.trail?.setProgress?.(1);
      const s = samplePathSmooth(cyc.path, cyc.dur);
      cyc.jet?.setPose(poseLocal(geo, s), s.headingDeg, 0, 0);
      cur = cyc.final;
      camera.drive(() => cur, { snap: true });
      return;
    }
  }

  function exit() {
    if (!run) return;
    run.alive = false;
    run.offs.forEach((f) => f());
    run.dispose?.();
    camera.release();
    ctx.traffic?.clear();
    chrome.stage.replaceChildren();
    run = null;
  }

  return { enter, exit };
}
