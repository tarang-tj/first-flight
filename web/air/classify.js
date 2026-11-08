// Is a live aircraft a Boeing production or test flight? A BOE callsign (Boeing's own flight-test
// and delivery-flight prefix) or a Boeing-owned airframe. Everything else is traffic.

const BOE_CALLSIGN = /^BOE\d/;
const BOEING_TEST_REG = /^N779X/; // 777X flight-test fleet registrations
const BOEING_OWNER = /\bBOEING\b/i;

export function isBoeCallsign(flight) {
  return BOE_CALLSIGN.test(String(flight ?? "").trim().toUpperCase());
}

/** @returns {"test"|"traffic"} */
export function classify(ac) {
  if (!ac || typeof ac !== "object") return "traffic";
  if (isBoeCallsign(ac.flight)) return "test";
  if (BOEING_OWNER.test(String(ac.ownOp ?? ""))) return "test";
  if (BOEING_TEST_REG.test(String(ac.r ?? "").toUpperCase())) return "test";
  return "traffic";
}

/** Map an ICAO type code to a modelled program; every other type draws as a 737. */
export function programFor(typeCode) {
  const t = String(typeCode ?? "").toUpperCase();
  if (t === "B779" || t === "B77X") return "777X";
  if (/^B76/.test(t)) return "767";
  if (/^B77/.test(t)) return "777";
  return "737";
}
