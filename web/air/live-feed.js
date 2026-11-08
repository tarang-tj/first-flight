// Live traffic poller. Polls the cache proxy every 5 s; any non-200, network
// error or malformed body starts a 60 s backoff. No proxy configured means
// "offline" with zero network calls. Never throws; failures log console.warn.

export const POLL_MS = 5000;
export const BACKOFF_MS = 60000;
export const STALE_AFTER_MS = 60000;
const FETCH_TIMEOUT_MS = 8000;

function toMs(now) {
  if (!Number.isFinite(now)) return null;
  return now > 1e12 ? now : now * 1000; // adsb.lol reports ms; tolerate seconds
}

/**
 * @param {object} o
 * @param {string|null} o.proxy  base URL of the proxy, or null
 * @param {(ac: object[], meta: {fetchedAt: number, ageMs: number}) => void} o.onUpdate
 * @param {(s: "live"|"offline"|"stale") => void} o.onStatus
 * @returns {{stop: () => void}}
 */
export function startLive({
  proxy, onUpdate, onStatus, area = "sound",
  fetchImpl = globalThis.fetch?.bind(globalThis),
  schedule = (fn, ms) => setTimeout(fn, ms),
  cancel = (id) => clearTimeout(id),
  now = () => Date.now(),
  hidden = () => globalThis.document?.hidden === true,
}) {
  let stopped = false;
  let timer = null;
  let hadSuccess = false;
  let last = null;
  const emit = (s) => { if (s !== last) { last = s; onStatus?.(s); } };

  if (!proxy || !fetchImpl) {
    emit("offline");
    return { stop() {} };
  }
  const url = `${String(proxy).replace(/\/+$/, "")}/api/air?area=${encodeURIComponent(area)}`;

  async function poll() {
    if (stopped) return;
    if (hidden()) { timer = schedule(poll, POLL_MS); return; }
    let delay = POLL_MS;
    try {
      const signal = typeof AbortSignal?.timeout === "function" ? AbortSignal.timeout(FETCH_TIMEOUT_MS) : undefined;
      const res = await fetchImpl(url, { signal, cache: "no-store" });
      if (res.status !== 200) throw new Error(`proxy HTTP ${res.status}`);
      const body = await res.json();
      if (!body || !Array.isArray(body.ac)) throw new Error("proxy returned no aircraft list");
      if (stopped) return;
      const at = now();
      const feedAt = toMs(body.now);
      const ageMs = feedAt === null ? 0 : Math.max(0, at - feedAt);
      hadSuccess = true;
      emit(ageMs > STALE_AFTER_MS ? "stale" : "live");
      onUpdate?.(body.ac, { fetchedAt: at, ageMs });
    } catch (err) {
      delay = BACKOFF_MS;
      console.warn(`[live] feed failed, retrying in 60 s: ${err?.message || err}`);
      emit(hadSuccess ? "stale" : "offline");
    }
    if (!stopped) timer = schedule(poll, delay);
  }

  poll();
  return { stop() { stopped = true; if (timer !== null) cancel(timer); } };
}
