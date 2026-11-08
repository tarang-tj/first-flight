// FIRST FLIGHT 3D world: Puget Sound terrain, Everett plant, sky, jets, trails, camera.
// Contract: see plans/261108-0220-first-flight/interfaces.md (lane B). Third-party failures only warn.
import * as THREE from "three";
import { ORIGIN } from "../geo.js";
import { solarPosition, sunVector, skyState } from "./sun.js";
import { createTerrain } from "./terrain.js";
import { createOsmLayer } from "./osm-layer.js";
import { createSky } from "./sky.js";
import { createJet, tickNavLights } from "./jets.js";
import { createTrailSystem } from "./trails.js";
import { createRig } from "./camera-rig.js";
import { startWeather } from "./weather.js";
import { glowUniforms } from "./glow-points.js";
import { sheenUniforms } from "./water-sheen.js";

const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);
const FOG_BASE = 1.25e-5;

export function createWorld(canvas, { onReady, dprCap = 2, weather = true } = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: "high-performance", preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(46, 1, 1, 900000);
  scene.fog = new THREE.FogExp2(0x9ab4d0, FOG_BASE);

  const hemi = new THREE.HemisphereLight(0xbcd4ff, 0x4a4636, 1);
  const sun = new THREE.DirectionalLight(0xffffff, 3);
  const moon = new THREE.DirectionalLight(0x6f86c8, 0);
  moon.position.set(-0.4, 0.8, 0.3);
  scene.add(hemi, sun, moon);

  const sky = createSky(scene);
  const terrain = createTerrain();
  scene.add(terrain.group);
  const trails = createTrailSystem(scene, glowUniforms);
  const rig = createRig(camera, canvas, (x, z) => terrain.groundAt(x, z));
  const jets = new Map();
  const frameCbs = new Set();
  const state = { date: new Date(), cloudCover: 25, visibilityM: 30000, precip: 0, night: 0 };
  let osm = null, disposed = false, raf = 0, last = 0, clock = 0, size = { w: 1, h: 1 };
  const world = { scene, camera, renderer, canvas, landmarks: {}, state };

  /** Haze lives in the lowest few km: thin it as the camera climbs so region/state views stay clear. */
  function applyFogHeight() {
    const h = Math.max(0, camera.position.y), k = 1 / (1 + h / 2500);
    scene.fog.density = (state.fogBase || FOG_BASE) * Math.max(0.04, k);
    glowUniforms.uFog.value = scene.fog.density;
    sky.setCameraHeight(h);
  }

  function applyLook() {
    const pos = solarPosition(state.date, ORIGIN.lat, ORIGIN.lon);
    const sv = sunVector(pos.azimuthDeg, pos.elevationDeg);
    const st = skyState(pos.elevationDeg);
    const dim = 1 - 0.62 * (state.cloudCover / 100);
    sun.position.set(sv.x, Math.max(sv.y, 0.02), sv.z).multiplyScalar(1000);
    sun.color.copy(srgb(st.sunColor));
    sun.intensity = st.sunIntensity * 1.35 * dim * (sv.y > -0.02 ? 1 : 0);
    hemi.color.copy(srgb(st.zenith).lerp(new THREE.Color(1, 1, 1), 0.35));
    hemi.groundColor.copy(srgb(st.horizon).multiplyScalar(0.45));
    hemi.intensity = st.ambient * 2.3 * (0.75 + 0.25 * dim);
    moon.intensity = 0.9 * st.night;
    const fog = scene.fog;
    fog.color.copy(srgb(st.horizon)).lerp(new THREE.Color(0.5, 0.5, 0.55), Math.min(0.5, state.cloudCover / 220) * st.day);
    state.fogBase = FOG_BASE * Math.min(10, Math.max(0.7, 24000 / state.visibilityM)) * (1 + state.precip * 0.6);
    applyFogHeight();
    sheenUniforms.uSheenSky.value.copy(srgb(st.zenith)).lerp(srgb(st.horizon), 0.45).multiplyScalar(0.35 + 0.65 * st.day);
    sheenUniforms.uSheenSunColor.value.copy(srgb(st.sunColor)).multiplyScalar(sv.y > 0 ? dim : 0);
    sheenUniforms.uSheenAmount.value = 0.55 + 0.45 * st.day;
    sky.update(st, sv, state.cloudCover);
    state.night = st.night;
    if (osm) osm.setNight(st.night);
    state.sun = { ...pos, vector: sv };
  }

  world.setSun = (date) => { state.date = date instanceof Date ? date : new Date(date); applyLook(); };
  world.setWeather = ({ cloudCover, visibilityM, precip } = {}) => {
    if (Number.isFinite(cloudCover)) state.cloudCover = Math.min(100, Math.max(0, cloudCover));
    if (Number.isFinite(visibilityM) && visibilityM > 0) state.visibilityM = visibilityM;
    if (Number.isFinite(precip)) state.precip = Math.max(0, precip);
    applyLook();
  };

  world.addJet = (id, program) => {
    const h = createJet(scene, program);
    const wrapped = {
      group: h.group, dims: h.dims, pos: h.pos, get heading() { return h.heading || 0; },
      setPose(p, hd, pt, rl) { h.heading = hd || 0; h.setPose(p, hd, pt, rl); },
      setHighlight: h.setHighlight,
      dispose() { jets.delete(id); h.dispose(); },
    };
    jets.get(id)?.wrapped.dispose();
    jets.set(id, { h, wrapped });
    return wrapped;
  };
  world.addTrail = (id, points, opts) => trails.add(id, points, opts);
  world.flyTo = (goal, ms) => rig.flyTo(goal, ms);
  world.setView = (name, ms) => rig.setView(name, ms);
  world.chase = (jet) => rig.chase(jet);
  world.snapTo = (goal) => rig.snapTo(goal);
  world.onFrame = (cb) => { frameCbs.add(cb); return () => frameCbs.delete(cb); };
  world.groundAt = (x, z) => terrain.groundAt(x, z);
  world.rig = rig;

  /** CSS-pixel position of a local point, plus whether it is in front of the camera. */
  world.project = (x, y, z) => {
    const v = new THREE.Vector3(x, y, z).project(camera), r = canvas.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height, visible: v.z > -1 && v.z < 1 };
  };
  /** Nearest jet within ~34 px of a client point, else null. */
  world.pick = (cx, cy) => {
    let best = null, bd = 34;
    for (const [id, { h }] of jets) {
      const p = world.project(h.pos.x, h.pos.y, h.pos.z);
      if (!p.visible) continue;
      const d = Math.hypot(p.x - cx, p.y - cy);
      if (d < bd) { bd = d; best = id; }
    }
    return best;
  };

  // boot probe: fraction of a tiny offscreen render that is not black
  const probe = new THREE.WebGLRenderTarget(64, 40);
  world.litFraction = () => {
    try {
      const buf = new Uint8Array(64 * 40 * 4);
      renderer.setRenderTarget(probe);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(probe, 0, 0, 64, 40, buf);
      renderer.setRenderTarget(null);
      let lit = 0;
      for (let i = 0; i < buf.length; i += 4) if (buf[i] + buf[i + 1] + buf[i + 2] > 6) lit++;
      return lit / (64 * 40);
    } catch (err) {
      renderer.setRenderTarget(null);
      console.warn("[world] litFraction failed", err.message);
      return 0;
    }
  };

  function resize() {
    const w = canvas.clientWidth || canvas.parentElement?.clientWidth || 800, h = canvas.clientHeight || canvas.parentElement?.clientHeight || 600;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    if (w === size.w && h === size.h && dpr === size.dpr) return;
    size = { w, h, dpr };
    renderer.setPixelRatio(dpr);
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    glowUniforms.uPx.value = dpr;
  }

  function frame(now) {
    raf = 0;
    if (disposed || document.hidden) return;
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, last ? (now - last) / 1000 : 0.016);
    last = now; clock += dt;
    resize();
    frameCbs.forEach((cb) => { try { cb(dt, clock); } catch (err) { console.warn("[world] onFrame callback threw", err.message); } });
    rig.update(dt);
    applyFogHeight();
    camera.updateMatrixWorld();
    sheenUniforms.uSheenSun.value.set(state.sun.vector.x, state.sun.vector.y, state.sun.vector.z).transformDirection(camera.matrixWorldInverse);
    sky.follow(camera.position);
    glowUniforms.uScale.value = (size.h * size.dpr) / (2 * Math.tan((camera.fov * Math.PI) / 360)) / size.dpr;
    const fovScale = Math.tan((camera.fov * Math.PI) / 360);
    tickNavLights(clock);
    for (const { h } of jets.values()) h.update(camera, dt, fovScale);
    trails.flush({ x: size.w * size.dpr, y: size.h * size.dpr }, size.dpr);
    renderer.render(scene, camera);
  }
  const onVis = () => { if (!document.hidden && !raf && !disposed) { last = 0; raf = requestAnimationFrame(frame); } };
  document.addEventListener("visibilitychange", onVis);

  world.dispose = () => {
    disposed = true;
    cancelAnimationFrame(raf);
    document.removeEventListener("visibilitychange", onVis);
    stopWeather();
    rig.dispose(); trails.dispose(); sky.dispose(); terrain.dispose(); osm?.dispose();
    for (const { h } of jets.values()) h.dispose();
    probe.dispose(); renderer.dispose();
  };

  const stopWeather = weather ? startWeather((w) => world.setWeather(w)) : () => {};
  applyLook();
  resize();
  raf = requestAnimationFrame(frame);

  world.ready = (async () => {
    await terrain.demReady;
    await terrain.coreReady;
    osm = await createOsmLayer((x, z) => terrain.groundAt(x, z), terrain.core);
    scene.add(osm.group);
    osm.setNight(state.night);
    if (osm.plant) world.landmarks.plant = osm.plant;
    if (!disposed && onReady) { try { onReady(world); } catch (err) { console.warn("[world] onReady threw", err.message); } }
    return world;
  })().catch((err) => { console.warn("[world] ready failed", err.message); return world; });
  world.imageryReady = terrain.ready;
  return world;
}
