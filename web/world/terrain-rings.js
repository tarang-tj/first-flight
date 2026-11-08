// Ring layout per quality tier. "full" is the desktop look (about 165 MB of textures); "lite" drops the
// wide ring and shrinks every canvas for phones (about a third of the texture memory).
import { centeredBlock } from "./tile-math.js";

export const CENTER = { lat: 47.9121, lon: -122.2816 };

// "apron" is the outermost ring (about 800 km across): the world rim fades out inside it, far from any camera.
// z = imagery zoom, n = tiles per side; demZ = elevation zoom. Imagery everywhere (USGS serves low zooms
// globally, checked 2026-11-08 over Canada and the Pacific); elevation colours are only the fallback.
const FULL = [
  { name: "apron", z: 7, block: centeredBlock(47.5, -122.0, 7, 8), demZ: 6, grid: 280, drop: 1300, skirt: 1500 },
  { name: "far", z: 9, block: centeredBlock(47.5, -121.2, 9, 10), demZ: 8, grid: 560, drop: 260, skirt: 600 },
  { name: "wide", z: 11, block: centeredBlock(47.7, -122.2, 11, 8), demZ: 9, grid: 220, drop: 90, skirt: 300 },
  { name: "mid", z: 12, block: centeredBlock(47.7, -122.25, 12, 10), demZ: 10, grid: 150, drop: 40, skirt: 150 },
  { name: "south", z: 14, block: centeredBlock(47.51, -122.25, 14, 8), demZ: 12, grid: 130, drop: 12, skirt: 50 }, // Renton + Boeing Field: test-flight bases get detail too
  { name: "near", z: 14, block: centeredBlock(CENTER.lat, CENTER.lon, 14, 8), demZ: 12, grid: 150, drop: 12, skirt: 50 },
  { name: "core", z: 16, block: centeredBlock(CENTER.lat, CENTER.lon, 16, 12), demZ: 14, grid: 130, drop: 0, skirt: 15 },
];

const LITE = [
  { name: "apron", z: 7, block: centeredBlock(47.5, -122.0, 7, 6), demZ: 6, grid: 200, drop: 1300, skirt: 1500 },
  { name: "far", z: 9, block: centeredBlock(47.5, -121.7, 9, 8), demZ: 8, grid: 360, drop: 260, skirt: 600 },
  { name: "mid", z: 12, block: centeredBlock(47.7, -122.25, 12, 6), demZ: 10, grid: 110, drop: 40, skirt: 150 },
  { name: "near", z: 14, block: centeredBlock(CENTER.lat, CENTER.lon, 14, 5), demZ: 12, grid: 110, drop: 12, skirt: 50 },
  { name: "core", z: 16, block: centeredBlock(CENTER.lat, CENTER.lon, 16, 7), demZ: 14, grid: 110, drop: 0, skirt: 15 },
];

export const ringsFor = (tier) => (tier === "lite" ? LITE : FULL);
