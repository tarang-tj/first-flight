// Sky dome (gradient + sun disc and halo), stars and a sprite cloud deck. Colours are driven by
// skyState(sun elevation); `update` is cheap and called whenever the sun or weather changes.
import * as THREE from "three";
import { EARTH_R } from "../geo.js";

const vert = /* glsl */ `
  varying vec3 vDir;
  void main() {
    vDir = normalize(position);
    vec4 p = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
    gl_Position = p.xyww; // always at the far plane
  }`;
const frag = /* glsl */ `
  uniform vec3 uZenith; uniform vec3 uHorizon; uniform vec3 uSunDir; uniform vec3 uSunColor; uniform float uSunStrength;
  varying vec3 vDir;
  void main() {
    vec3 d = normalize(vDir);
    float up = max(d.y, 0.0);
    vec3 col = mix(uHorizon, uZenith, pow(up, 0.55));
    col = mix(col, uHorizon * 0.55, smoothstep(0.0, -0.25, d.y)); // below the horizon: darker haze
    float s = max(dot(d, normalize(uSunDir)), 0.0);
    col += uSunColor * (pow(s, 8.0) * 0.28 + pow(s, 90.0) * 0.55) * uSunStrength;
    col += vec3(1.0, 0.97, 0.9) * smoothstep(0.99965, 0.9999, s) * 2.0 * uSunStrength;
    gl_FragColor = vec4(col, 1.0);
    #include <colorspace_fragment>
  }`;

const srgb = (c) => new THREE.Color().setRGB(c[0], c[1], c[2], THREE.SRGBColorSpace);

function puffTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  for (let i = 0; i < 9; i++) {
    const x = 64 + (Math.sin(i * 12.9) * 22), y = 64 + (Math.cos(i * 7.3) * 12), r = 30 + ((i * 17) % 22);
    const grad = g.createRadialGradient(x, y, 0, x, y, r);
    grad.addColorStop(0, "rgba(255,255,255,0.55)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export function createSky(scene) {
  const uniforms = {
    uZenith: { value: new THREE.Color() }, uHorizon: { value: new THREE.Color() },
    uSunDir: { value: new THREE.Vector3(0, 1, 0) }, uSunColor: { value: new THREE.Color() }, uSunStrength: { value: 1 },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(1000, 48, 24),
    new THREE.ShaderMaterial({ uniforms, vertexShader: vert, fragmentShader: frag, side: THREE.BackSide, depthWrite: false, fog: false }),
  );
  dome.renderOrder = -100;
  dome.frustumCulled = false;
  scene.add(dome);

  const sp = [];
  for (let i = 0; i < 700; i++) {
    const a = Math.sin(i * 91.7) * 43758.5, b = Math.sin(i * 12.3 + 4) * 24634.6;
    const th = (a - Math.floor(a)) * Math.PI * 2, y = ((b - Math.floor(b)) * 0.95 + 0.05);
    const r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(th) * r * 900, y * 900, Math.sin(th) * r * 900);
  }
  const starGeo = new THREE.BufferGeometry();
  starGeo.setAttribute("position", new THREE.Float32BufferAttribute(sp, 3));
  const stars = new THREE.Points(starGeo, new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  stars.renderOrder = -99;
  stars.frustumCulled = false;
  scene.add(stars);

  // cloud deck: 120 puffs on a disc 3 to 70 km out, base about 1.8 km MSL, following earth curvature
  const tex = puffTexture();
  const clouds = new THREE.Group();
  const puffs = [];
  for (let i = 0; i < 240; i++) {
    const f = (k) => { const v = Math.sin(i * k) * 43758.5453; return v - Math.floor(v); };
    const r = 14000 + Math.pow(f(12.9), 0.6) * 70000, th = f(78.2) * Math.PI * 2;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0.5, fog: true });
    const s = new THREE.Sprite(mat);
    const w = 1400 + f(3.3) * 3200;
    s.scale.set(w, w * 0.3, 1);
    s.position.set(Math.cos(th) * r, 2600 + f(5.7) * 1200 - (r * r) / (2 * EARTH_R), Math.sin(th) * r);
    s.userData.rank = f(9.1);
    clouds.add(s); puffs.push(s);
  }
  scene.add(clouds);
  let cloudFade = 1;

  return {
    dome, stars, clouds,
    /** st: skyState(); sunDir: unit vector; cloudCover 0..100 */
    update(st, sunDir, cloudCover) {
      uniforms.uZenith.value.copy(srgb(st.zenith));
      uniforms.uHorizon.value.copy(srgb(st.horizon));
      uniforms.uSunColor.value.copy(srgb(st.sunColor));
      uniforms.uSunDir.value.set(sunDir.x, sunDir.y, sunDir.z);
      uniforms.uSunStrength.value = Math.max(0, Math.min(1, (sunDir.y + 0.08) * 6)) * (1 - 0.65 * cloudCover / 100);
      stars.material.opacity = Math.max(0, st.night - 0.15) * (1 - cloudCover / 120);
      const lit = srgb([0.55 + 0.45 * st.day, 0.55 + 0.45 * st.day, 0.6 + 0.4 * st.day]);
      const tint = srgb(st.sunColor).multiplyScalar(0.35 + 0.65 * st.day).lerp(lit, 0.45).multiplyScalar(0.12 + 0.88 * st.day);
      const want = (cloudCover / 100) * puffs.length;
      puffs.forEach((p) => { p.visible = p.userData.rank * puffs.length < want; p.material.color.copy(tint); });
    },
    /** Fade the cloud deck out as the camera rises above it (puffs look like dust from orbit). */
    setCameraHeight(h) {
      const f = 1 - Math.min(1, Math.max(0, (h - 3500) / 12000));
      if (Math.abs(f - cloudFade) < 0.01) return;
      cloudFade = f;
      clouds.visible = f > 0.01;
      puffs.forEach((p) => { p.material.opacity = 0.5 * f; });
    },
    /** Keep dome and stars centred on the camera. */
    follow(camPos) { dome.position.copy(camPos); stars.position.copy(camPos); },
    dispose() {
      dome.geometry.dispose(); dome.material.dispose(); starGeo.dispose(); stars.material.dispose(); tex.dispose();
      puffs.forEach((p) => p.material.dispose());
    },
  };
}
