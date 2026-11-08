// Procedural airliner geometry at true dimensions (JET_DIMS). Origin = fuselage centre, nose toward -z
// (north when heading is 0), right wing toward +x, up = +y. One merged BufferGeometry per variant
// (body) plus separate fold-tip geometries for the 777-9. White/neutral only: no liveries, no logos.
import * as THREE from "three";
import { JET_DIMS } from "./jet-dims.js";

/** Merge geometries (made non-indexed) with a flat per-part vertex colour. parts: [{geo, shade}] */
function mergeParts(parts) {
  const pos = [], nrm = [], col = [];
  for (const { geo, shade } of parts) {
    const g = geo.index ? geo.toNonIndexed() : geo;
    g.computeVertexNormals();
    const p = g.getAttribute("position"), n = g.getAttribute("normal");
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i)); nrm.push(n.getX(i), n.getY(i), n.getZ(i)); col.push(shade, shade, shade);
    }
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  out.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return out;
}

/** Thin swept panel from 4 corners (LE root, TE root, TE tip, LE tip), given thickness t. */
function panel(a, b, c, d, t) {
  const v = [a, b, c, d];
  const verts = [], idx = [];
  for (const s of [t / 2, -t / 2]) v.forEach((p) => verts.push(p[0], p[1] + s, p[2]));
  idx.push(0, 1, 2, 0, 2, 3, 4, 6, 5, 4, 7, 6, 0, 4, 5, 0, 5, 1, 3, 2, 6, 3, 6, 7, 0, 3, 7, 0, 7, 4, 1, 5, 6, 1, 6, 2);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(verts, 3));
  g.setIndex(idx);
  return g;
}

function fuselage(d) {
  const L = d.length, r = d.fuselage / 2;
  const pts = [];
  const N = 28;
  for (let i = 0; i <= N; i++) {
    const t = i / N; // 0 tail .. 1 nose
    let k = 1;
    if (t > 0.88) k = Math.sqrt(Math.max(0, 1 - ((t - 0.88) / 0.12) ** 2)) * 0.92 + 0.08 * (1 - (t - 0.88) / 0.12); // nose
    else if (t < 0.24) k = 0.12 + 0.88 * Math.sin((t / 0.24) * Math.PI / 2); // tail taper
    pts.push(new THREE.Vector2(Math.max(0.02, r * k), t * L));
  }
  const g = new THREE.LatheGeometry(pts, 20);
  g.rotateX(-Math.PI / 2); // lathe y -> -z: tail at +z... flip so nose is -z
  g.translate(0, 0, L / 2);
  return g;
}

function engine(d, x, z) {
  const r = d.engineDia / 2, len = d.engineDia * 1.9;
  const g = new THREE.CylinderGeometry(r * 0.93, r, len, 14, 1, false);
  g.rotateX(Math.PI / 2);
  g.translate(x, -d.fuselage * 0.42 - r * 0.15, z);
  return g;
}

/** Build geometry set for a variant: { body, tipR, tipL, foldHinge } (tips only if foldTips). */
export function buildJetGeometry(variant) {
  const d = JET_DIMS[variant];
  const L = d.length, half = d.span / 2, r = d.fuselage / 2;
  const zLE = -L * 0.06; // wing root leading edge
  const tipFold = d.foldTips ? 3.5 : 0;
  const mainHalf = half - tipFold;
  const sweepAft = Math.tan((d.sweep * Math.PI) / 180) * half;
  const at = (s) => ({ le: zLE + sweepAft * (s / half), chord: d.rootChord + (d.tipChord - d.rootChord) * (s / half), y: 0.09 * s * 0.4 });
  const quad = (s0, s1, sign) => {
    const a = at(s0), b = at(s1);
    return panel([sign * s0, a.y, a.le], [sign * s0, a.y, a.le + a.chord], [sign * s1, b.y, b.le + b.chord], [sign * s1, b.y, b.le], 0.45);
  };
  const parts = [{ geo: fuselage(d), shade: 0.95 }];
  for (const sign of [1, -1]) {
    parts.push({ geo: quad(r * 0.8, mainHalf, sign), shade: 0.86 });
    if (!d.foldTips) continue;
  }
  // tailplane and fin
  const tailZ = L * 0.5 - 1.2, hs = d.span * 0.18, tc = d.rootChord * 0.55;
  for (const sign of [1, -1]) {
    parts.push({ geo: panel([sign * r * 0.5, 0.4, tailZ - tc], [sign * r * 0.5, 0.4, tailZ], [sign * hs, 0.9, tailZ + tc * 0.1], [sign * hs, 0.9, tailZ - tc * 0.6], 0.3), shade: 0.84 });
  }
  const finH = d.fuselage * 1.45;
  parts.push({ geo: panel([-0, r * 0.7, tailZ - tc * 1.3], [0, r * 0.7, tailZ + tc * 0.3], [0, r + finH, tailZ + tc * 0.55], [0, r + finH, tailZ - tc * 0.4], 0.35).rotateY(0), shade: 0.9 });
  // engines
  const ex = d.span * 0.2;
  parts.push({ geo: engine(d, ex, zLE - d.engineDia * 0.4), shade: 0.6 }, { geo: engine(d, -ex, zLE - d.engineDia * 0.4), shade: 0.6 });
  const out = { body: mergeParts(parts), variant, tips: null };
  if (d.foldTips) { // tips pivot at the fold line; geometry is built in the open (flight) position relative to the hinge
    const a = at(mainHalf), b = at(half);
    const mk = (sign) => panel([0, 0, a.le - a.le], [0, 0, a.chord], [sign * tipFold, b.y - a.y, b.le + b.chord - a.le], [sign * tipFold, b.y - a.y, b.le - a.le], 0.4);
    out.tips = {
      r: mergeParts([{ geo: mk(1), shade: 0.86 }]), l: mergeParts([{ geo: mk(-1), shade: 0.86 }]),
      hingeR: { x: mainHalf, y: at(mainHalf).y, z: a.le }, hingeL: { x: -mainHalf, y: at(mainHalf).y, z: a.le },
    };
  }
  return out;
}
