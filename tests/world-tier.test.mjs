import test from "node:test";
import assert from "node:assert/strict";
import { pickTier, TIER_SETTINGS } from "../web/world/tier.js";
import { ringsFor } from "../web/world/terrain-rings.js";

test("tier: phones and low-memory devices get lite, desktops full", () => {
  assert.equal(pickTier({ coarse: false, width: 1440 }), "full");
  assert.equal(pickTier({ coarse: true, width: 1440 }), "lite");
  assert.equal(pickTier({ coarse: false, width: 390 }), "lite");
  assert.equal(pickTier({ coarse: false, width: 1440, deviceMemory: 4 }), "lite");
  assert.equal(pickTier({ coarse: false, width: 1440, deviceMemory: 8 }), "full");
  assert.equal(pickTier({}), "full");
});

test("tier: lite caps DPR at 1.5 and uses a third of the texture memory", () => {
  assert.equal(TIER_SETTINGS.lite.dprCap, 1.5);
  assert.equal(TIER_SETTINGS.full.dprCap, 2);
  const px = (t) => ringsFor(t).reduce((s, r) => s + (r.block.n * 256) ** 2, 0);
  assert.ok(px("lite") < px("full") * 0.45, `${px("lite")} vs ${px("full")}`);
  assert.ok(ringsFor("lite").length < ringsFor("full").length);
  assert.equal(ringsFor("lite").at(-1).name, "core");
});
