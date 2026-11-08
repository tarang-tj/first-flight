// Web-Mercator tile math (pure). "World coords" u,v are normalised mercator, 0..1 across the planet.

export const lonToU = (lon) => (lon + 180) / 360;
export const latToV = (lat) => {
  const s = Math.sin((lat * Math.PI) / 180);
  return 0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI);
};
export const uToLon = (u) => u * 360 - 180;
export const vToLat = (v) => (Math.atan(Math.sinh(Math.PI * (1 - 2 * v))) * 180) / Math.PI;

/** Integer tile x,y containing lat/lon at zoom z. */
export function tileXY(lat, lon, z) {
  const n = 2 ** z;
  return { x: Math.floor(lonToU(lon) * n), y: Math.floor(latToV(lat) * n) };
}

export const terrariumUrl = (z, x, y) => `https://s3.amazonaws.com/elevation-tiles-prod/terrarium/${z}/${x}/${y}.png`;
export const usgsUrl = (z, x, y) => `https://basemap.nationalmap.gov/arcgis/rest/services/USGSImageryOnly/MapServer/tile/${z}/${y}/${x}`;

/** Terrarium RGB to metres. */
export const decodeTerrarium = (r, g, b) => r * 256 + g + b / 256 - 32768;

/** World-rect of an n x n block of tiles at zoom z starting at tile (x0, y0). */
export function blockRect(z, x0, y0, n) {
  const s = 2 ** z;
  return { u0: x0 / s, v0: y0 / s, u1: (x0 + n) / s, v1: (y0 + n) / s };
}

/** Block of n x n tiles at zoom z centred (as near as possible) on lat/lon. */
export function centeredBlock(lat, lon, z, n) {
  const c = tileXY(lat, lon, z);
  return { z, n, x0: c.x - Math.floor((n - 1) / 2), y0: c.y - Math.floor((n - 1) / 2) };
}

/** Tile ranges (inclusive) at zoom dz that cover a world rect. */
export function tilesCovering(rect, dz) {
  const s = 2 ** dz;
  return { x0: Math.floor(rect.u0 * s), x1: Math.ceil(rect.u1 * s) - 1, y0: Math.floor(rect.v0 * s), y1: Math.ceil(rect.v1 * s) - 1 };
}

/** Bilinear sample of a stitched heightfield. Field covers tiles [x0..] x [y0..] at zoom dz, 256 px each. */
export function sampleField(field, u, v) {
  const s = 2 ** field.z * 256;
  const px = u * s - field.x0 * 256 - 0.5, py = v * s - field.y0 * 256 - 0.5;
  const ix = Math.min(field.w - 2, Math.max(0, Math.floor(px))), iy = Math.min(field.h - 2, Math.max(0, Math.floor(py)));
  const fx = Math.min(1, Math.max(0, px - ix)), fy = Math.min(1, Math.max(0, py - iy));
  const d = field.data, w = field.w;
  const a = d[iy * w + ix], b = d[iy * w + ix + 1], c = d[(iy + 1) * w + ix], e = d[(iy + 1) * w + ix + 1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + e * fx) * fy;
}
