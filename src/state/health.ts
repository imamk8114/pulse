import { lttb } from '../engine/downsample';
import { METRICS, SERVICES, ServiceId, seriesIndex } from '../shared/types';
import { data } from './data';

export type Status = 'healthy' | 'degraded' | 'critical';
export interface Health {
  service: ServiceId;
  status: Status;
  p95: number;
  p95Ratio: number;
  err: number;
  rps: number;
  cpu: number;
  mem: number;
  spark: string;
  reason: string;
}

const base = new Map<string, number>();
export function baselineP95(si: number): number {
  const key = `${data.scenario?.seed}-${si}`;
  let b = base.get(key);
  if (b == null) {
    const arr = data.series[seriesIndex(si, METRICS.indexOf('p95'))];
    const end = Math.max(1000, data.count - 3 * 3600);
    let sum = 0;
    let n = 0;
    for (let i = Math.max(0, end - 6 * 3600); i < end; i += 7) {
      sum += arr[i];
      n++;
    }
    b = n ? sum / n : 1;
    if (data.count > 50000) base.set(key, b);
  }
  return b;
}

const avgLast = (arr: Float32Array, n: number) => {
  let s = 0;
  const c = Math.min(n, data.count);
  for (let i = data.count - c; i < data.count; i++) s += arr[i];
  return c ? s / c : 0;
};

export function computeHealth(si: number): Health {
  const g = (m: string) => data.series[seriesIndex(si, METRICS.indexOf(m as (typeof METRICS)[number]))];
  const p95 = avgLast(g('p95'), 12);
  const err = avgLast(g('err'), 12);
  const cpu = avgLast(g('cpu'), 12);
  const mem = avgLast(g('mem'), 12);
  const rps = avgLast(g('rps'), 12);
  const ratio = p95 / baselineP95(si);
  let status: Status = 'healthy';
  let reason = 'All signals nominal';
  if (err >= 5 || ratio >= 3) {
    status = 'critical';
    reason = ratio >= 3 ? `p95 ${ratio.toFixed(1)}x baseline` : `error rate ${err.toFixed(1)}%`;
  } else if (err >= 1.5 || ratio >= 2 || mem >= 88 || cpu >= 85) {
    status = 'degraded';
    reason = mem >= 88 ? `memory ${mem.toFixed(0)}%` : ratio >= 2 ? `p95 ${ratio.toFixed(1)}x baseline` : err >= 1.5 ? `error rate ${err.toFixed(1)}%` : `cpu ${cpu.toFixed(0)}%`;
  }
  // sparkline: last 15 minutes of p95, LTTB to 56 points
  const arr = g('p95');
  const i1 = data.count;
  const i0 = Math.max(0, i1 - 900);
  const d = lttb(arr, i0, i1, 56);
  let mn = Infinity;
  let mx = -Infinity;
  for (const v of d.val) {
    if (v < mn) mn = v;
    if (v > mx) mx = v;
  }
  const rng = mx - mn || 1;
  const spark = d.val.map((v, k) => `${((k / Math.max(1, d.val.length - 1)) * 100).toFixed(1)},${(26 - ((v - mn) / rng) * 24 - 1).toFixed(1)}`).join(' ');
  return { service: SERVICES[si], status, p95, p95Ratio: ratio, err, rps, cpu, mem, spark, reason };
}
