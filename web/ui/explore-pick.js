// Tap or click a jet in Explore. The canvas is NOT inside #ui-root, so listen on the document. On touch
// the look pad (.fly-look) covers the view, so those taps never reach main.js: open the airframe card here.
import { clear } from "./dom.js";
import { hexOfPickId } from "./format.js";

/** Returns a function that removes the listeners. onSelect(id) / onClear() are the explore-mode actions. */
export function attachPick({ world, ctx, chrome, onSelect, onClear }) {
  let down = null;
  const hit = (e) => e.target === world?.canvas || e.target.classList?.contains("fly-look");
  const onDown = (e) => { down = hit(e) ? [e.clientX, e.clientY] : null; };
  const onUp = (e) => {
    if (!down || Math.hypot(e.clientX - down[0], e.clientY - down[1]) > 6) return;
    down = null;
    let id = null;
    try { id = world.pick?.(e.clientX, e.clientY) ?? null; } catch { id = null; }
    const viaPad = e.target !== world?.canvas;
    if (id && id.startsWith("sky:")) { onSelect(id); if (viaPad) ctx.openAirframe?.(hexOfPickId(id)); }
    else if (!id) { onClear(); if (viaPad) clear(chrome.cardHost); }
  };
  document.addEventListener("pointerdown", onDown);
  document.addEventListener("pointerup", onUp);
  return () => { document.removeEventListener("pointerdown", onDown); document.removeEventListener("pointerup", onUp); };
}
