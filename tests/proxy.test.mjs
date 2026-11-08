import { test } from "node:test";
import assert from "node:assert/strict";
import handler, { allowOrigin, AREAS } from "../proxy/api/air.js";

const realFetch = globalThis.fetch;
function stubFetch(status, body) {
  const calls = [];
  globalThis.fetch = async (u) => { calls.push(String(u)); return new Response(body, { status }); };
  return calls;
}
test.afterEach(() => { globalThis.fetch = realFetch; });

test("only the named areas reach upstream, with CDN caching", async () => {
  const calls = stubFetch(200, '{"ac":[]}');
  const res = await handler(new Request("https://x.vercel.app/api/air?area=paine", { headers: { origin: "https://tarang-tj.github.io" } }));
  assert.equal(res.status, 200);
  assert.equal(calls[0], `https://api.adsb.lol/v2/point/${AREAS.paine.join("/")}`);
  assert.equal(res.headers.get("access-control-allow-origin"), "https://tarang-tj.github.io");
  assert.match(res.headers.get("cache-control"), /s-maxage=5/);
  assert.equal(await res.text(), '{"ac":[]}');
});

test("unknown areas are refused without an upstream call", async () => {
  const calls = stubFetch(200, "{}");
  const res = await handler(new Request("https://x.vercel.app/api/air?area=../../v2/all"));
  assert.equal(res.status, 400);
  assert.equal(calls.length, 0);
});

test("inherited object keys are not areas", async () => {
  const calls = stubFetch(200, "{}");
  for (const key of ["constructor", "__proto__", "toString", "hasOwnProperty"]) {
    const res = await handler(new Request(`https://x.vercel.app/api/air?area=${key}`));
    assert.equal(res.status, 400, key);
  }
  assert.equal(calls.length, 0);
});

test("other origins get no CORS grant; upstream errors are not cached", async () => {
  stubFetch(429, "slow down");
  const res = await handler(new Request("https://x.vercel.app/api/air", { headers: { origin: "https://evil.example" } }));
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("access-control-allow-origin"), null);
  assert.equal(res.headers.get("cache-control"), "no-store");
});

test("origin allowlist accepts local dev ports and rejects lookalikes", () => {
  assert.equal(allowOrigin("http://127.0.0.1:5173"), "http://127.0.0.1:5173");
  assert.equal(allowOrigin("https://tarang-tj.github.io.evil.com"), null);
  assert.equal(allowOrigin(null), null);
});
