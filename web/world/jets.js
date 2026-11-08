// Jet instances: shared per-variant geometry, per-jet material for highlighting, auto-scale with
// camera distance, a screen-space halo so a jet is never invisible, and nav lights.
import * as THREE from "three";
import { JET_DIMS, variantFor, autoScale, HIGHLIGHT_COLORS } from "./jet-dims.js";
import { buildJetGeometry } from "./jet-geometry.js";

const geoCache = new Map();
const geoFor = (variant) => {
  if (!geoCache.has(variant)) geoCache.set(variant, buildJetGeometry(variant));
  return geoCache.get(variant);
};

let haloTex = null;
function haloTexture() {
  if (haloTex) return haloTex;
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grad.addColorStop(0, "rgba(255,255,255,1)");
  grad.addColorStop(0.25, "rgba(255,255,255,0.45)");
  grad.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = grad;
  g.fillRect(0, 0, 64, 64);
  haloTex = new THREE.CanvasTexture(c);
  return haloTex;
}

const navGeo = new THREE.SphereGeometry(0.7, 8, 6);
const navRed = new THREE.MeshBasicMaterial({ color: 0xff2020, fog: false });
const navGreen = new THREE.MeshBasicMaterial({ color: 0x20ff50, fog: false });
const navWhite = new THREE.MeshBasicMaterial({ color: 0xffffff, fog: false });

const STYLE = {
  test: { color: 0xeeeeee, emissive: HIGHLIGHT_COLORS.test, ei: 0.28, halo: 1, opacity: 1, haloPx: 0.035 },
  traffic: { color: 0xc8d0d8, emissive: 0x000000, ei: 0, halo: 0.35, opacity: 0.85, haloPx: 0.018 },
  selected: { color: 0xffffff, emissive: 0xffffff, ei: 0.5, halo: 1, opacity: 1, haloPx: 0.045 },
};

export function createJet(scene, program) {
  const variant = variantFor(program), dims = JET_DIMS[variant], geos = geoFor(variant);
  const root = new THREE.Group();           // position and orientation
  const scaler = new THREE.Group();         // auto-scale
  root.add(scaler);
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.42, metalness: 0.12, transparent: true });
  const body = new THREE.Mesh(geos.body, mat);
  scaler.add(body);
  let tipR = null, tipL = null;
  if (geos.tips) {
    const mk = (g, h) => { const m = new THREE.Mesh(g, mat); m.position.set(h.x, h.y, h.z); scaler.add(m); return m; };
    tipR = mk(geos.tips.r, geos.tips.hingeR); tipL = mk(geos.tips.l, geos.tips.hingeL);
  }
  const lights = [
    [navRed, -dims.span / 2, 0.4, 0], [navGreen, dims.span / 2, 0.4, 0], [navWhite, 0, dims.fuselage * 1.6, dims.length * 0.5 - 1],
  ].map(([m, x, y, z]) => { const s = new THREE.Mesh(navGeo, m); s.position.set(x, y, z); scaler.add(s); return s; });
  const halo = new THREE.Sprite(new THREE.SpriteMaterial({ map: haloTexture(), transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: false }));
  root.add(halo);
  root.frustumCulled = false;
  scene.add(root);

  let kind = "traffic", fold = 0, foldTarget = 0, dead = false;
  const handle = {
    group: root, dims, variant, pos: root.position,
    setPose(p, headingDeg = 0, pitchDeg = 0, rollDeg = 0) {
      root.position.set(p.x, p.y, p.z);
      root.rotation.set((pitchDeg * Math.PI) / 180, (-headingDeg * Math.PI) / 180, (-rollDeg * Math.PI) / 180, "YXZ");
      foldTarget = p.y < 30 ? 1 : 0; // 777-9 tips fold on the ground only
    },
    setHighlight(k) {
      kind = STYLE[k] ? k : "traffic";
      const s = STYLE[kind];
      mat.color.setHex(s.color); mat.emissive.setHex(s.emissive); mat.emissiveIntensity = s.ei; mat.opacity = s.opacity;
      halo.material.color.setHex(kind === "traffic" ? 0xbfd2e6 : s.emissive);
    },
    /** Per frame: distance-based scale, halo, tip fold. */
    update(camera, dt, fovScale) {
      const d = camera.position.distanceTo(root.position);
      const sc = autoScale(d, dims.length);
      scaler.scale.setScalar(sc);
      const s = STYLE[kind];
      halo.material.opacity = s.halo * Math.min(1, Math.max(0, (d - 300) / 1500));
      halo.visible = halo.material.opacity > 0.02;
      const px = s.haloPx; // fraction of screen height
      halo.scale.setScalar(px * 2 * d * fovScale);
      if (tipR) {
        fold += (foldTarget - fold) * Math.min(1, dt * 1.5);
        tipR.rotation.z = fold * Math.PI / 2; tipL.rotation.z = -fold * Math.PI / 2;
      }
    },
    dispose() {
      if (dead) return;
      dead = true;
      scene.remove(root);
      mat.dispose(); halo.material.dispose();
    },
  };
  void lights;
  handle.setHighlight("traffic");
  return handle;
}

/** Strobe the shared white nav light and return nothing; call once per frame with seconds. */
export function tickNavLights(t) {
  navWhite.visible = true;
  navWhite.color.setScalar((t * 1.3) % 1 < 0.1 ? 1 : 0.0);
}
