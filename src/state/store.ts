import { useSyncExternalStore } from 'react';
import { QueryResult } from '../shared/protocol';
import { AlertEvent, AlertRule, Chip, Deploy, Severity, ServiceId } from '../shared/types';
import { DEFAULTS, TabId } from '../engine/urlState';

export type IncidentStatus = 'investigating' | 'identified' | 'monitoring' | 'resolved';
export const STATUS_STEPS: IncidentStatus[] = ['investigating', 'identified', 'monitoring', 'resolved'];

export interface IncidentEvent {
  id: string;
  ts: number;
  kind: 'declared' | 'status' | 'note' | 'assign' | 'rollback' | 'severity';
  text: string;
}
export interface Incident {
  id: string;
  title: string;
  severity: Severity;
  status: IncidentStatus;
  responder: string;
  service: ServiceId;
  createdAt: number;
  resolvedAt: number | null;
  alertIds: string[];
  events: IncidentEvent[];
  checklist: Array<{ id: string; text: string; done: boolean }>;
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'alert' | 'success';
}
export interface SavedQuery {
  name: string;
  q: string;
}
export interface LogView {
  res: QueryResult;
  from: number;
  to: number;
  q: string;
}
export interface MissionState {
  open: boolean;
  minimized: boolean;
  done: Record<string, boolean>;
  flags: { chipFromRow: boolean; markerInspected: boolean; summaryCopied: boolean };
  celebrated: boolean;
  highlight: string | null;
}

export interface AppState {
  tab: TabId;
  seed: number;
  live: boolean;
  spanSec: number;
  from: number;
  to: number;
  q: string;
  chips: Chip[];
  logScale: boolean;

  loaded: boolean;
  progress: number;
  loadMs: number;
  liveTick: number;
  logView: LogView | null;
  rules: AlertRule[];
  alerts: AlertEvent[];
  incidents: Incident[];
  openIncidentId: string | null;
  editor: { rule: AlertRule; isNew: boolean } | null;
  palette: boolean;
  theme: 'dark' | 'light';
  toasts: Toast[];
  selectedLog: number | null;
  deployPop: Deploy | null;
  hoverService: string | null;
  saved: SavedQuery[];
  mission: MissionState;
  announce: string;
  missionAnnounce: string;
}

export const emptyMission = (): MissionState => ({
  open: true,
  minimized: false,
  done: {},
  flags: { chipFromRow: false, markerInspected: false, summaryCopied: false },
  celebrated: false,
  highlight: null,
});

export const initialState: AppState = {
  ...DEFAULTS,
  loaded: false,
  progress: 0,
  loadMs: 0,
  liveTick: 0,
  logView: null,
  rules: [],
  alerts: [],
  incidents: [],
  openIncidentId: null,
  editor: null,
  palette: false,
  theme: 'dark',
  toasts: [],
  selectedLog: null,
  deployPop: null,
  hoverService: null,
  saved: [],
  mission: emptyMission(),
  announce: '',
  missionAnnounce: '',
};

let state: AppState = initialState;
const listeners = new Set<() => void>();

export const getState = () => state;
export function setState(patch: Partial<AppState> | ((s: AppState) => Partial<AppState>)) {
  const p = typeof patch === 'function' ? patch(state) : patch;
  state = { ...state, ...p };
  listeners.forEach((l) => l());
}
export function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
export function useStore<T>(selector: (s: AppState) => T): T {
  return useSyncExternalStore(subscribe, () => selector(state));
}
