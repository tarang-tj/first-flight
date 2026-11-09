// Month file store for the time machine: its own fetch (no shared cache that keeps every month for
// the life of the page), failures are never remembered (the next ensure retries), and parsed months
// are held in a small LRU so scrubbing across 22 months cannot grow memory without bound.

/** Fetch JSON; null on any failure (one warning). Nothing is cached here, so a later call retries. */
export async function fetchFresh(url, fetchImpl = globalThis.fetch?.bind(globalThis)) {
  try {
    const res = await fetchImpl(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } catch (err) {
    console.warn(`[sky] ${url} unavailable: ${err?.message || err}`);
    return null;
  }
}

export function createMonthStore({ base, load = fetchFresh, max = 6 } = {}) {
  const months = new Map(); // key -> flights[]; Map order is recency order, oldest first
  const inflight = new Map();
  const touch = (key) => { const v = months.get(key); months.delete(key); months.set(key, v); };
  return {
    get size() { return months.size; },
    keys: () => [...months.keys()],
    has: (key) => months.has(key),
    /** Parsed flights for a loaded month (marks it recently used), else undefined. */
    get(key) { if (!months.has(key)) return undefined; touch(key); return months.get(key); },
    /** Load one month (deduplicated). Resolves to the array, or null if the load failed (not cached). */
    fetch(key) {
      if (months.has(key)) { touch(key); return Promise.resolve(months.get(key)); }
      if (!inflight.has(key)) {
        inflight.set(key, load(`${base}/${key}.json`).then((d) => {
          inflight.delete(key);
          if (!Array.isArray(d)) return null;
          months.set(key, d);
          return d;
        }, () => { inflight.delete(key); return null; }));
      }
      return inflight.get(key);
    },
    /** Drop the least recently used months beyond `max`, never one in `keep`. */
    trim(keep = []) {
      const hold = new Set(keep);
      for (const k of [...months.keys()]) {
        if (months.size <= max) break;
        if (!hold.has(k)) months.delete(k);
      }
    },
  };
}
