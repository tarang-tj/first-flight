// Birth certificate card. Everything shown comes from the airframe record; an
// airline is never named (only the ICAO-block country is shown).

import { h, clear } from "./dom.js";
import { routeText, airportName, fmtWhen, fmtDuration, fmtAlt, fmtDay } from "./format.js";

function row(label, value) {
  return h("div.row", {}, h("dt", { text: label }), h("dd", { text: value }));
}

/**
 * Only a counted airframe is a new build whose first flight we watched. Anything
 * else (warm-up history, flight-test fleet, airline jets) is just "first seen".
 */
export function recordKind(a) {
  if (a?.counted === true) return { isNew: true, title: "Birth certificate", note: null };
  if (a?.flightTest === true) return { isNew: false, title: "Aircraft record", note: "Boeing flight-test jet" };
  return { isNew: false, title: "Aircraft record", note: "First seen in our data, not confirmed as a new build" };
}

export function airframeRows(a) {
  const ff = a.firstFlight || {};
  const since = Math.max(0, (a.flights || 1) - 1);
  const isNew = recordKind(a).isNew;
  return [
    [isNew ? "Born at" : "First seen at", a.born ? `${airportName(a.born)} (${a.born})` : "Unknown"],
    [isNew ? "First flight" : "First seen in our data", fmtWhen(ff.t)],
    ["Route", routeText(ff.from, ff.to)],
    ["Flight time", fmtDuration(ff.durationS)],
    ["Highest point", fmtAlt(ff.maxAltFt)],
    ["Flights since", since === 0 ? "None seen yet" : `${since} seen`],
    ["Registered in", a.country || "Unknown"],
    ["Delivered", a.delivery ? `Yes, left on ${fmtDay(a.delivery.t)}` : "Not seen delivered yet"],
  ];
}

/**
 * @param {HTMLElement} host
 * @param {object} o
 * @param {object} o.airframe  record from airframes.json
 * @param {() => void} o.onRide
 * @param {() => void} o.onClose
 */
export function renderJetCard(host, { airframe: a, onRide, onClose }) {
  clear(host);
  const ff = a.firstFlight || {};
  const title = ff.callsign || a.reg || a.hex.toUpperCase();
  const kind = recordKind(a);
  const close = h("button.icon-btn", { type: "button", "aria-label": `Close ${kind.title.toLowerCase()}`, onclick: onClose }, "×");
  const ride = h("button.btn.primary", { type: "button", onclick: onRide }, "Ride along");
  const card = h("section.card", { role: "dialog", "aria-label": `${kind.title} for ${title}` },
    h("div.card-head", {},
      h("div", {},
        h("p.kicker", { text: `${kind.title} · ${a.program}` }),
        h("h2.card-title", { text: title })),
      close),
    h("p.card-sub", { text: [kind.note, a.reg, `ICAO ${a.hex.toUpperCase()}`].filter(Boolean).join(" · ") }),
    h("dl.rows", {}, airframeRows(a).map(([k, v]) => row(k, v))),
    h("div.card-actions", {}, ride));
  host.append(card);
  card.addEventListener("keydown", (e) => { if (e.key === "Escape") onClose(); });
  ride.focus({ preventScroll: true });
  return card;
}

/** Fallback for a live aircraft that is not in the airframe list: basics only. */
export function renderLiveCard(host, { ac, onClose }) {
  clear(host);
  const rows = [
    ["Callsign", (ac.flight || "").trim() || "none"],
    ["Registration", ac.r || "unknown"],
    ["Type", ac.t || "unknown"],
    ["Altitude", fmtAlt(Number(ac.alt_baro))],
    ["Speed", Number.isFinite(Number(ac.gs)) ? `${Math.round(Number(ac.gs))} kt` : "unknown"],
  ];
  const card = h("section.card", { role: "dialog", "aria-label": "Aircraft details" },
    h("div.card-head", {},
      h("div", {}, h("p.kicker", { text: "Live aircraft" }), h("h2.card-title", { text: (ac.flight || "").trim() || ac.hex.toUpperCase() })),
      h("button.icon-btn", { type: "button", "aria-label": "Close", onclick: onClose }, "×")),
    h("dl.rows", {}, rows.map(([k, v]) => row(k, v))));
  host.append(card);
  card.addEventListener("keydown", (e) => { if (e.key === "Escape") onClose(); });
}
