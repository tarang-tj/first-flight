// Quality tier: "lite" for phones and low-memory devices, "full" otherwise. Pure so it can be unit tested.

/** env: { coarse:boolean, width:number, deviceMemory?:number }. */
export function pickTier({ coarse = false, width = 1280, deviceMemory } = {}) {
  if (coarse || width < 700 || (Number.isFinite(deviceMemory) && deviceMemory <= 4)) return "lite";
  return "full";
}

export function detectTier(override) {
  if (override === "full" || override === "lite") return override;
  try {
    return pickTier({
      coarse: !!(window.matchMedia && window.matchMedia("(pointer: coarse)").matches),
      width: Math.min(window.innerWidth || 1280, window.screen?.width || 1280),
      deviceMemory: navigator.deviceMemory,
    });
  } catch { return "full"; }
}

export const TIER_SETTINGS = {
  full: { dprCap: 2, anisotropy: 8 },
  lite: { dprCap: 1.5, anisotropy: 2 },
};
