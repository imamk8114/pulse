import { describe, expect, it } from 'vitest';
import { createDecimated, lttb, minMaxBucket } from './downsample';
import { mulberry32 } from '../shared/prng';

function series(n: number, seed = 1) {
  const r = mulberry32(seed);
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = 50 + Math.sin(i / 300) * 20 + r() * 5;
  // a few hard spikes and dips that must never be lost
  a[Math.floor(n * 0.31)] = 900;
  a[Math.floor(n * 0.62)] = -40;
  return a;
}

describe('minMaxBucket', () => {
  it('bounds the output and preserves global min and max', () => {
    const n = 120_000;
    const a = series(n);
    for (const buckets of [50, 400, 1200]) {
      const d = minMaxBucket(a, 0, n, buckets, createDecimated(8));
      expect(d.length).toBeLessThanOrEqual(buckets * 2 + 2);
      const vals = Array.from(d.val.subarray(0, d.length));
      expect(Math.max(...vals)).toBe(Math.max(...a));
      expect(Math.min(...vals)).toBe(Math.min(...a));
    }
  });
  it('keeps indices ascending, in range, and endpoints present', () => {
    const a = series(10_000, 3);
    const d = minMaxBucket(a, 1000, 9000, 300, createDecimated(8));
    expect(d.idx[0]).toBe(1000);
    expect(d.idx[d.length - 1]).toBe(8999);
    for (let i = 1; i < d.length; i++) expect(d.idx[i]).toBeGreaterThanOrEqual(d.idx[i - 1]);
    for (let i = 0; i < d.length; i++) expect(a[d.idx[i]]).toBe(d.val[i]);
  });
  it('preserves the extremes of every bucket window', () => {
    const n = 5000;
    const a = series(n, 9);
    const buckets = 100;
    const d = minMaxBucket(a, 0, n, buckets, createDecimated(8));
    const size = n / buckets;
    for (let b = 0; b < buckets; b++) {
      const s = Math.floor(b * size);
      const e = Math.floor((b + 1) * size);
      const w = a.subarray(s, e);
      const inWin = Array.from({ length: d.length }, (_, k) => k).filter((k) => d.idx[k] >= s && d.idx[k] < e).map((k) => d.val[k]);
      expect(Math.max(...inWin)).toBe(Math.max(...w));
      expect(Math.min(...inWin)).toBe(Math.min(...w));
    }
  });
  it('returns raw samples when there are fewer than output slots, and handles empty input', () => {
    const a = new Float32Array([1, 2, 3, 4, 5]);
    const d = minMaxBucket(a, 0, 5, 100, createDecimated(8));
    expect(Array.from(d.val.subarray(0, d.length))).toEqual([1, 2, 3, 4, 5]);
    expect(minMaxBucket(a, 3, 3, 10, createDecimated(8)).length).toBe(0);
  });
});

describe('lttb', () => {
  it('bounds output to the threshold, keeps endpoints, ascending indices', () => {
    const a = series(50_000, 5);
    const r = lttb(a, 0, a.length, 200);
    expect(r.idx.length).toBe(200);
    expect(r.idx[0]).toBe(0);
    expect(r.idx[199]).toBe(a.length - 1);
    for (let i = 1; i < r.idx.length; i++) expect(r.idx[i]).toBeGreaterThan(r.idx[i - 1]);
  });
  it('keeps the dominant spike', () => {
    const a = series(50_000, 5);
    const r = lttb(a, 0, a.length, 300);
    expect(Math.max(...r.val)).toBe(900);
  });
  it('passes small inputs through', () => {
    expect(lttb(new Float32Array([1, 2, 3]), 0, 3, 10).idx).toEqual([0, 1, 2]);
  });
});
