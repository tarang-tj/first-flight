// Ride along: chase camera on a jet's real first-flight path, with play/pause
// and 1x / 10x / 60x speed. The active mode is suspended while riding.

import { h, clear } from "./dom.js";
import { samplePath, pathDuration, trimToFlight } from "../air/path-player.js";
import { toTrailPoints, poseLocal } from "../air/geo-bridge.js";
import { findTrail } from "../air/data.js";
import { monthKey, fmtDuration } from "./format.js";

const SPEEDS = [1, 10, 60];

export function createRide(ctx) {
  const { world, geo, ticker, chrome } = ctx;
  let active = null;

  async function pathFor(a) {
    const leg = ctx.legs?.find((l) => l.hex === a.hex && Math.abs(l.t0 - a.firstFlight.t) < 6 * 3600);
    if (leg) return leg.pts;
    const tr = await findTrail(a, ctx.loadMonth, monthKey);
    return tr ? tr.pts : null;
  }

  function stop(quiet = false) {
    if (!active) return;
    const s = active; active = null;
    s.off(); s.trail?.dispose?.(); s.jet?.dispose?.();
    try { world?.chase?.(null); } catch (e) { console.warn(`[ride] ${e?.message || e}`); }
    clear(s.bar); s.bar.remove();
    if (!quiet) ctx.resumeMode?.();
  }

  async function start(airframe, onMissing) {
    stop(true);
    const raw = await pathFor(airframe);
    const pts = raw ? trimToFlight(raw) : null;
    if (!pts || !world?.addJet) { onMissing?.(!pts ? "No recorded path for this jet." : "The 3D view is not available."); return; }
    ctx.suspendMode?.();
    const dur = pathDuration(pts);
    const points = toTrailPoints(geo, pts);
    const jet = world.addJet(`ride:${airframe.hex}`, airframe.program);
    jet.setHighlight?.("selected");
    const trail = world.addTrail?.(`ride:${airframe.hex}`, points, { color: "#ff6a1a", glow: 1 });
    let t = 0, speed = 10, playing = true;

    const playBtn = h("button.btn", { type: "button", "aria-label": "Pause", onclick: () => { playing = !playing; if (t >= dur) t = 0; sync(); } });
    const speedBtns = SPEEDS.map((s) => h("button.chip", { type: "button", "aria-pressed": String(s === speed), onclick: () => { speed = s; sync(); } }, `${s}x`));
    const clock = h("span.mono.ride-clock", { "aria-live": "off" });
    const bar = h("section.ride-bar", { role: "group", "aria-label": "Ride along controls" },
      h("span.kicker", { text: `Riding ${airframe.firstFlight.callsign || airframe.reg || airframe.hex}` }),
      playBtn, h("div.chips", {}, speedBtns), clock,
      h("button.btn", { type: "button", onclick: () => stop() }, "Exit"));
    chrome.rideHost.append(bar);

    function sync() {
      playBtn.textContent = playing ? "Pause" : "Play";
      playBtn.setAttribute("aria-label", playing ? "Pause" : "Play");
      speedBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(SPEEDS[i] === speed)));
    }
    sync();

    const off = ticker.add((dt) => {
      if (playing) { t += dt * speed; if (t >= dur) { t = dur; playing = false; sync(); } }
      const s = samplePath(pts, t);
      if (!s) return;
      const p = poseLocal(geo, s);
      jet.setPose(p, s.headingDeg, s.pitchDeg, 0);
      trail?.setProgress?.(dur > 0 ? t / dur : 1);
      clock.textContent = `${fmtDuration(t)} of ${fmtDuration(dur)} · ${Math.round(s.altFt).toLocaleString("en-US")} ft`;
    });
    active = { off, trail, jet, bar };
    try { world.chase?.(jet); } catch (e) { console.warn(`[ride] chase failed: ${e?.message || e}`); }
  }

  return { start, stop, get active() { return !!active; } };
}
