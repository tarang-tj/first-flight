// The Ledger: can you see Boeing's production rate from the sky?

import { h, clear } from "./dom.js";
import { buildSeries, summarize, gapSentence, EXPLAINER, coverageLine, unknownSeen, unknownLine, warmupLine } from "./ledger-model.js";
import { ledgerChart } from "./ledger-chart.js";
import { monthLabel } from "./format.js";

export function createLedgerMode(ctx) {
  const { chrome, data, world } = ctx;

  function section(ledger, program, unknown) {
    const series = buildSeries(ledger, program);
    const sum = summarize(series);
    const label = `${program}: first flights seen by month against Boeing reported deliveries. ${gapSentence(program, sum, unknown ?? 0)}`;
    const { chart, table } = ledgerChart(program, series, label);
    const hasReported = series.some((r) => r.reported !== null);
    const sources = [...new Map(series.filter((r) => r.source).map((r) => [r.source, r])).keys()];
    return h("article.ledger-card", {},
      h("h2.ledger-prog", {}, h("span", { text: program }), h("span.mono.tally", {}, hasReported && sum.ratio !== null ? h("strong.ratio", { text: `${Math.round(sum.ratio * 100)}%` }) : null, hasReported ? ` ${sum.seen} seen / ${sum.reported} reported` : `${sum.seen} seen`)),
      h("p.gap", { text: gapSentence(program, sum, unknown ?? 0) }),
      chart,
      h("details.numbers", {}, h("summary", { text: "Show the numbers" }), table),
      sources.length ? h("p.fine", {}, "Sources: ", ...sources.flatMap((s, i) => [i ? ", " : "", h("a", { href: s, target: "_blank", rel: "noopener" }, new URL(s).hostname)])) : null);
  }

  function enter() {
    const host = chrome.stage;
    clear(host);
    ctx.camera.setFraming(0, 0);
    try { world?.setView?.("region"); } catch (e) { console.warn(`[ledger] camera: ${e?.message || e}`); }
    const ledger = data.ledger;
    const head = h("header.ledger-head", {},
      h("p.kicker", { text: "The Ledger" }),
      h("h1.headline", { text: "Can you see Boeing's production rate from the sky?" }));
    if (!ledger || !Array.isArray(ledger.months) || ledger.months.length === 0) {
      host.append(h("section.panel.ledger", {}, head, h("p.lede", { text: "The ledger data is not available yet, so there is nothing to compare. Nothing here is estimated or filled in." })));
      return;
    }
    ctx.ledgerLoaded(true);
    const programs = ledger.programs || ["737", "767", "777"];
    const unknown = unknownSeen(ledger);
    const first = ledger.months[0].month, last = ledger.months.at(-1).month;
    host.append(h("section.panel.ledger", {}, head,
      h("p.lede", { text: `Orange bars are new jets whose first flight we saw from the sky, by month, ${first === last ? monthLabel(first) : `${monthLabel(first)} to ${monthLabel(last)}`}. White dots are what Boeing says it delivered. ${warmupLine(ledger)}` }),
      unknown === null ? null : h("p.fine.unknown-line", { text: unknownLine(unknown) }),
      h("p.explainer", { text: EXPLAINER }),
      h("div.legend", { "aria-hidden": "true" }, h("span.key.bar-key", { text: "First flights seen" }), h("span.key.dot-key", { text: "Boeing reported deliveries" }), h("span.key.warm-key", { text: "Warm-up, not counted" })),
      h("div.ledger-grid", {}, programs.map((p) => section(ledger, p, unknown))),
      h("div.caveats", {}, h("h2.mini", { text: "What this does not show" }),
        h("p", { text: coverageLine(ledger) }),
        h("ul", {}, (ledger.notes || []).map((n) => h("li", { text: n }))),
        h("p.fine", { text: "The 787 is not tracked here. Aircraft flown without a transponder, or outside receiver range, are missed." }),
        h("p.fine", {}, "Flight data: ", h("a", { href: "https://adsb.lol", target: "_blank", rel: "noopener" }, "adsb.lol"), " (ODbL). Deliveries: Boeing's published orders and deliveries. Not affiliated with Boeing."))));
  }

  function exit() { clear(chrome.stage); }
  return { enter, exit };
}
