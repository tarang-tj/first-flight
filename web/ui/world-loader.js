// Load and start lane B's 3D world without ever throwing. Resolves
// { world|null, error|null, ready: Promise } so the UI works with no world.

const READY_TIMEOUT_MS = 20000;

export async function loadWorld(canvas) {
  let mod;
  try {
    mod = await import("../world/index.js");
  } catch (err) {
    console.warn(`[world] module unavailable: ${err?.message || err}`);
    return { world: null, error: "world module missing", ready: Promise.resolve() };
  }
  let done;
  const ready = new Promise((r) => { done = r; });
  const timer = setTimeout(() => { console.warn("[world] onReady did not fire in 20 s"); done(); }, READY_TIMEOUT_MS);
  try {
    const world = await mod.createWorld(canvas, { onReady: () => { clearTimeout(timer); done(); } });
    return { world, error: null, ready };
  } catch (err) {
    clearTimeout(timer);
    console.warn(`[world] createWorld failed: ${err?.message || err}`);
    return { world: null, error: String(err?.message || err), ready: Promise.resolve() };
  }
}
