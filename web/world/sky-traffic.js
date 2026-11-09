// Renders the jets that were really aloft at the sim time: one jet mesh each (world.addJet) plus
// glowing comet tails drawn as ONE dynamic screen-space ribbon mesh, rewritten every frame.
// Pick ids are "sky:<hex>", which hexOfPickId (ui/format.js) reads back as the airframe hex.
import * as THREE from "three";
import { toLocal, FT } from "../geo.js";
import { programColor } from "../ui/year-model.js";

const MAX_TAILS = 120, MAX_PTS = 170, MEM_PTS = 90;
const VERTS = MAX_TAILS * MAX_PTS * 2;

const vert = /* glsl */ `
  attribute vec3 other; attribute float side; attribute float fade; attribute float end; attribute vec3 tcolor; attribute float gain;
  uniform vec2 uRes; uniform float uMinPx; uniform float uWorld;
  varying float vSide; varying float vFade; varying vec3 vColor; varying float vNear; varying float vGain;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    vec4 p = projectionMatrix * mv;
    vec4 q = projectionMatrix * modelViewMatrix * vec4(other, 1.0);
    const float EPS = 0.05;
    if (p.w < EPS && q.w < EPS) p = vec4(3.0, 3.0, 1.0, 1.0);
    else if (p.w < EPS) p = mix(p, q, (EPS - p.w) / (q.w - p.w));
    else if (q.w < EPS) q = mix(p, q, (p.w - EPS) / (p.w - q.w));
    vec2 a = p.xy / p.w * uRes, b = q.xy / q.w * uRes;
    vec2 dir = normalize((b - a) * (1.0 - 2.0 * end) + vec2(1e-5));
    vec2 nrm = vec2(-dir.y, dir.x);
    float dist = length(mv.xyz);
    float worldPx = uWorld * projectionMatrix[1][1] / max(p.w, 1.0) * uRes.y * 0.5; // thicker close up, capped
    float base = clamp(worldPx, uMinPx, uMinPx * 5.0);
    float w = max(base * (0.4 + 0.6 * fade), uMinPx) * 6.0; // quad is wider than the bright core
    p.xy += nrm * side * w / uRes * p.w;
    gl_Position = p;
    vSide = side; vFade = fade; vColor = tcolor; vGain = gain; vNear = smoothstep(6.0, 90.0, dist);
  }`;
const frag = /* glsl */ `
  varying float vSide; varying float vFade; varying vec3 vColor; varying float vNear; varying float vGain;
  void main() {
    float core = exp(-vSide * vSide * 26.0) + 0.38 * exp(-vSide * vSide * 5.0);
    float a = min(1.0, core * pow(vFade, 1.1) * 0.95 * vGain) * vNear;
    vec3 c = mix(vColor, vec3(1.0), pow(vFade, 10.0) * 0.6 * exp(-vSide * vSide * 18.0));
    gl_FragColor = vec4(c, a);
    #include <colorspace_fragment>
  }`;

function createRibbon(scene) {
  const geo = new THREE.BufferGeometry();
  const attr = (n, size) => { const a = new THREE.BufferAttribute(new Float32Array(VERTS * size), size); a.setUsage(THREE.DynamicDrawUsage); geo.setAttribute(n, a); return a; };
  const pos = attr("position", 3), other = attr("other", 3), side = attr("side", 1), fade = attr("fade", 1), end = attr("end", 1), col = attr("tcolor", 3), gain = attr("gain", 1);
  const index = new THREE.BufferAttribute(new Uint32Array(MAX_TAILS * MAX_PTS * 6), 1);
  index.setUsage(THREE.DynamicDrawUsage);
  geo.setIndex(index);
  const uniforms = { uRes: { value: new THREE.Vector2(1, 1) }, uMinPx: { value: 2 }, uWorld: { value: 14 } };
  const mat = new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.frustumCulled = false;
  mesh.renderOrder = 3;
  scene.add(mesh);
  geo.setDrawRange(0, 0);
  return { geo, mat, mesh, uniforms, pos, other, side, fade, end, col, gain, index };
}

/** Write every tail into the ribbon buffers. tails: [{pts:[{x,y,z}], color:THREE.Color, gain}] */
function writeTails(r, tails) {
  let v = 0, ix = 0;
  for (const t of tails.slice(0, MAX_TAILS)) {
    const pts = t.pts.slice(-MAX_PTS), n = pts.length;
    if (n < 2) continue;
    const base = v;
    for (let i = 0; i < n; i++) {
      const p = pts[i], o = i < n - 1 ? pts[i + 1] : pts[i - 1], f = t.flat ? t.flat * (0.55 + 0.45 * (i / (n - 1))) : i / (n - 1), last = i === n - 1 ? 1 : 0;
      for (const s of [-1, 1]) {
        r.pos.setXYZ(v, p.x, p.y, p.z); r.other.setXYZ(v, o.x, o.y, o.z);
        r.side.setX(v, s); r.fade.setX(v, f); r.end.setX(v, last);
        r.col.setXYZ(v, t.color.r, t.color.g, t.color.b); r.gain.setX(v, t.gain);
        v++;
      }
      if (i < n - 1) {
        const a = base + i * 2;
        r.index.setX(ix++, a); r.index.setX(ix++, a + 1); r.index.setX(ix++, a + 2);
        r.index.setX(ix++, a + 1); r.index.setX(ix++, a + 3); r.index.setX(ix++, a + 2);
      }
    }
  }
  for (const a of [r.pos, r.other, r.side, r.fade, r.end, r.col, r.gain, r.index]) a.needsUpdate = true;
  r.geo.setDrawRange(0, ix);
}

const local = (lat, lon, altFt) => toLocal(lat, lon, Math.max(0, altFt) * FT);
export const pickIdOf = (hex) => `sky:${hex}`;

export function createSkyTraffic(world) {
  const ribbon = createRibbon(world.scene);
  const jets = new Map(); // pick id -> { jet, hex, program, kind }
  const size = new THREE.Vector2();
  const paths = new Map(); // flight id -> thinned local points of a finished flight
  const colors = new Map();
  const colorOf = (program) => {
    if (!colors.has(program)) colors.set(program, new THREE.Color(programColor(program)));
    return colors.get(program);
  };

  return {
    get count() { return jets.size; },
    handleOf(id) { return jets.get(id)?.jet || null; },
    infoOf(id) { const j = jets.get(id); return j ? j.info : null; },
    entries() { return jets.entries(); },
    /** actives: feed.activeAt() result. selectedId: a pick id to highlight. Returns pick ids that left the sky. */
    sync(actives, selectedId = null, memory = []) {
      const seen = new Set(), tails = [], gone = [];
      for (const a of actives) {
        const f = a.flight, id = pickIdOf(f.hex);
        if (seen.has(id)) continue;
        seen.add(id);
        let e = jets.get(id);
        if (!e || e.fid !== f.id) {
          if (e) { e.jet.dispose(); gone.push(id); } // same airframe, new flight: a follower must let go of the old mesh
          try { e = { jet: world.addJet(id, f.program === "unknown" ? "737" : f.program), fid: f.id, kind: "" }; } catch (err) { console.warn(`[sky] addJet failed: ${err?.message || err}`); continue; }
          jets.set(id, e);
        }
        e.info = { id, hex: f.hex, reg: f.reg, cs: f.cs, type: f.type, program: f.program, ff: !!f.ff, altFt: a.altFt, groundKt: a.groundKt };
        const kind = id === selectedId ? "selected" : "test";
        if (e.kind !== kind) { e.jet.setHighlight?.(kind); e.kind = kind; }
        const p = local(a.lat, a.lon, a.altFt);
        e.jet.setPose(p, a.headingDeg, a.pitchDeg, a.rollDeg);
        tails.push({ pts: a.tail.map((q) => local(q[0], q[1], q[2])), color: colorOf(f.program), gain: f.ff ? 1.4 : 1.0 });
      }
      const keep = new Set();
      for (const m of memory) { // faint persistent glow: the whole flown path of flights that landed in the last day
        const f = m.flight;
        keep.add(f.id);
        if (!paths.has(f.id)) {
          const stride = Math.max(1, Math.ceil(f.pts.length / MEM_PTS));
          paths.set(f.id, f.pts.filter((_, i) => i % stride === 0 || i === f.pts.length - 1).map((q) => local(q[1], q[2], q[3] || 0)));
        }
        tails.push({ pts: paths.get(f.id), color: colorOf(f.program), gain: (f.ff ? 0.85 : 0.5) * (1 - 0.7 * m.age), flat: 0.62 });
      }
      for (const k of paths.keys()) if (!keep.has(k)) paths.delete(k);
      for (const [id, e] of jets) if (!seen.has(id)) { e.jet.dispose(); jets.delete(id); gone.push(id); }
      world.renderer.getDrawingBufferSize(size);
      ribbon.uniforms.uRes.value.copy(size);
      const dpr = size.y / (world.canvas.clientHeight || size.y);
      ribbon.uniforms.uMinPx.value = 1.6 * dpr; // never thinner than ~1.6 css px, however far
      writeTails(ribbon, tails);
      return gone;
    },
    clear() {
      for (const e of jets.values()) e.jet.dispose();
      jets.clear();
      paths.clear();
      ribbon.geo.setDrawRange(0, 0);
    },
    dispose() {
      this.clear();
      world.scene.remove(ribbon.mesh);
      ribbon.geo.dispose();
      ribbon.mat.dispose();
    },
  };
}
