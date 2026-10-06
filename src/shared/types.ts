/** Domain constants and types shared by the worker, the engine and the UI. */

export const SERVICES = [
  'gateway',
  'auth',
  'checkout',
  'payments',
  'inventory',
  'search',
  'notifications',
  'orders-db',
] as const;
export type ServiceId = (typeof SERVICES)[number];

export const METRICS = ['rps', 'p50', 'p95', 'p99', 'err', 'cpu', 'mem', 'queue'] as const;
export type MetricId = (typeof METRICS)[number];

export interface MetricMeta {
  id: MetricId;
  label: string;
  unit: string;
  /** Hard upper bound when the metric is a percentage. */
  max?: number;
}

export const METRIC_META: Record<MetricId, MetricMeta> = {
  rps: { id: 'rps', label: 'Requests / sec', unit: 'req/s' },
  p50: { id: 'p50', label: 'Latency p50', unit: 'ms' },
  p95: { id: 'p95', label: 'Latency p95', unit: 'ms' },
  p99: { id: 'p99', label: 'Latency p99', unit: 'ms' },
  err: { id: 'err', label: 'Error rate', unit: '%', max: 100 },
  cpu: { id: 'cpu', label: 'CPU', unit: '%', max: 100 },
  mem: { id: 'mem', label: 'Memory', unit: '%', max: 100 },
  queue: { id: 'queue', label: 'Queue depth', unit: 'msgs' },
};

export const LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LevelId = (typeof LEVELS)[number];
export const REGIONS = ['us-east', 'us-west', 'eu', 'ap'] as const;
export const HOSTS_PER_SERVICE = 4;
export const HOSTS: string[] = SERVICES.flatMap((s) =>
  Array.from({ length: HOSTS_PER_SERVICE }, (_, i) => `${s}-${i + 1}`),
);

/** Directed call graph: caller -> callee. */
export const EDGES: ReadonlyArray<readonly [ServiceId, ServiceId]> = [
  ['gateway', 'auth'],
  ['gateway', 'checkout'],
  ['gateway', 'search'],
  ['checkout', 'payments'],
  ['checkout', 'inventory'],
  ['checkout', 'notifications'],
  ['checkout', 'orders-db'],
  ['payments', 'orders-db'],
  ['inventory', 'orders-db'],
  ['search', 'inventory'],
];

export const SERVICE_COLORS: Record<ServiceId, string> = {
  gateway: '#4e9be8',
  auth: '#b58af0',
  checkout: '#f0605d',
  payments: '#f2a33a',
  inventory: '#4fc3a1',
  search: '#d8c24a',
  notifications: '#e58fc0',
  'orders-db': '#8aa0b8',
};

/** Timeline. One sample per simulated second. */
export const STEP_MS = 1000;
export const HISTORY_POINTS = 100_800; // 28 hours of 1s samples per series
export const LIVE_CAPACITY = 40_000;
export const SERIES_CAPACITY = HISTORY_POINTS + LIVE_CAPACITY;
export const NOW0 = Date.UTC(2026, 5, 14, 14, 0, 0);
export const T0 = NOW0 - HISTORY_POINTS * STEP_MS;
/** Simulated seconds that pass per real second. */
export const SIM_SPEED = 4;

export const LOG_HISTORY = 240_000;
export const LOG_SPAN_MS = 6 * 3600 * 1000;
export const LOG_CAPACITY = 420_000;

export const seriesIndex = (svc: number, metric: number) => svc * METRICS.length + metric;
export const SERIES_COUNT = SERVICES.length * METRICS.length;

export type Severity = 'sev1' | 'sev2' | 'sev3';

export interface Deploy {
  id: string;
  ts: number;
  service: ServiceId;
  version: string;
  author: string;
  message: string;
  kind: 'deploy' | 'rollback';
}

export interface Scenario {
  seed: number;
  culprit: ServiceId;
  culpritDeployTs: number;
  burst: { service: ServiceId; start: number; end: number };
  leak: { service: ServiceId; start: number };
  deploys: Deploy[];
}

export interface AlertRule {
  id: string;
  name: string;
  metric: MetricId;
  service: ServiceId | 'any';
  op: '>' | '<';
  threshold: number;
  windowSec: number;
  severity: Severity;
  enabled: boolean;
  /** Start firing state from history (used for the pre-seeded rules). */
  backfill?: boolean;
  origin?: 'seed' | 'chart' | 'manual';
}

export interface AlertEvent {
  id: string;
  ruleId: string;
  ruleName: string;
  service: ServiceId;
  metric: MetricId;
  severity: Severity;
  op: '>' | '<';
  threshold: number;
  firedAt: number;
  resolvedAt: number | null;
  peak: number;
  incidentId?: string;
}

export interface Chip {
  field: string;
  value: string;
  neg: boolean;
}
