export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(max > min)) return [min];
  const raw = (max - min) / Math.max(1, count);
  const mag = 10 ** Math.floor(Math.log10(raw));
  const norm = raw / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const out: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(Math.abs(v) < step * 1e-9 ? 0 : v);
  return out;
}

const STEPS = [1, 2, 5, 10, 15, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 10800, 21600, 43200, 86400].map((s) => s * 1000);
export function timeTicks(from: number, to: number, maxTicks: number): { step: number; ticks: number[] } {
  const span = to - from;
  let step = STEPS[STEPS.length - 1];
  for (const s of STEPS) {
    if (span / s <= maxTicks) {
      step = s;
      break;
    }
  }
  const ticks: number[] = [];
  for (let t = Math.ceil(from / step) * step; t <= to; t += step) ticks.push(t);
  return { step, ticks };
}

const pad = (n: number) => String(n).padStart(2, '0');
export function tickLabel(t: number, step: number): string {
  const d = new Date(t);
  if (step >= 86400000) return `${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  const hm = `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
  return step < 60000 ? `${hm}:${pad(d.getUTCSeconds())}` : hm;
}

export function logTicks(lo: number, hi: number): number[] {
  // lo/hi are log10 exponents
  const out: number[] = [];
  const decades = hi - lo;
  for (let e = Math.floor(lo); e <= Math.ceil(hi); e++) {
    for (const m of decades <= 2 ? [1, 2, 5] : [1]) {
      const v = m * 10 ** e;
      const l = Math.log10(v);
      if (l >= lo - 1e-9 && l <= hi + 1e-9) out.push(v);
    }
  }
  return out;
}
