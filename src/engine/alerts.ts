/** Pure alert evaluation shared by the worker (live) and the editor (preview). */
import { AlertRule } from '../shared/types';

export const violates = (op: '>' | '<', v: number, threshold: number) => (op === '>' ? v > threshold : v < threshold);

export interface RunState {
  /** Start time of the current continuous violation, or null. */
  since: number | null;
  firing: boolean;
  peak: number;
  firedAt: number | null;
}
export const freshRun = (): RunState => ({ since: null, firing: false, peak: 0, firedAt: null });

export type Transition = 'fire' | 'resolve' | null;

/**
 * Advance one sample. A rule fires once the condition has held continuously for windowSec,
 * and resolves on the first sample where it no longer holds.
 */
export function stepRun(rs: RunState, rule: Pick<AlertRule, 'op' | 'threshold' | 'windowSec'>, tMs: number, v: number): Transition {
  if (violates(rule.op, v, rule.threshold)) {
    if (rs.since == null) {
      rs.since = tMs;
      rs.peak = v;
    } else rs.peak = rule.op === '>' ? Math.max(rs.peak, v) : Math.min(rs.peak, v);
    if (!rs.firing && tMs - rs.since >= rule.windowSec * 1000) {
      rs.firing = true;
      rs.firedAt = tMs;
      return 'fire';
    }
    return null;
  }
  const wasFiring = rs.firing;
  rs.since = null;
  rs.firing = false;
  if (wasFiring) return 'resolve';
  return null;
}

export interface FiringInterval {
  start: number;
  end: number | null;
  peak: number;
}

/** Replays a series window through stepRun; used for the live preview and for backfill. */
export function evaluateSeries(
  values: ArrayLike<number>,
  t0: number,
  step: number,
  count: number,
  fromMs: number,
  toMs: number,
  rule: Pick<AlertRule, 'op' | 'threshold' | 'windowSec'>,
): FiringInterval[] {
  const warm = Math.ceil((rule.windowSec * 1000) / step) + 2;
  const i0 = Math.max(0, Math.floor((fromMs - t0) / step) - warm);
  const i1 = Math.min(count, Math.ceil((toMs - t0) / step) + 1);
  const rs = freshRun();
  const out: FiringInterval[] = [];
  let cur: FiringInterval | null = null;
  for (let i = i0; i < i1; i++) {
    const t = t0 + i * step;
    const tr = stepRun(rs, rule, t, values[i]);
    if (tr === 'fire') {
      cur = { start: t, end: null, peak: rs.peak };
      out.push(cur);
    } else if (rs.firing && cur) {
      cur.peak = rule.op === '>' ? Math.max(cur.peak, values[i]) : Math.min(cur.peak, values[i]);
    } else if (tr === 'resolve' && cur) {
      cur.end = t;
      cur = null;
    }
  }
  return out.filter((iv) => (iv.end ?? Infinity) >= fromMs && iv.start <= toMs);
}
