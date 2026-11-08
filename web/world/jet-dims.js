// True airframe dimensions (metres) per variant. Pure data plus the auto-scale rule.
// Sources: Boeing airplane characteristics sheets (737-8, 737-10, 767-300F, 777F, 777-9).

export const JET_DIMS = Object.freeze({
  "737-8": { length: 39.5, span: 35.9, fuselage: 3.76, engines: 2, engineDia: 2.0, sweep: 25, rootChord: 7.0, tipChord: 1.5, foldTips: false },
  "737-10": { length: 43.8, span: 35.9, fuselage: 3.76, engines: 2, engineDia: 2.0, sweep: 25, rootChord: 7.0, tipChord: 1.5, foldTips: false },
  "767": { length: 54.9, span: 47.6, fuselage: 5.03, engines: 2, engineDia: 2.8, sweep: 31, rootChord: 9.5, tipChord: 2.3, foldTips: false },
  "777F": { length: 63.7, span: 64.8, fuselage: 6.2, engines: 2, engineDia: 3.9, sweep: 31.6, rootChord: 13.0, tipChord: 2.7, foldTips: false },
  "777-9": { length: 76.7, span: 71.8, fuselage: 6.2, engines: 2, engineDia: 4.1, sweep: 32, rootChord: 13.0, tipChord: 2.7, foldTips: true },
});

/** Map a program string from the data files or UI ("737", "777X", "737-10"...) to a dims key. */
export function variantFor(program) {
  const p = String(program || "").toUpperCase().trim();
  if (JET_DIMS[p]) return p;
  if (p.startsWith("737")) return p.includes("10") ? "737-10" : "737-8";
  if (p.startsWith("767")) return "767";
  if (p === "777X" || p.startsWith("777-9") || p.startsWith("779")) return "777-9";
  if (p.startsWith("777")) return "777F";
  return "737-8";
}

/**
 * Auto-scale so a jet stays a readable size: it is true size when close, and grows linearly with
 * distance once it would subtend less than `minAngle` radians. Capped so it never balloons.
 */
export function autoScale(distanceM, lengthM, minAngle = 0.022, maxScale = 400) {
  if (!(distanceM > 0)) return 1;
  const needed = (distanceM * minAngle) / lengthM;
  return Math.min(maxScale, Math.max(1, needed));
}

export const HIGHLIGHT_COLORS = Object.freeze({
  test: 0xff6a1a,
  traffic: 0xbfd2e6,
  selected: 0xffffff,
});
