// Live feed state shared by every mode, and the data-age badge text. The badge is
// refreshed every second so "3 s ago" keeps counting even between polls.

export function badgeText(status, ageS) {
  if (status === "live") return `live, ${ageS} s ago`;
  if (status === "stale") return `live feed stale: last update ${ageS} s ago`;
  return "live feed offline: showing recorded flights";
}

export function createLiveState(setBadge) {
  const state = {
    status: "offline", ac: [], fetchedAt: 0,
    listeners: new Set(),
    subscribe(fn) { state.listeners.add(fn); return () => state.listeners.delete(fn); },
    onUpdate(ac, meta) {
      state.ac = ac;
      state.fetchedAt = meta.fetchedAt;
      for (const fn of [...state.listeners]) {
        try { fn(ac, meta.fetchedAt); } catch (err) { console.warn(`[live] listener failed: ${err?.message || err}`); }
      }
      paint();
    },
    onStatus(s) { state.status = s; paint(); },
  };
  function paint() {
    const age = state.fetchedAt ? Math.max(0, Math.round((Date.now() - state.fetchedAt) / 1000)) : 0;
    setBadge(state.status, badgeText(state.status, age));
  }
  paint();
  setInterval(paint, 1000);
  return state;
}
