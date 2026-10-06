const pad = (n: number, w = 2) => String(n).padStart(w, '0');

export function fmtClock(ms: number, seconds = true): string {
  const d = new Date(ms);
  return `${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}${seconds ? ':' + pad(d.getUTCSeconds()) : ''}`;
}
export function fmtDateTime(ms: number): string {
  const d = new Date(ms);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${fmtClock(ms)} UTC`;
}
export function fmtDuration(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s}s`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m}m`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}
export function fmtNum(v: number, unit = ''): string {
  const a = Math.abs(v);
  let s: string;
  if (a >= 100000) s = `${(v / 1000).toFixed(0)}k`;
  else if (a >= 10000) s = `${(v / 1000).toFixed(1)}k`;
  else if (a >= 1000) s = v.toFixed(0);
  else if (a >= 100) s = v.toFixed(0);
  else if (a >= 10) s = v.toFixed(1);
  else s = v.toFixed(2);
  return unit ? `${s}${unit === '%' || unit === 'ms' ? '' : ' '}${unit}` : s;
}
