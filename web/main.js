// FIRST FLIGHT: boot and wiring. Must come up with no data files and no 3D world:
// each missing piece shows an honest empty state instead of throwing.

import { PROXY } from "./config.js";
import { createChrome } from "./ui/chrome.js";
import { createExploreMode } from "./ui/explore-mode.js";
import { createLiveMode } from "./ui/live-mode.js";
import { createYearMode } from "./ui/year-mode.js";
import { createLedgerMode } from "./ui/ledger-mode.js";
import { createRide } from "./ui/ride.js";
import { renderJetCard, renderLiveCard } from "./ui/jet-card.js";
import { clear, h } from "./ui/dom.js";
import { hexOfPickId } from "./ui/format.js";
import { createTicker } from "./air/ticker.js";
import { loadLedger, loadLatest, loadAirframes, loadTrailMonth, normalizeLegs } from "./air/data.js";
import { loadGeo } from "./air/geo-bridge.js";
import { startLive } from "./air/live-feed.js";
import { createLiveTraffic } from "./air/live-traffic.js";
import { createLiveState } from "./ui/live-state.js";
import { loadWorld } from "./ui/world-loader.js";
import { createCamera } from "./ui/camera.js";
import { createLabels } from "./ui/labels.js";
import { createLoading } from "./ui/loading.js";

const KEYS = ["explore", "live", "year", "ledger"];
const params = new URLSearchParams(location.search);
const startMode = KEYS.includes(params.get("mode")) ? params.get("mode") : "explore";

const ff = { ready: false, mode: null, world: null, ledgerLoaded: false, error: null, setMode: () => {}, litFraction: () => 0 };
window.__ff = ff;
ff.litFraction = () => (typeof ff.world?.litFraction === "function" ? ff.world.litFraction() : 0);

async function boot() {
  const canvas = document.getElementById("scene");
  const root = document.getElementById("ui-root");
  let ctx;
  const chrome = createChrome(root, { onMode: (k) => ff.setMode(k) });
  chrome.stage.append(h("p.lede.boot", { text: "Loading the sky over Puget Sound…" }));
  const loading = createLoading(root);
  loading.stage(0.08, "Loading flights and the 3D world");

  const [ledger, airframes, latest, geo, worldRes] = await Promise.all([
    loadLedger(), loadAirframes(), loadLatest(), loadGeo(), loadWorld(canvas),
  ]);
  const world = worldRes.world;
  loading.stage(0.4, "Building Puget Sound");
  worldRes.ready.then(() => loading.stage(0.7, "Streaming terrain and imagery"));
  Promise.race([world?.imageryReady, new Promise((r) => setTimeout(r, 90000))]).catch(() => {}).then(() => loading.done());
  ff.world = world;
  ff.ledgerLoaded = Array.isArray(ledger?.months) && ledger.months.length > 0;
  if (worldRes.error) {
    ff.error = worldRes.error;
    root.append(h("p.world-error", { role: "alert", text: `The 3D view could not start (${worldRes.error}). Charts and data still work.` }));
  }
  const sunAt = params.get("sun") ? new Date(params.get("sun")) : new Date(); // ?sun=ISO pins the light for screenshots
  try { world?.setSun?.(Number.isNaN(sunAt.getTime()) ? new Date() : sunAt); } catch (e) { console.warn(`[world] setSun failed: ${e?.message || e}`); }

  const ticker = createTicker(world);
  const camera = createCamera(world);
  if (world && geo) createLabels({ root, world, geo, ticker });
  const live = createLiveState(chrome.setBadge);
  const modes = {};
  ctx = {
    world, geo, ticker, chrome, live, camera, whenReady: worldRes.ready, loadMonth: loadTrailMonth,
    data: { ledger, airframes, legs: normalizeLegs(latest) },
    traffic: world ? createLiveTraffic(world, geo) : null,
    ledgerLoaded: (v) => { ff.ledgerLoaded = !!v; },
    rideActive: () => ride.active,
    suspendMode: () => modes[ff.mode]?.exit(),
    resumeMode: () => modes[ff.mode]?.enter(),
    openAirframe, rideAirframe,
  };
  ctx.legs = ctx.data.legs;
  const ride = createRide(ctx);
  modes.explore = createExploreMode(ctx);
  ff.sky = { activeCount: () => modes.explore.activeCount() };
  modes.live = createLiveMode(ctx);
  modes.year = createYearMode(ctx);
  modes.ledger = createLedgerMode(ctx);

  function closeCard() { clear(chrome.cardHost); }
  function openAirframe(hex) {
    const a = airframes.find((x) => x.hex === hex);
    if (!a) return false;
    renderJetCard(chrome.cardHost, { airframe: a, onClose: closeCard, onRide: () => rideAirframe(a) });
    return true;
  }
  function rideAirframe(a) {
    closeCard();
    ride.start(a, (msg) => {
      openAirframe(a.hex);
      chrome.cardHost.querySelector(".card")?.append(h("p.note", { role: "status", text: msg }));
    });
  }

  ff.setMode = (key) => {
    if (!KEYS.includes(key)) { console.warn(`[main] unknown mode ${key}`); return; }
    if (key === ff.mode && !ride.active) return;
    ride.stop(true);
    closeCard();
    if (ff.mode) modes[ff.mode].exit();
    clear(chrome.stage);
    ff.mode = key;
    chrome.setMode(key);
    const url = new URL(location.href);
    url.searchParams.set("mode", key);
    history.replaceState(null, "", url);
    Promise.resolve(modes[key].enter()).catch((err) => console.warn(`[main] ${key} mode failed: ${err?.message || err}`));
  };

  // Tap or click a jet: pick it in the 3D world (ignore drags).
  let down = null;
  canvas.addEventListener("pointerdown", (e) => { down = [e.clientX, e.clientY]; });
  canvas.addEventListener("pointerup", (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    let id = null;
    try { id = world?.pick?.(e.clientX, e.clientY) ?? null; } catch (err) { console.warn(`[main] pick failed: ${err?.message || err}`); }
    if (!id) return closeCard();
    const hex = hexOfPickId(id);
    if (openAirframe(hex)) return;
    const ac = ctx.traffic?.aircraft(hex);
    if (ac) { clear(chrome.cardHost); renderLiveCard(chrome.cardHost, { ac, onClose: closeCard }); }
  });
  // Hover: a pointer cursor over a pickable jet (mouse only; throttled to one pick per frame).
  let hoverQueued = false;
  canvas.addEventListener("pointermove", (e) => {
    if (e.pointerType !== "mouse" || e.buttons || hoverQueued || !world?.pick) return;
    hoverQueued = true;
    requestAnimationFrame(() => {
      hoverQueued = false;
      try { canvas.classList.toggle("is-pickable", !!world.pick(e.clientX, e.clientY)); } catch { canvas.classList.remove("is-pickable"); }
    });
  });
  addEventListener("keydown", (e) => { if (e.key === "Escape") closeCard(); });

  startLive({ proxy: PROXY, onUpdate: live.onUpdate, onStatus: live.onStatus });
  ff.setMode(startMode);
  await worldRes.ready;
  ff.ready = true;
}

boot().catch((err) => {
  ff.error = String(err?.message || err);
  console.warn(`[main] boot failed: ${ff.error}`);
  document.getElementById("ui-root")?.append(h("p.world-error", { role: "alert", text: `Something failed to start (${ff.error}). Reload to try again.` }));
  ff.ready = true;
});
