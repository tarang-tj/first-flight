// Page chrome: brand, mode tabs, data-age badge, panel hosts, credits.

import { h } from "./dom.js";

export const MODES = [
  { key: "explore", label: "Explore", hint: "Fly anywhere, any moment since Jan 2025" },
  { key: "live", label: "Live", hint: "Latest Boeing flights" },
  { key: "year", label: "A Year in Light", hint: "Every first flight since Jan 2025" },
  { key: "ledger", label: "Ledger", hint: "Sky count vs Boeing's numbers" },
];

const BOE_TIP = "Boeing flight-test and delivery flights file with a callsign that starts with BOE, such as BOE603. That is how a new jet shows up in public air-traffic data.";

export function createChrome(root, { onMode }) {
  const tabs = MODES.map((m) =>
    h("button.tab", { type: "button", role: "tab", id: `tab-${m.key}`, "data-mode": m.key, "aria-selected": "false", "aria-controls": "stage", tabindex: "-1", title: m.hint, onclick: () => onMode(m.key) },
      h("span", { text: m.label })));
  const tablist = h("nav.modes", { role: "tablist", "aria-label": "View" }, tabs);
  tablist.addEventListener("keydown", (e) => {
    const i = tabs.findIndex((t) => t.dataset.mode === chrome.mode);
    const d = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const next = tabs[(i + d + tabs.length) % tabs.length];
    next.focus();
    onMode(next.dataset.mode);
  });

  const badgeDot = h("span.dot", { "aria-hidden": "true" });
  const badgeText = h("span.badge-text", { text: "loading" });
  const badge = h("div.badge.is-offline", { role: "status", "aria-live": "polite" }, badgeDot, badgeText);

  const stage = h("main#stage.stage", { role: "tabpanel", tabindex: "-1" });
  const cardHost = h("div#card-host.card-host");
  const rideHost = h("div#ride-host.ride-host");
  const credits = h("footer.credits", {},
    h("span", {}, "Flights: "), h("a", { href: "https://adsb.lol", target: "_blank", rel: "noopener" }, "adsb.lol"), h("span", {}, " (ODbL). Deliveries: "),
    h("a", { href: "https://www.boeing.com/commercial/#/orders-deliveries", target: "_blank", rel: "noopener" }, "Boeing"),
    h("span", {}, ". Not affiliated with Boeing. "),
    h("span.tip", { tabindex: "0", role: "note", "data-tip": BOE_TIP, "aria-label": `What is a BOE callsign? ${BOE_TIP}` }, "What is a BOE callsign?"));

  root.append(
    h("header.topbar", {},
      h("div.brand", {}, h("span.brand-name", { text: "FIRST FLIGHT" }), h("span.brand-sub", { text: "Boeing, over Puget Sound" })),
      badge),
    tablist, stage, cardHost, rideHost, credits);

  const chrome = {
    mode: null, stage, cardHost, rideHost,
    setMode(key) {
      chrome.mode = key;
      for (const t of tabs) {
        const on = t.dataset.mode === key;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
      }
      stage.setAttribute("aria-labelledby", `tab-${key}`);
      document.body.dataset.mode = key;
    },
    /** kind: "live" | "stale" | "offline" */
    setBadge(kind, text) {
      badge.className = `badge is-${kind}`;
      if (badgeText.textContent !== text) badgeText.textContent = text;
    },
  };
  return chrome;
}
