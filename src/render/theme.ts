export interface ChartTheme {
  bg: string;
  grid: string;
  axis: string;
  text: string;
  textDim: string;
  panel: string;
  accent: string;
  danger: string;
  ok: string;
  warn: string;
}
let cached: ChartTheme | null = null;
export function getTheme(): ChartTheme {
  if (cached) return cached;
  const cs = getComputedStyle(document.documentElement);
  const v = (n: string, f: string) => cs.getPropertyValue(n).trim() || f;
  cached = {
    bg: v('--chart-bg', '#0f172a'),
    grid: v('--chart-grid', 'rgba(148,163,184,.14)'),
    axis: v('--chart-axis', 'rgba(148,163,184,.4)'),
    text: v('--text', '#e2e8f0'),
    textDim: v('--text-dim', '#94a3b8'),
    panel: v('--panel', '#111a2e'),
    accent: v('--accent', '#38bdf8'),
    danger: v('--danger', '#f87171'),
    ok: v('--ok', '#34d399'),
    warn: v('--warn', '#fbbf24'),
  };
  return cached;
}
if (typeof window !== 'undefined') window.addEventListener('pulse-theme', () => (cached = null));
