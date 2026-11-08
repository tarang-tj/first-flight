import test from "node:test";
import assert from "node:assert/strict";
import { mergeTrails, ribbonCorner, clipToNear } from "../web/world/trail-merge.js";

// Orthographic stand-in for the projection: pixel = (x, z).
const px = (p) => ({ x: p.x, y: p.z });
const pts = [[0, 0], [100, 20], [200, 80], [300, 90], [400, 60], [500, 0]].map(([x, z]) => ({ x, y: 0, z }));

function quadCorners(m, seg) {
  const out = [];
  for (let k = 0; k < 4; k++) {
    const v = seg * 4 + k, at = (arr) => px({ x: arr[v * 3], z: arr[v * 3 + 2] });
    out.push(ribbonCorner(at(m.position), at(m.other), m.end[v], m.side[v], 4));
  }
  return out; // [start-, start+, end-, end+]
}
const cross = (o, a, b) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

test("ribbon quads are not twisted: both + corners sit on the same bank of the segment", () => {
  const m = mergeTrails([{ points: pts, color: [1, 1, 1] }]);
  for (let s = 0; s < pts.length - 1; s++) {
    const [s0, s1, e0, e1] = quadCorners(m, s);
    const a = px(pts[s]), b = px(pts[s + 1]);
    assert.ok(cross(a, b, s1) * cross(a, b, e1) > 0, `segment ${s}: + corners straddle the centreline`);
    assert.ok(cross(a, b, s0) * cross(a, b, e0) > 0, `segment ${s}: - corners straddle the centreline`);
    assert.ok(cross(a, b, s1) * cross(a, b, s0) < 0, `segment ${s}: start edge has both banks`);
  }
});

test("consecutive segments keep the same bank (no sawtooth flip)", () => {
  const m = mergeTrails([{ points: pts, color: [1, 1, 1] }]);
  let prev = null;
  for (let s = 0; s < pts.length - 1; s++) {
    const [, s1] = quadCorners(m, s);
    const a = px(pts[s]), b = px(pts[s + 1]);
    const sign = Math.sign(cross(a, b, s1));
    if (prev !== null) assert.equal(sign, prev, `segment ${s} flipped bank`);
    prev = sign;
  }
});

test("near-plane clip keeps a segment that passes behind the camera finite and in front", () => {
  const out = clipToNear({ x: 4, y: 1, w: -3 }, { x: 8, y: 2, w: 10 });
  assert.ok(out && out.every((v) => Number.isFinite(v.x) && v.w >= 0.05 - 1e-9));
  assert.ok(Math.abs(out[0].w - 0.05) < 1e-9, "clipped end sits on the near plane");
  assert.equal(clipToNear({ x: 1, y: 1, w: -1 }, { x: 2, y: 2, w: -2 }), null, "fully behind: nothing to draw");
  const ok = clipToNear({ x: 1, y: 1, w: 2 }, { x: 2, y: 2, w: 5 });
  assert.deepEqual(ok, [{ x: 1, y: 1, w: 2 }, { x: 2, y: 2, w: 5 }]);
});
