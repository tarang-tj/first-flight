// Open-Meteo current conditions at Paine Field (no key). Polled at most every 15 min while visible.
// Any failure is a console.warn; the world keeps its last known (or default clear) weather.
import { ORIGIN } from "../geo.js";

const URL_ = `https://api.open-meteo.com/v1/forecast?latitude=${ORIGIN.lat}&longitude=${ORIGIN.lon}`
  + "&current=cloud_cover,visibility,precipitation&timezone=UTC";
const EVERY_MS = 15 * 60 * 1000;

/** Validate and clamp an Open-Meteo `current` block. Returns null if unusable. */
export function parseWeather(json) {
  const c = json && json.current;
  if (!c) return null;
  const cloudCover = Number(c.cloud_cover), visibilityM = Number(c.visibility), precip = Number(c.precipitation);
  if (!Number.isFinite(cloudCover)) return null;
  return {
    cloudCover: Math.min(100, Math.max(0, cloudCover)),
    visibilityM: Number.isFinite(visibilityM) && visibilityM > 0 ? Math.min(80000, visibilityM) : 40000,
    precip: Number.isFinite(precip) ? Math.max(0, precip) : 0,
  };
}

/** Starts polling; returns stop(). onWeather gets a parsed block. */
export function startWeather(onWeather) {
  let timer = null, stopped = false, last = 0;
  const poll = async () => {
    if (stopped) return;
    if (document.hidden) { timer = setTimeout(poll, 60000); return; }
    try {
      const res = await fetch(URL_, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const w = parseWeather(await res.json());
      if (!w) throw new Error("unexpected response");
      last = Date.now();
      onWeather(w);
    } catch (err) {
      console.warn("[world] weather unavailable:", err.message);
    }
    if (!stopped) timer = setTimeout(poll, Math.max(EVERY_MS - (Date.now() - last), 60000));
  };
  poll();
  return () => { stopped = true; clearTimeout(timer); };
}
