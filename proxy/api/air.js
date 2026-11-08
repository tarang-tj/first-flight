// Cache proxy for the adsb.lol live API, which sends no CORS header.
// Not an open proxy: only named areas are allowed, and the CDN caches each
// for 5 s, so every visitor shares one upstream request per area per 5 s.
// Data: adsb.lol, ODbL 1.0.
export const config = { runtime: "edge" };

export const AREAS = {
  paine: [47.9063, -122.2816, 25], // Paine Field, Everett (radius in nm)
  sound: [47.70, -122.25, 60],     // Puget Sound: Everett, Renton, Boeing Field
  moses: [47.2077, -119.32, 40],   // Moses Lake flight test center
};
export const ALLOWED_ORIGINS = [
  "https://tarang-tj.github.io",
  "http://127.0.0.1",
  "http://localhost",
];

export function allowOrigin(origin) {
  if (!origin) return null;
  return ALLOWED_ORIGINS.some((o) => origin === o || origin.startsWith(o + ":")) ? origin : null;
}

export default async function handler(req) {
  const url = new URL(req.url);
  const key = url.searchParams.get("area") || "sound";
  const area = Object.hasOwn(AREAS, key) ? AREAS[key] : null;
  const origin = allowOrigin(req.headers.get("origin"));
  const cors = origin ? { "access-control-allow-origin": origin, vary: "origin" } : { vary: "origin" };
  if (!area) return new Response(JSON.stringify({ error: "unknown area" }), { status: 400, headers: { ...cors, "content-type": "application/json" } });
  const [lat, lon, nm] = area;
  try {
    const up = await fetch(`https://api.adsb.lol/v2/point/${lat}/${lon}/${nm}`, {
      headers: { "user-agent": "first-flight (github.com/tarang-tj/first-flight)" },
      signal: AbortSignal.timeout(8000),
    });
    const body = await up.text();
    return new Response(body, {
      status: up.status,
      headers: {
        ...cors,
        "content-type": "application/json",
        "cache-control": up.ok ? "public, s-maxage=5, stale-while-revalidate=10" : "no-store",
      },
    });
  } catch {
    return new Response(JSON.stringify({ error: "upstream unavailable" }), { status: 502, headers: { ...cors, "content-type": "application/json", "cache-control": "no-store" } });
  }
}
