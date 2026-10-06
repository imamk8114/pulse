/** "Traces-lite": a deterministic span tree derived from a log row's trace id. */
import { mulberry32 } from '../shared/prng';
import { EDGES, ServiceId } from '../shared/types';

export interface Span {
  service: ServiceId;
  start: number;
  duration: number;
  depth: number;
}

export function buildTrace(traceId: number, root: ServiceId, totalMs: number, slow?: ServiceId): Span[] {
  const r = mulberry32(traceId || 1);
  const spans: Span[] = [];
  const walk = (svc: ServiceId, start: number, dur: number, depth: number) => {
    spans.push({ service: svc, start, duration: dur, depth });
    if (depth >= 3) return;
    const kids = EDGES.filter((e) => e[0] === svc).map((e) => e[1]);
    const picked = kids.filter(() => r() < 0.75).slice(0, 3);
    if (!picked.length) return;
    let cursor = start + dur * 0.06;
    const room = dur * 0.88;
    const weights = picked.map((k) => (k === slow ? 3.5 : 0.6 + r()));
    const wsum = weights.reduce((a, b) => a + b, 0);
    picked.forEach((k, i) => {
      const d = (room * weights[i]) / wsum;
      walk(k, cursor, d * 0.96, depth + 1);
      cursor += d;
    });
  };
  walk(root, 0, Math.max(1, totalMs), 0);
  return spans;
}
