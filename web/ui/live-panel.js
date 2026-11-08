// Live mode card: headline, facts, actions, the running readout, and the newest-jets list.

import { h, clear } from "./dom.js";
import { routeText, relativeAgo, fmtDuration, fmtAlt } from "./format.js";
import { pathDuration, maxAltFt } from "../air/path-player.js";
import { newestJets } from "../air/data.js";
import { recordKind } from "./jet-card.js";
import { isBoeCallsign } from "../air/classify.js";

export function headlineFor(replay, nowMs) {
  const what = replay.isNewJet ? "Latest new Boeing" : isBoeCallsign(replay.callsign) ? "Latest Boeing test flight" : "Latest production or test flight";
  const id = replay.callsign || (replay.hex || "").toUpperCase();
  return `${what}: ${id}, ${routeText(replay.from, replay.to)}, ${relativeAgo(nowMs, replay.t0 + pathDuration(replay.pts))}`;
}

export function trafficLine(test, total) {
  return `On the radar now: ${test} Boeing production or test ${test === 1 ? "flight" : "flights"}, ${total - test} other aircraft.`;
}

export function createLivePanel(ctx) {
  const host = ctx.chrome.stage;
  const { data } = ctx;
  let ui = {};

  function empty() {
    clear(host);
    host.append(h("section.panel.hero", {},
      h("p.kicker", { text: "Waiting for data" }),
      h("h1.headline", { text: "No recorded flights loaded yet" }),
      h("p.lede", { text: "The flight data files are not available, so there is nothing to replay. The 3D world is still live to explore." })));
    ui = {};
  }

  function show(replay) {
    clear(host);
    const headline = h("h1.headline", { text: headlineFor(replay, Date.now()) });
    const traffic = h("p.traffic.mono", { "aria-live": "off" });
    const readout = h("p.readout.mono", { "aria-hidden": "true" });
    const facts = [
      replay.program && replay.program !== "unknown" && `${replay.program}`,
      fmtDuration(pathDuration(replay.pts)),
      `up to ${fmtAlt(maxAltFt(replay.pts))}`,
    ].filter(Boolean).join("  ·  ");
    const actions = h("div.actions", {},
      replay.airframe && h("button.btn.primary", { type: "button", onclick: () => ctx.rideAirframe(replay.airframe) }, "Ride along"),
      replay.airframe && h("button.btn", { type: "button", onclick: () => ctx.openAirframe(replay.airframe.hex) }, replay.airframe ? recordKind(replay.airframe).title : ""));
    const counted = data.airframes.filter((a) => a.counted === true);
    const listTitle = counted.length ? "Newest jets" : "Recently seen in our data";
    const rows = newestJets(counted.length ? counted : data.airframes, 5).map((a) =>
      h("li", {}, h("button.row-btn", { type: "button", onclick: () => ctx.openAirframe(a.hex) },
        h("span.mono.cs", { text: a.firstFlight.callsign || a.reg || a.hex }),
        h("span.prog", { text: a.program === "unknown" ? "type n/a" : a.program }),
        h("span.ago", { text: `${counted.length ? "" : "first seen "}${relativeAgo(Date.now(), a.firstFlight.t)}` }))));
    const root = h("section.panel.hero", {},
      h("p.kicker", { text: replay.isNewJet ? "New jet, first flight, replayed" : isBoeCallsign(replay.callsign) ? "Boeing test flight, replayed" : "Production or test flight, replayed" }),
      headline, h("p.facts.mono", { text: facts }), readout, actions, traffic,
      rows.length ? h("details.newest-wrap", {}, h("summary", { text: listTitle }), h("ul.newest", { "aria-label": listTitle }, rows)) : null);
    host.append(root);
    ui = { root, headline, traffic, readout, replay };
  }

  return {
    empty, show,
    get traffic() { return ui.traffic; },
    refreshHeadline() { if (ui.headline && ui.replay) ui.headline.textContent = headlineFor(ui.replay, Date.now()); },
    setCompact(on) { ui.root?.classList.toggle("is-compact", on); },
    setReadout(text) { if (ui.readout && ui.readout.textContent !== text) ui.readout.textContent = text; },
  };
}
