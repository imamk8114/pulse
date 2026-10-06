/** Typed message protocol between the UI thread and the simulation worker. */
import { AlertRule, Chip, Scenario, ServiceId } from './types';
import { LogColumns } from './gen';

export type ToWorker =
  | { type: 'init'; seed: number; rules: AlertRule[] }
  | { type: 'setRules'; rules: AlertRule[] }
  | { type: 'rollback'; service: ServiceId }
  | { type: 'setSpeed'; paused: boolean }
  | {
      type: 'query';
      id: number;
      q: string;
      chips: Chip[];
      from: number;
      to: number;
      buckets: number;
    };

export interface WireAlert {
  kind: 'fire' | 'resolve';
  id: string;
  ruleId: string;
  service: ServiceId;
  t: number;
  value: number;
  /** Set for backfilled history so the UI can show the real start. */
  firedAt?: number;
}

export interface LogChunk {
  start: number;
  cols: { [K in keyof LogColumns]: LogColumns[K] };
}

export interface QueryResult {
  id: number;
  error: { message: string; start: number; end: number } | null;
  /** Ascending row indices that matched, within [from, to]. */
  matches: Uint32Array;
  scanned: number;
  matched: number;
  hist: Uint32Array;
  errHist: Uint32Array;
  /** Query time measured inside the worker with performance.now(). */
  ms: number;
}

export type FromWorker =
  | { type: 'ready'; scenario: Scenario; seed: number }
  | { type: 'progress'; fraction: number }
  | { type: 'series'; service: number; values: Float32Array[] }
  | { type: 'logs'; chunk: LogChunk }
  | { type: 'loaded'; historyCount: number; logCount: number; genMs: number }
  | { type: 'tick'; t: number; values: Float32Array; logs: LogChunk | null; alerts: WireAlert[] }
  | { type: 'backfill'; alerts: WireAlert[] }
  | { type: 'result'; result: QueryResult };
