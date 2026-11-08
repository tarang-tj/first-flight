// GPU trail ribbons: every trail shares ONE geometry and ONE draw call (see trail-merge.js). Per-trail
// progress and opacity live in a small float texture indexed by the trail id, so animating 600 trails
// writes a few KB per frame instead of re-uploading vertices. Geometry rebuilds (batched, at most once
// per frame) only when trails are added or removed.
import * as THREE from "three";
import { mergeTrails } from "./trail-merge.js";

const CTL_W = 1024;

const vert = /* glsl */ `
  attribute vec3 other; attribute float along; attribute float side; attribute float trail; attribute float end; attribute vec3 tcolor;
  uniform highp sampler2D uCtl; uniform vec2 uRes; uniform float uWidthPx; uniform float uDpr; uniform float uWorldWidth; uniform float uFog;
  varying float vAlong; varying float vSide; varying vec3 vColor; varying vec2 vCtl; varying float vFog; varying float vFar; varying float vNear;
  void main() {
    int id = int(trail + 0.5);
    vec4 c = texelFetch(uCtl, ivec2(id % ${CTL_W}, id / ${CTL_W}), 0);
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 p = projectionMatrix * mv;
    vec4 q = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
    // clip the segment to the near side: a neighbour behind the camera used to flip or fling the ribbon (close-up wedge)
    const float EPS = 0.05;
    if (p.w < EPS && q.w < EPS) p = vec4(3.0, 3.0, 1.0, 1.0);
    else if (p.w < EPS) p = mix(p, q, (EPS - p.w) / (q.w - p.w));
    else if (q.w < EPS) q = mix(p, q, (p.w - EPS) / (p.w - q.w));
    vec2 a = p.xy / p.w * uRes, b = q.xy / q.w * uRes;
    vec2 dir = normalize((b - a) * (1.0 - 2.0 * end) + vec2(1e-5)); // always start -> end, so side +1 is the same bank at both ends
    vec2 nrm = vec2(-dir.y, dir.x);
    float dist = length(mv.xyz);
    float farK = smoothstep(15000.0, 120000.0, dist); // regional distances: hold presence with a wider core and halo
    float worldPx = uWorldWidth * projectionMatrix[1][1] / max(p.w, 1.0) * uRes.y;
    float core = c.b > 0.0 ? c.b * uDpr : uWidthPx;
    float w = max(core * (1.0 + 0.9 * farK), min(worldPx, 9.0 * uDpr)) * 2.4; // world width is capped so a ribbon that passes the lens stays a line // quad is wider than the bright core so the halo has room
    p.xy += nrm * side * w / uRes * p.w;
    gl_Position = p;
    vAlong = along; vSide = side; vColor = tcolor; vCtl = c.xy; vFar = farK; vNear = smoothstep(4.0, 70.0, dist);
    vFog = exp(-pow(length(mv.xyz) * uFog, 2.0) * 0.6);
  }`;
const frag = /* glsl */ `
  varying float vAlong; varying float vSide; varying vec3 vColor; varying vec2 vCtl; varying float vFog; varying float vFar; varying float vNear;
  void main() {
    if (vAlong > vCtl.x + 1e-5 || vCtl.y < 0.003) discard;
    float core = exp(-vSide * vSide * 32.0) + (0.4 + 0.6 * vFar) * exp(-vSide * vSide * 6.0);
    float head = exp(-(vCtl.x - vAlong) * 28.0) * step(vCtl.x, 0.9995);
    float a = core * vCtl.y * (0.34 + 0.35 * vFar + 2.4 * head) * vFog * vNear; // fades out within ~70 m of the lens: segments there project to screen-wide streaks
    gl_FragColor = vec4(vColor * (0.8 + 0.5 * core + 1.2 * head), a);
    #include <colorspace_fragment>
  }`;

export function createTrailSystem(scene, uniformsShared) {
  const trails = []; // { id, points, color, glow, progress, opacity, removed }
  let dirty = false, mesh = null, ctlTex = null, ctlData = null;
  const uniforms = {
    uCtl: { value: null }, uRes: { value: new THREE.Vector2(1, 1) }, uWidthPx: { value: 2.4 }, uDpr: { value: 1 },
    uWorldWidth: { value: 2.2 }, uFog: uniformsShared.uFog,
  };
  const material = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
  });

  function rebuild() {
    dirty = false;
    for (let i = trails.length - 1; i >= 0; i--) if (trails[i].removed) trails.splice(i, 1);
    if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); mesh = null; }
    if (ctlTex) { ctlTex.dispose(); ctlTex = null; }
    const live = trails.filter((t) => t.points.length > 1);
    if (!live.length) return;
    const m = mergeTrails(live.map((t) => ({ points: t.points, color: t.rgb })));
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(m.position, 3));
    g.setAttribute("other", new THREE.BufferAttribute(m.other, 3));
    g.setAttribute("along", new THREE.BufferAttribute(m.along, 1));
    g.setAttribute("side", new THREE.BufferAttribute(m.side, 1));
    g.setAttribute("end", new THREE.BufferAttribute(m.end, 1));
    g.setAttribute("trail", new THREE.BufferAttribute(m.trail, 1));
    g.setAttribute("tcolor", new THREE.BufferAttribute(m.color, 3));
    g.setIndex(new THREE.BufferAttribute(m.index, 1));
    const rows = Math.ceil(live.length / CTL_W);
    ctlData = new Float32Array(CTL_W * rows * 4);
    ctlTex = new THREE.DataTexture(ctlData, CTL_W, rows, THREE.RGBAFormat, THREE.FloatType);
    ctlTex.needsUpdate = true;
    uniforms.uCtl.value = ctlTex;
    live.forEach((t, i) => { t.slot = i; });
    trails.forEach((t) => { if (t.points.length <= 1) t.slot = -1; });
    mesh = new THREE.Mesh(g, material);
    mesh.frustumCulled = false;
    mesh.renderOrder = 5;
    scene.add(mesh);
    pushCtl(true);
  }

  function pushCtl(all) {
    if (!ctlData) return;
    let changed = false;
    for (const t of trails) {
      if (t.slot < 0 || (!all && !t.ctlDirty)) continue;
      ctlData[t.slot * 4] = t.progress; ctlData[t.slot * 4 + 1] = t.opacity; ctlData[t.slot * 4 + 2] = t.width;
      t.ctlDirty = false; changed = true;
    }
    if (changed) ctlTex.needsUpdate = true;
  }

  return {
    /** points: [{x,y,z}] ; opts: { color: css/hex, glow: brightness multiplier, width: core width in CSS px (default 2.4) } */
    add(id, points, { color = "#ff6a1a", glow = 1, width = 0 } = {}) {
      const c = new THREE.Color(color);
      const t = { id, points: points.map((p) => ({ x: p.x, y: p.y, z: p.z })), rgb: [c.r * glow, c.g * glow, c.b * glow], progress: 1, opacity: 1, width: Math.max(0, Number(width) || 0), removed: false, slot: -1, ctlDirty: true };
      trails.push(t);
      dirty = true;
      return {
        setProgress(v) { t.progress = Math.min(1, Math.max(0, v)); t.ctlDirty = true; },
        setOpacity(v) { t.opacity = Math.min(1, Math.max(0, v)); t.ctlDirty = true; },
        dispose() { if (!t.removed) { t.removed = true; dirty = true; } },
      };
    },
    /** Per frame, before render. */
    flush(resolution, dpr) {
      uniforms.uRes.value.set(resolution.x, resolution.y);
      uniforms.uWidthPx.value = 2.4 * dpr;
      uniforms.uDpr.value = dpr;
      if (dirty) rebuild();
      else pushCtl(false);
    },
    get count() { return trails.filter((t) => !t.removed).length; },
    dispose() {
      if (mesh) { scene.remove(mesh); mesh.geometry.dispose(); }
      if (ctlTex) ctlTex.dispose();
      material.dispose();
    },
  };
}
