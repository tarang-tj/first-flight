// Named places to glide to. lat/lon is the place itself; the camera sits backM metres behind it along
// headingDeg at altM (metres above MSL), looking at it with pitchDeg (degrees looking down).
// elevM is the ground elevation of the place (MSL), used to check that the pose really frames it.
import { toLocal, fromLocal } from "../geo.js";

const D2R = Math.PI / 180;

export const PLACES = [
  { key: "renton", label: "Renton factory", lat: 47.497, lon: -122.215, elevM: 10, backM: 3500, altM: 440, headingDeg: 20, pitchDeg: 7,
    blurb: "Boeing builds the 737 at its Renton factory, beside Renton Municipal Airport (KRNT) on the south shore of Lake Washington." },
  { key: "everett", label: "Everett factory", lat: 47.928, lon: -122.277, elevM: 185, backM: 3200, altM: 480, headingDeg: 28, pitchDeg: 5.3,
    blurb: "The Boeing Everett factory at Paine Field (KPAE) is the largest building in the world by volume; the 767, 777 and 777X are built here." },
  { key: "bfi", label: "Boeing Field", lat: 47.53, lon: -122.302, elevM: 6, backM: 3500, altM: 440, headingDeg: 355, pitchDeg: 7,
    blurb: "King County International Airport (KBFI), known as Boeing Field, is where Boeing flight-tests and delivers many of its jets." },
  { key: "moses", label: "Moses Lake", lat: 47.2077, lon: -119.3197, elevM: 362, backM: 5000, altM: 890, headingDeg: 60, pitchDeg: 7,
    blurb: "Grant County International Airport at Moses Lake is where Boeing takes jets for flight testing over the open land of eastern Washington." },
  { key: "seattle", label: "Seattle", lat: 47.6062, lon: -122.3321, elevM: 50, backM: 6000, altM: 1000, headingDeg: 20, pitchDeg: 9,
    blurb: "Seattle sits between Puget Sound and Lake Washington, a few miles north of Boeing Field." },
  { key: "rainier", label: "Mt Rainier", lat: 46.8523, lon: -121.7603, elevM: 4392, backM: 40000, altM: 6500, headingDeg: 75, pitchDeg: 3,
    blurb: "Mount Rainier is the tallest peak in Washington at 14,410 feet, an active volcano about 60 miles south-east of Seattle." },
];

/** Camera pose {x,y,z,headingDeg,pitchDeg} (local frame) that frames a place. */
export function placePose(place) {
  const t = toLocal(place.lat, place.lon, place.elevM ?? 0), h = place.headingDeg * D2R, back = place.backM ?? 4000;
  const x = t.x - Math.sin(h) * back, z = t.z + Math.cos(h) * back;
  const ll = fromLocal(x, z); // altitude is MSL at the camera's own lat/lon, so earth curvature is accounted for
  return { x, y: toLocal(ll.lat, ll.lon, place.altM).y, z, headingDeg: place.headingDeg, pitchDeg: place.pitchDeg };
}
