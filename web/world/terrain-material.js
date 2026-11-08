// Terrain ring material: Lambert + vertex colours, imagery blended over them by tile alpha, water sheen,
// night city lights read from imagery luminance, and (far ring) a rim that dissolves into the haze.
import * as THREE from "three";
import { patchWaterSheen } from "./water-sheen.js";

export const FEATHER = 0.07; // fraction of a ring's width over which its edge fades into the coarser ring
export const nightUniforms = { uNight: { value: 0 } };

/** 64x64 alpha mask: opaque inside, fading to 0 across the outer FEATHER of each side (alphaMap reads green). */
export function featherMask() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const ctx = c.getContext("2d"), img = ctx.createImageData(64, 64);
  const edge = (v) => { const t = Math.min(1, Math.min(v + 0.5, 63.5 - v) / (64 * FEATHER)); return t * t * (3 - 2 * t); };
  for (let y = 0; y < 64; y++) for (let x = 0; x < 64; x++) {
    const a = Math.round(255 * Math.min(edge(x), edge(y)));
    img.data.set([a, a, a, 255], (y * 64 + x) * 4);
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(c);
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

const NIGHT_GLSL = /* glsl */ `
  {
    vec3 c = diffuseColor.rgb;
    float mx = max(c.r, max(c.g, c.b)), mn = min(c.r, min(c.g, c.b));
    float lum = dot(c, vec3(0.3, 0.55, 0.15));
    float sat = (mx - mn) / (mx + 1e-3);
    // bright, grey, low-lying imagery = roofs, roads and pavement: lit sodium orange, strongest on the brightest
    float urban = pow(smoothstep(0.16, 0.42, lum), 1.6) * smoothstep(0.34, 0.14, sat) * (1.0 - smoothstep(450.0, 1000.0, vFFh)) * ffA;
    float haze = 1.0;
    #ifdef USE_FOG
      haze = 1.0 - fogFactor;
    #endif
    // street-lamp pools on a ~48 m grid up close, an even glow once the cells shrink below a pixel
    vec2 cell = fract(vFFp / 48.0) - 0.5;
    float pool = smoothstep(0.34, 0.0, length(cell));
    float near = 1.0 - smoothstep(900.0, 3500.0, length(vViewPosition));
    float lamps = mix(0.42, 0.1 + 1.7 * pool * pool, near);
    gl_FragColor.rgb += vec3(1.0, 0.6, 0.26) * urban * lamps * (0.4 + 1.6 * lum) * uNight * 0.75 * haze;
  }`;

/** rim: dissolve the outer edge (and its skirt walls) into the fog colour so no slab edge is ever framed. */
export function makeRingMaterial(ringName, ri, mask) {
  const mat = new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.FrontSide });
  if (ri > 0) mat.alphaMap = mask;
  mat.transparent = true; // the rim ring fades its alpha in the shader, the others through the feather mask
  patchWaterSheen(mat);
  const sheen = mat.onBeforeCompile;
  const rim = ri === 0, dropNoData = ringName === "wide" || ringName === "far"; // no-data tiles reveal the coarser ring beneath (apron imagery covers Canada) instead of flat elevation colours
  mat.onBeforeCompile = (s) => {
    sheen(s);
    s.uniforms.uNight = nightUniforms.uNight;
    s.vertexShader = s.vertexShader
      .replace("#include <common>", "#include <common>\nvarying float vFFh; varying vec2 vFFp;")
      .replace("#include <begin_vertex>", "#include <begin_vertex>\nvFFh = position.y; vFFp = position.xz;");
    s.fragmentShader = s.fragmentShader
      .replace("#include <common>", "#include <common>\nvarying float vFFh; varying vec2 vFFp; uniform float uNight;")
      .replace("#include <map_fragment>", "float ffA = 0.0;\n#ifdef USE_MAP\n vec4 ffTexel = texture2D( map, vMapUv );\n ffA = ffTexel.a;\n#endif")
      .replace("#include <color_fragment>", "#if defined( USE_MAP ) && defined( USE_COLOR )\n diffuseColor.rgb = mix( vColor, ffTexel.rgb * diffuse, ffTexel.a );\n#elif defined( USE_COLOR )\n diffuseColor.rgb *= vColor;\n#endif" + (dropNoData ? "\n diffuseColor.a *= smoothstep( 0.05, 0.7, ffA );" : ""))
      .replace("#include <dithering_fragment>", `${NIGHT_GLSL}\n#include <dithering_fragment>`);
    if (rim) {
      s.fragmentShader = s.fragmentShader.replace("#include <fog_fragment>", `
        #if defined( USE_FOG ) && defined( USE_MAP )
          float ffRim = max( abs( vMapUv.x - 0.5 ), abs( vMapUv.y - 0.5 ) ) * 2.0;
          gl_FragColor.rgb = mix( gl_FragColor.rgb, fogColor * 0.6, smoothstep( 0.55, 0.93, ffRim ) ); // 0.6: the sky below the horizon
          gl_FragColor.a *= 1.0 - smoothstep( 0.84, 0.99, ffRim );
        #endif
        #include <fog_fragment>`);
    }
  };
  mat.customProgramCacheKey = () => `ring-blend-${rim ? "rim" : dropNoData ? "drop" : "std"}`;
  return mat;
}
