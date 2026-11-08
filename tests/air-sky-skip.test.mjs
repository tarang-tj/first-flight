import { test } from "node:test";
import assert from "node:assert/strict";
import { createSkyFeed } from "../web/air/sky-feed.js";

// Takeoff at Paine Field vs one near Moses Lake (300 km away), both in Nov 2026 (Pacific).
const T = 1_794_000_000;
const flight = (id, t0, lat, lon) => ({ id, hex: id, t0, t1: t0 + 600, pts: [[0, lat, lon, 0], [600, lat + 0.1, lon, 9000]] });
const months = { "2026-11": [flight("far", T + 100, 47.2, -119.3), flight("near", T + 5000, 47.9, -122.28)] };
const index = { months: [{ key: "2026-10" }, { key: "2026-11" }], span: [T - 9e6, T + 9e5], moments: [] };
const load = async (u) => (u.endsWith("index.json") ? index : months[u.match(/(\d{4}-\d{2})\.json$/)[1]] || []);

test("quiet-hour skip finds the next takeoff near Puget Sound, not a far one", async () => {
  const feed = createSkyFeed({ load });
  await feed.loadIndex();
  await feed.ensure(T);
  assert.equal(feed.nextNearTakeoff(T), T + 5000);
  assert.equal(feed.nextNearTakeoff(T + 6000), null);
});
