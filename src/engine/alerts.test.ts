import { describe, expect, it } from 'vitest';
import { evaluateSeries, freshRun, stepRun } from './alerts';

const rule = { op: '>' as const, threshold: 10, windowSec: 3 };

describe('stepRun', () => {
  it('fires only after the condition held for the whole window, resolves on first clear sample', () => {
    const rs = freshRun();
    const out: Array<string | null> = [];
    const vals = [5, 11, 12, 13, 14, 15, 3, 20, 4];
    vals.forEach((v, i) => out.push(stepRun(rs, rule, i * 1000, v)));
    expect(out).toEqual([null, null, null, null, 'fire', null, 'resolve', null, null]);
  });
  it('a dip resets the window', () => {
    const rs = freshRun();
    const seq = [11, 11, 5, 11, 11, 11].map((v, i) => stepRun(rs, rule, i * 1000, v));
    expect(seq).toEqual([null, null, null, null, null, null]);
    expect(stepRun(rs, rule, 6000, 11)).toBe('fire');
  });
  it('supports the below operator and tracks the peak', () => {
    const rs = freshRun();
    const r = { op: '<' as const, threshold: 50, windowSec: 2 };
    [40, 30, 20, 10].forEach((v, i) => stepRun(rs, r, i * 1000, v));
    expect(rs.firing).toBe(true);
    expect(rs.peak).toBe(10);
  });
});

describe('evaluateSeries (preview) agrees with the live stepper', () => {
  it('produces the same firing intervals', () => {
    const vals = new Float32Array(200);
    for (let i = 0; i < 200; i++) vals[i] = i % 50 > 30 ? 15 : 2;
    const iv = evaluateSeries(vals, 0, 1000, 200, 0, 200_000, rule);
    // replay with the incremental stepper
    const rs = freshRun();
    const live: number[] = [];
    for (let i = 0; i < 200; i++) if (stepRun(rs, rule, i * 1000, vals[i]) === 'fire') live.push(i * 1000);
    expect(iv.map((x) => x.start)).toEqual(live);
    expect(iv.length).toBeGreaterThan(2);
    expect(iv[0].end).not.toBeNull();
  });
  it('only returns intervals overlapping the requested range', () => {
    const vals = new Float32Array(100).fill(1);
    for (let i = 10; i < 20; i++) vals[i] = 50;
    expect(evaluateSeries(vals, 0, 1000, 100, 40_000, 90_000, rule)).toEqual([]);
    expect(evaluateSeries(vals, 0, 1000, 100, 0, 90_000, rule)).toHaveLength(1);
  });
});
