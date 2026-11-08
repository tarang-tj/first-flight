// Sim clock for the time machine. Unix seconds, a rate multiplier, play/pause, clamped to the data span.
// Pure: no DOM, no timers. The caller feeds it real elapsed seconds via tick().

export const RATES = Object.freeze([1, 60, 600, 3600, 86400]);
export const RATE_LABELS = Object.freeze({ 1: "1x", 60: "60x", 600: "600x", 3600: "3600x", 86400: "1 day/s" });

export function createSkyClock({ span, t, rate = 1, playing = true } = {}) {
  if (!Array.isArray(span) || !(span[1] > span[0])) throw new Error("sky clock needs span [t0, t1]");
  const [lo, hi] = span;
  const clamp = (x) => Math.min(hi, Math.max(lo, x));
  const state = { t: clamp(Number.isFinite(t) ? t : hi), rate: RATES.includes(rate) ? rate : 1, playing: !!playing };
  return {
    span: [lo, hi],
    get t() { return state.t; },
    get rate() { return state.rate; },
    get playing() { return state.playing; },
    /** Advance by dtReal real seconds. Pauses itself when it reaches the end of the data. */
    tick(dtReal) {
      if (!state.playing || !(dtReal > 0)) return state.t;
      state.t = clamp(state.t + dtReal * state.rate);
      if (state.t >= hi) state.playing = false;
      return state.t;
    },
    set(x) { if (Number.isFinite(x)) state.t = clamp(x); return state.t; },
    setRate(r) { if (RATES.includes(r)) state.rate = r; return state.rate; },
    play() { if (state.t >= hi) state.t = lo; state.playing = true; },
    pause() { state.playing = false; },
    toggle() { if (state.playing) this.pause(); else this.play(); return state.playing; },
  };
}
