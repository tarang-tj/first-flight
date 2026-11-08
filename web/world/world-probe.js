// Screen-space helpers on a world: project(), pick() and the boot probe litFraction().
import * as THREE from "three";

export function attachProbe(world, { renderer, scene, camera, canvas, jets }) {
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
  world.disposeProbe = () => probe.dispose();
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
}
