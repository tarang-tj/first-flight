// Pure buffer builder for the trail renderer. Every trail becomes a camera-facing ribbon, all trails
// share one set of typed arrays (one draw call). Each ribbon vertex carries:
//   position (this point), other (neighbour point), along (0..1 of this trail), side (-1/+1 across the
//   ribbon), end (0 = segment start, 1 = segment end), trail (index, for per-trail controls).

/** points: [{x,y,z}] ; returns cumulative distances normalised to 0..1 (all 0 for a degenerate trail). */
export function alongValues(points) {
  const out = new Float32Array(points.length);
  let total = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1], b = points[i];
    total += Math.hypot(b.x - a.x, b.y - a.y, b.z - a.z);
    out[i] = total;
  }
  if (total > 0) for (let i = 0; i < out.length; i++) out[i] /= total;
  return out;
}

/**
 * trails: [{ points:[{x,y,z}], color:[r,g,b] }]. Returns typed arrays plus per-trail vertex ranges
 * ([start, count] in vertices) so a handle can rewrite just its own control values.
 */
export function mergeTrails(trails) {
  let segs = 0;
  for (const t of trails) segs += Math.max(0, t.points.length - 1);
  const nv = segs * 4;
  const position = new Float32Array(nv * 3), other = new Float32Array(nv * 3);
  const along = new Float32Array(nv), side = new Float32Array(nv), end = new Float32Array(nv);
  const trail = new Float32Array(nv), color = new Float32Array(nv * 3);
  const index = new Uint32Array(segs * 6);
  const ranges = [];
  let v = 0, ii = 0;
  trails.forEach((t, ti) => {
    const p = t.points, al = alongValues(p), start = v;
    for (let s = 0; s < p.length - 1; s++) {
      const a = p[s], b = p[s + 1];
      for (let k = 0; k < 4; k++) {
        const isEnd = k >> 1, sd = k & 1 ? 1 : -1; // k: 0 start-, 1 start+, 2 end-, 3 end+
        const me = isEnd ? b : a, nb = isEnd ? a : b;
        position.set([me.x, me.y, me.z], (v + k) * 3);
        other.set([nb.x, nb.y, nb.z], (v + k) * 3);
        along[v + k] = al[s + isEnd];
        side[v + k] = sd;
        end[v + k] = isEnd;
        trail[v + k] = ti;
        color.set(t.color, (v + k) * 3);
      }
      index.set([v, v + 1, v + 2, v + 1, v + 3, v + 2], ii);
      ii += 6;
      v += 4;
    }
    ranges.push([start, v - start]);
  });
  return { position, other, along, side, end, trail, color, index, ranges, vertexCount: nv };
}
