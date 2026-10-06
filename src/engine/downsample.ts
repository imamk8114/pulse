/**
 * Downsampling for uniformly sampled series (x = t0 + i * step), so we only track indices.
 *
 * minMaxBucket: per pixel-bucket keep the min and the max, emitted in index order. Spikes can
 * never be lost, which is what an observability chart must guarantee. Output <= 2*buckets + 2.
 * lttb: Largest-Triangle-Three-Buckets, a shape-preserving alternative for sparklines.
 */
export interface Decimated {
  /** Sample indices, ascending. */
  idx: Float64Array;
  val: Float32Array;
  length: number;
}

export function createDecimated(capacity: number): Decimated {
  return { idx: new Float64Array(capacity), val: new Float32Array(capacity), length: 0 };
}

/** i0 inclusive, i1 exclusive. Writes into out (grown if needed) and returns it. */
export function minMaxBucket(values: ArrayLike<number>, i0: number, i1: number, buckets: number, out: Decimated): Decimated {
  const n = i1 - i0;
  const need = Math.max(buckets * 2 + 4, 8);
  if (out.idx.length < need && n > need) {
    out.idx = new Float64Array(need);
    out.val = new Float32Array(need);
  }
  if (n <= 0) {
    out.length = 0;
    return out;
  }
  if (n <= Math.max(buckets * 2, 2)) {
    // Fewer samples than output slots: no decimation needed.
    if (out.idx.length < n) {
      out.idx = new Float64Array(n);
      out.val = new Float32Array(n);
    }
    for (let k = 0; k < n; k++) {
      out.idx[k] = i0 + k;
      out.val[k] = values[i0 + k];
    }
    out.length = n;
    return out;
  }
  let o = 0;
  out.idx[o] = i0;
  out.val[o++] = values[i0];
  const size = n / buckets;
  for (let b = 0; b < buckets; b++) {
    const s = i0 + Math.floor(b * size);
    const e = Math.min(i1, i0 + Math.floor((b + 1) * size));
    if (e <= s) continue;
    let mn = Infinity;
    let mx = -Infinity;
    let imn = s;
    let imx = s;
    for (let i = s; i < e; i++) {
      const v = values[i];
      if (v < mn) {
        mn = v;
        imn = i;
      }
      if (v > mx) {
        mx = v;
        imx = i;
      }
    }
    if (imn === imx) {
      out.idx[o] = imn;
      out.val[o++] = mn;
    } else if (imn < imx) {
      out.idx[o] = imn;
      out.val[o++] = mn;
      out.idx[o] = imx;
      out.val[o++] = mx;
    } else {
      out.idx[o] = imx;
      out.val[o++] = mx;
      out.idx[o] = imn;
      out.val[o++] = mn;
    }
  }
  out.idx[o] = i1 - 1;
  out.val[o++] = values[i1 - 1];
  out.length = o;
  return out;
}

/** LTTB. Returns up to `threshold` points as {idx, val}. */
export function lttb(values: ArrayLike<number>, i0: number, i1: number, threshold: number): { idx: number[]; val: number[] } {
  const n = i1 - i0;
  const idx: number[] = [];
  const val: number[] = [];
  if (n <= 0) return { idx, val };
  if (threshold >= n || threshold < 3) {
    for (let i = i0; i < i1; i++) {
      idx.push(i);
      val.push(values[i]);
    }
    return { idx, val };
  }
  const every = (n - 2) / (threshold - 2);
  let a = i0;
  idx.push(a);
  val.push(values[a]);
  for (let i = 0; i < threshold - 2; i++) {
    // average of next bucket
    const ns = i0 + Math.floor((i + 1) * every) + 1;
    const ne = Math.min(i0 + Math.floor((i + 2) * every) + 1, i1);
    let ax = 0;
    let ay = 0;
    const len = Math.max(1, ne - ns);
    for (let j = ns; j < Math.min(ne, i1); j++) {
      ax += j;
      ay += values[j];
    }
    ax /= len;
    ay /= len;
    const rs = i0 + Math.floor(i * every) + 1;
    const re = i0 + Math.floor((i + 1) * every) + 1;
    let best = -1;
    let bi = rs;
    for (let j = rs; j < re; j++) {
      const area = Math.abs((a - ax) * (values[j] - values[a]) - (a - j) * (ay - values[a]));
      if (area > best) {
        best = area;
        bi = j;
      }
    }
    idx.push(bi);
    val.push(values[bi]);
    a = bi;
  }
  idx.push(i1 - 1);
  val.push(values[i1 - 1]);
  return { idx, val };
}
