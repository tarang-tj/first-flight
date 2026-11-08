// One shared frame loop. Rides world.onFrame when the 3D world exists, else
// requestAnimationFrame, so counters and the UI still animate without a world.
// Callbacks get (dtSeconds, nowMs). Time is clamped so a hidden tab never jumps.

export function createTicker(world) {
  const subs = new Set();
  let last = performance.now();
  let raf = 0;
  const step = () => {
    const t = performance.now();
    const dt = Math.min(0.1, Math.max(0, (t - last) / 1000));
    last = t;
    for (const fn of [...subs]) {
      try { fn(dt, t); } catch (err) { console.warn(`[ticker] frame callback failed: ${err?.message || err}`); }
    }
  };
  if (typeof world?.onFrame === "function") {
    world.onFrame(step);
  } else {
    const loop = () => { step(); raf = requestAnimationFrame(loop); };
    raf = requestAnimationFrame(loop);
  }
  return {
    add(fn) { subs.add(fn); return () => subs.delete(fn); },
    stop() { subs.clear(); if (raf) cancelAnimationFrame(raf); },
  };
}
