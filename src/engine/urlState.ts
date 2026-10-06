/** Shareable view state <-> location.hash. Pure; no DOM access. */
import { Chip } from '../shared/types';

export type TabId = 'overview' | 'logs' | 'alerts' | 'incidents';
export const TABS: TabId[] = ['overview', 'logs', 'alerts', 'incidents'];

export interface ViewState {
  tab: TabId;
  seed: number;
  live: boolean;
  /** Visible span in seconds (live mode). */
  spanSec: number;
  from: number;
  to: number;
  q: string;
  chips: Chip[];
  logScale: boolean;
}

export const DEFAULTS: ViewState = {
  tab: 'overview',
  seed: 1,
  live: true,
  spanSec: 90 * 60,
  from: 0,
  to: 0,
  q: '',
  chips: [],
  logScale: false,
};

const encChip = (c: Chip) => `${c.neg ? '-' : ''}${c.field}:${encodeURIComponent(c.value)}`;
const decChip = (s: string): Chip | null => {
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  const i = body.indexOf(':');
  if (i <= 0) return null;
  try {
    return { field: body.slice(0, i), value: decodeURIComponent(body.slice(i + 1)), neg };
  } catch {
    return null;
  }
};

export function encodeState(s: ViewState): string {
  const p = new URLSearchParams();
  p.set('tab', s.tab);
  if (s.seed !== DEFAULTS.seed) p.set('seed', String(s.seed));
  if (s.live) p.set('span', String(Math.round(s.spanSec)));
  else {
    p.set('from', String(Math.round(s.from)));
    p.set('to', String(Math.round(s.to)));
  }
  if (s.q) p.set('q', s.q);
  if (s.chips.length) p.set('chips', s.chips.map(encChip).join(','));
  if (s.logScale) p.set('scale', 'log');
  return p.toString();
}

export function decodeState(hash: string): ViewState {
  const raw = hash.replace(/^#\/?/, '');
  const p = new URLSearchParams(raw);
  const out: ViewState = { ...DEFAULTS, chips: [] };
  const tab = p.get('tab');
  if (tab && (TABS as string[]).includes(tab)) out.tab = tab as TabId;
  const seed = Number(p.get('seed'));
  if (p.has('seed') && Number.isInteger(seed) && seed > 0 && seed < 1e6) out.seed = seed;
  const from = Number(p.get('from'));
  const to = Number(p.get('to'));
  if (p.has('from') && p.has('to') && isFinite(from) && isFinite(to) && to > from) {
    out.live = false;
    out.from = from;
    out.to = to;
  } else {
    out.live = true;
    const span = Number(p.get('span'));
    if (p.has('span') && isFinite(span) && span >= 5 && span <= 200_000) out.spanSec = span;
  }
  out.q = (p.get('q') ?? '').slice(0, 500);
  const chips = p.get('chips');
  if (chips) out.chips = chips.split(',').map(decChip).filter((c): c is Chip => !!c).slice(0, 12);
  out.logScale = p.get('scale') === 'log';
  return out;
}
