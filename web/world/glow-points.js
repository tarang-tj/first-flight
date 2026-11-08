// Soft additive round points whose pixel size follows distance (clamped), for runway lights,
// factory lights, nav lights and stars. Share `glowUniforms` so the world updates one place per frame.
import * as THREE from "three";

export const glowUniforms = { uScale: { value: 800 }, uPx: { value: 1 }, uFog: { value: 0.00002 } };

const vert = /* glsl */ `
  attribute vec3 color; attribute float size;
  uniform float uScale; uniform float uPx; uniform float uFog; uniform float uMaxPx; uniform float uMinPx;
  varying vec3 vColor; varying float vFog;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    float px = size * uScale / max(-mv.z, 1.0);
    gl_PointSize = clamp(px, uMinPx, uMaxPx) * uPx;
    vColor = color;
    vFog = exp(-pow(length(mv.xyz) * uFog, 2.0));
    gl_Position = projectionMatrix * mv;
  }`;
const frag = /* glsl */ `
  uniform float uOpacity; varying vec3 vColor; varying float vFog;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    float a = pow(max(0.0, 1.0 - d), 1.6);
    gl_FragColor = vec4(vColor * a * uOpacity * vFog, 1.0);
  }`;

/** positions/colors flat arrays, sizes per point in metres. Returns THREE.Points with .userData.setOpacity. */
export function createGlowPoints(positions, colors, sizes, { minPx = 2, maxPx = 36 } = {}) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  g.setAttribute("size", new THREE.Float32BufferAttribute(sizes, 1));
  const uniforms = {
    uScale: glowUniforms.uScale, uPx: glowUniforms.uPx, uFog: glowUniforms.uFog, uOpacity: { value: 1 },
    uMinPx: { value: minPx }, uMaxPx: { value: maxPx },
  };
  const m = new THREE.ShaderMaterial({
    uniforms, vertexShader: vert, fragmentShader: frag,
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
  });
  const p = new THREE.Points(g, m);
  p.frustumCulled = false;
  p.userData.setOpacity = (v) => { uniforms.uOpacity.value = v; p.visible = v > 0.01; };
  return p;
}
