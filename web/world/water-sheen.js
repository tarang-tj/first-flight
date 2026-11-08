// Water read for terrain materials: imagery pixels that are dark and blue get a sky reflection that
// strengthens at grazing angles (Fresnel) plus a sun glitter streak. Land is untouched.
import * as THREE from "three";

export const sheenUniforms = {
  uSheenSky: { value: new THREE.Color(0.2, 0.3, 0.5) },
  uSheenSun: { value: new THREE.Vector3(0, 1, 0) }, // view-space direction to the sun
  uSheenSunColor: { value: new THREE.Color(1, 1, 1) },
  uSheenAmount: { value: 1 },
};

export function patchWaterSheen(material) {
  material.onBeforeCompile = (shader) => {
    Object.assign(shader.uniforms, sheenUniforms);
    shader.fragmentShader = shader.fragmentShader
      .replace("#include <common>", `#include <common>
        uniform vec3 uSheenSky; uniform vec3 uSheenSun; uniform vec3 uSheenSunColor; uniform float uSheenAmount;`)
      .replace("#include <dithering_fragment>", `
        {
          vec3 base = diffuseColor.rgb;
          float lum = dot(base, vec3(0.3, 0.55, 0.15));
          float water = smoothstep(0.06, 0.025, lum) * smoothstep(2.0, 3.2, (base.b + 0.002) / (base.r + 0.002)) * smoothstep(1.3, 1.65, (base.b + 0.002) / (base.g + 0.002));
          vec3 V = normalize(vViewPosition);
          vec3 N = normalize(normal);
          float fres = pow(1.0 - clamp(dot(V, N), 0.0, 1.0), 3.0);
          vec3 R = reflect(-V, N);
          float glit = pow(max(dot(R, normalize(uSheenSun)), 0.0), 140.0);
          gl_FragColor.rgb += water * uSheenAmount * (uSheenSky * (0.04 + 0.6 * fres) + uSheenSunColor * glit * 1.6);
        }
        #include <dithering_fragment>`);
  };
  material.customProgramCacheKey = () => "water-sheen";
}
