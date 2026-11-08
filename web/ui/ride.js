// Ride along: the camera rides behind a jet on its real first-flight path, jet centred, with a
// minimal HUD (altitude, ground speed from the recorded points, elapsed time), play/pause and
// 1x / 10x / 60x speed. The active mode is suspended while riding.

import { h, clear } from "./dom.js";
import { samplePathSmooth, groundSpeedKt, arcFractionAt, pathDuration, trimToFlight } from "../air/path-player.js";
import { toTrailPoints, poseLocal } from "../air/geo-bridge.js";
import { findTrail } from "../air/data.js";
import { monthKey, fmtClock } from "./format.js";

const SPEEDS = [1, 10, 60];

function hudCell(label, unit) {
  const val = h("span.val");
  const u = h("span.unit", { text: unit });
  return { val, unit: u, el: h("div.hud-cell", {}, h("span.lab", { text: label }), h("span", {}, val, u)) };
}

export function createRide(ctx) {
  const { world, geo, ticker, chrome, camera } = ctx;
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
    camera.release();
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
    const trail = world.addTrail?.(`ride:${airframe.hex}`, points, { color: "#ff6a1a", glow: 1.1, width: 4 });
    const chaseD = Math.min(700, Math.max(260, (jet.dims?.length || 60) * 6));
    let t = 0, speed = 10, playing = true, cur = null, lastHud = 0;

    const playBtn = h("button.btn", { type: "button", onclick: () => { playing = !playing; if (t >= dur) t = 0; sync(); } });
    const speedBtns = SPEEDS.map((s) => h("button.chip", { type: "button", "aria-pressed": String(s === speed), onclick: () => { speed = s; sync(); } }, `${s}x`));
    const alt = hudCell("ALT", "ft"), spd = hudCell("SPEED", "kt"), clock = hudCell("T+", "");
    const bar = h("section.ride-bar", { role: "group", "aria-label": "Ride along" },
      h("div.ride-row", {}, h("span.kicker", { text: `Riding ${airframe.firstFlight.callsign || airframe.reg || airframe.hex}` })),
      h("div.ride-hud", { role: "status", "aria-live": "off" }, alt.el, spd.el, clock.el),
      h("div.ride-row", {}, playBtn, h("div.chips", {}, speedBtns), h("span.spacer"), h("button.btn", { type: "button", onclick: () => stop() }, "Exit ride")));
    chrome.rideHost.append(bar);

    function sync() {
      playBtn.textContent = playing ? "Pause" : t >= dur ? "Again" : "Play";
      speedBtns.forEach((b, i) => b.setAttribute("aria-pressed", String(SPEEDS[i] === speed)));
    }
    sync();

    camera.drive(() => cur, { snap: true, rate: 2.6 });
    camera.setFraming(...(innerWidth >= 820 ? [0, 0.08] : [0, 0.2]));
    const off = ticker.add((dt, nowMs) => {
      if (playing) { t += dt * speed; if (t >= dur) { t = dur; playing = false; sync(); } }
      const s = samplePathSmooth(pts, t);
      if (!s) return;
      const p = poseLocal(geo, s);
      jet.setPose(p, s.headingDeg, s.pitchDeg, 0);
      trail?.setProgress?.(arcFractionAt(pts, t));
      cur = { target: p, distance: chaseD, headingDeg: s.headingDeg + 16, pitchDeg: 13 };
      camera.step(dt);
      if (nowMs - lastHud > 120) {
        lastHud = nowMs;
        alt.val.textContent = Math.round(Math.max(0, s.altFt)).toLocaleString("en-US");
        spd.val.textContent = String(Math.round(groundSpeedKt(pts, t)));
        clock.val.textContent = fmtClock(t);
        clock.unit.textContent = `/ ${fmtClock(dur)}`;
      }
    });
    active = { off, trail, jet, bar };
  }

  return { start, stop, get active() { return !!active; } };
}
