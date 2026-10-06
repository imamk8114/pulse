/**
 * Deterministic simulation kernels. Everything is a function of (seed, time, rollbacks),
 * so the same seed always tells the same story and nothing here touches Math.random.
 */
import { gauss, mulberry32 } from './prng';
import { TEMPLATES } from './logTemplates';
import {
  HOSTS_PER_SERVICE,
  LOG_HISTORY,
  LOG_SPAN_MS,
  METRICS,
  NOW0,
  Scenario,
  SERVICES,
  ServiceId,
  STEP_MS,
  T0,
} from './types';

interface Base {
  rps: number;
  p50: number;
  cpu: number;
  mem: number;
  queue: number;
}
export const BASE: Record<ServiceId, Base> = {
  gateway: { rps: 1800, p50: 22, cpu: 38, mem: 52, queue: 6 },
  auth: { rps: 900, p50: 12, cpu: 31, mem: 44, queue: 3 },
  checkout: { rps: 420, p50: 85, cpu: 42, mem: 58, queue: 9 },
  payments: { rps: 310, p50: 140, cpu: 36, mem: 49, queue: 7 },
  inventory: { rps: 520, p50: 30, cpu: 34, mem: 55, queue: 5 },
  search: { rps: 1200, p50: 45, cpu: 47, mem: 51, queue: 11 },
  notifications: { rps: 260, p50: 60, cpu: 24, mem: 41, queue: 38 },
  'orders-db': { rps: 2400, p50: 4, cpu: 44, mem: 62, queue: 14 },
};
const P95_RATIO = 2.6;
const P99_RATIO = 4.3;

export type Fixes = Partial<Record<ServiceId, number>>;

export interface Fx {
  lat: number;
  tail: number;
  errAdd: number;
  cpuAdd: number;
  memAdd: number;
  queueMul: number;
  rpsMul: number;
}

const clamp01 = (x: number) => (x < 0 ? 0 : x > 1 ? 1 : x);
const smooth = (x: number) => {
  const c = clamp01(x);
  return c * c * (3 - 2 * c);
};

import { EDGES } from './types';
const CALLERS: Record<string, ServiceId[]> = {};
const CALLEES: Record<string, ServiceId[]> = {};
for (const [a, b] of EDGES) {
  (CALLERS[b] ??= []).push(a);
  (CALLEES[a] ??= []).push(b);
}

const ONE: Fx = { lat: 1, tail: 1, errAdd: 0, cpuAdd: 0, memAdd: 0, queueMul: 1, rpsMul: 1 };

export function effects(svc: ServiceId, tMs: number, sc: Scenario, fixes: Fixes): Fx {
  const fx: Fx = { ...ONE };
  // 1. Latency spike + errors after the bad deploy, with a rollback recovery.
  const fixTs = fixes[sc.culprit];
  const recov = fixTs == null || tMs < fixTs ? 1 : Math.exp(-(tMs - fixTs) / 45_000);
  const e = smooth((tMs - sc.culpritDeployTs) / 90_000) * recov;
  if (e > 0) {
    if (svc === sc.culprit) {
      fx.lat *= 1 + 0.9 * e;
      fx.tail *= 1 + 2.2 * e;
      fx.errAdd += 9 * e;
      fx.cpuAdd += 24 * e;
      fx.queueMul *= 1 + 6 * e;
      fx.rpsMul *= 1 - 0.15 * e;
    } else if (CALLERS[sc.culprit]?.includes(svc)) {
      fx.lat *= 1 + 0.15 * e;
      fx.tail *= 1 + 0.9 * e;
      fx.errAdd += 1.8 * e;
      fx.queueMul *= 1 + 0.8 * e;
    } else if (CALLEES[sc.culprit]?.includes(svc)) {
      fx.queueMul *= 1 + 0.35 * e;
      fx.cpuAdd += 3 * e;
    }
  }
  // 2. Error burst on another service (bell curve).
  if (svc === sc.burst.service && tMs > sc.burst.start && tMs < sc.burst.end) {
    const x = (tMs - sc.burst.start) / (sc.burst.end - sc.burst.start);
    const b = Math.sin(Math.PI * x) ** 2;
    fx.errAdd += 14 * b;
    fx.tail *= 1 + 0.7 * b;
    fx.rpsMul *= 1 - 0.1 * b;
  }
  // 3. Slow memory leak ramp.
  if (svc === sc.leak.service && tMs > sc.leak.start) {
    const x = clamp01((tMs - sc.leak.start) / (NOW0 + 20 * 60_000 - sc.leak.start));
    fx.memAdd += 44 * x;
    fx.cpuAdd += 9 * x * x;
    fx.tail *= 1 + 0.25 * x * x;
  }
  return fx;
}

const dayFactor = (tMs: number) => {
  const h = ((tMs / 3_600_000) % 24 + 24) % 24;
  return 1 + 0.28 * Math.sin(((h - 9) / 24) * Math.PI * 2);
};

/** Per-service sequential generator. Noise is AR(1) so charts look organic, not like white noise. */
export class ServiceGen {
  private rng: () => number;
  private n1 = 0;
  private n2 = 0;
  private n3 = 0;
  constructor(public readonly idx: number, private sc: Scenario, seed: number) {
    this.rng = mulberry32(seed * 104729 + idx * 7919 + 17);
  }
  /** Writes METRICS-ordered values for time tMs into out. */
  sample(tMs: number, fixes: Fixes, out: ArrayLike<number> & { [i: number]: number }): void {
    const svc = SERVICES[this.idx];
    const b = BASE[svc];
    const r = this.rng;
    this.n1 = this.n1 * 0.985 + gauss(r) * 0.045; // slow drift
    this.n2 = this.n2 * 0.7 + gauss(r) * 0.06; // fast wobble
    this.n3 = this.n3 * 0.97 + gauss(r) * 0.12;
    const fx = effects(svc, tMs, this.sc, fixes);
    const day = dayFactor(tMs);
    const load = day * (1 + this.n1);
    const rps = b.rps * load * fx.rpsMul * (1 + this.n2 * 0.5);
    const p50 = b.p50 * (0.9 + 0.1 * day) * (1 + this.n1 * 0.7 + this.n2 * 0.4) * fx.lat;
    const p95 = p50 * P95_RATIO * (1 + this.n3 * 0.5 + gauss(r) * 0.03) * fx.tail;
    const p99 = p95 * (P99_RATIO / P95_RATIO) * (1 + this.n3 * 0.3 + gauss(r) * 0.04) * (1 + (fx.tail - 1) * 0.35);
    const err = Math.max(0, 0.35 * (1 + this.n1 * 2 + this.n2) + fx.errAdd * (1 + this.n2 * 0.6) + (fx.errAdd > 0 ? gauss(r) * 0.4 : 0));
    const cpu = (b.cpu * (0.85 + 0.15 * day) + fx.cpuAdd) * (1 + this.n1 * 0.4 + this.n2 * 0.25);
    const mem = (b.mem + fx.memAdd) * (1 + this.n1 * 0.05) + this.n2 * 0.4;
    const queue = Math.max(0, b.queue * load * fx.queueMul * (1 + this.n3 * 0.6 + this.n2));
    out[0] = Math.max(0, rps);
    out[1] = Math.max(0.5, p50);
    out[2] = Math.max(1, p95);
    out[3] = Math.max(2, p99);
    out[4] = Math.min(100, err);
    out[5] = Math.min(100, Math.max(1, cpu));
    out[6] = Math.min(99.6, Math.max(5, mem));
    out[7] = queue;
  }
}

export interface LogColumns {
  ts: Float64Array;
  svc: Uint8Array;
  lvl: Uint8Array;
  region: Uint8Array;
  host: Uint8Array;
  status: Uint16Array;
  latency: Uint16Array;
  tmpl: Uint16Array;
  trace: Uint32Array;
}
export const createLogColumns = (cap: number): LogColumns => ({
  ts: new Float64Array(cap),
  svc: new Uint8Array(cap),
  lvl: new Uint8Array(cap),
  region: new Uint8Array(cap),
  host: new Uint8Array(cap),
  status: new Uint16Array(cap),
  latency: new Uint16Array(cap),
  tmpl: new Uint16Array(cap),
  trace: new Uint32Array(cap),
});
export const LOG_KEYS = ['ts', 'svc', 'lvl', 'region', 'host', 'status', 'latency', 'tmpl', 'trace'] as const;

const svcWeights = SERVICES.map((s) => BASE[s].rps);
const weightSum = svcWeights.reduce((a, b) => a + b, 0);
const LEVEL_NAMES = ['debug', 'info', 'warn', 'error'] as const;
const TEMPLATE_BY: number[][][] = LEVEL_NAMES.map((lv) =>
  SERVICES.map((s) => TEMPLATES.map((t, i) => ({ t, i })).filter(({ t }) => t.level === lv && (!t.only || t.only.includes(s))).map(({ i }) => i)),
);
const INCIDENT_TEMPLATE_BY: number[][][] = LEVEL_NAMES.map((_lv, li) =>
  SERVICES.map((_s, si) => TEMPLATE_BY[li][si].filter((i) => TEMPLATES[i].incident)),
);

export class LogSim {
  private rng: () => number;
  private ts: number;
  count = 0;
  constructor(private sc: Scenario, seed: number, public cols: LogColumns) {
    this.rng = mulberry32(seed * 15485863 + 99);
    this.ts = NOW0 - LOG_SPAN_MS;
  }

  private row(fixes: Fixes): void {
    const r = this.rng;
    const i = this.count;
    const c = this.cols;
    // service by traffic weight
    let x = r() * weightSum;
    let si = 0;
    while (si < SERVICES.length - 1 && x > svcWeights[si]) {
      x -= svcWeights[si];
      si++;
    }
    const svc = SERVICES[si];
    const fx = effects(svc, this.ts, this.sc, fixes);
    const pe = 0.012 + fx.errAdd / 100;
    const pw = 0.07 + (fx.errAdd / 100) * 0.6;
    const u = r();
    const li = u < pe ? 3 : u < pe + pw ? 2 : u < pe + pw + 0.13 ? 0 : 1;
    const inIncident = fx.errAdd > 1.5 || fx.tail > 1.8;
    let pool = TEMPLATE_BY[li][si];
    if (inIncident && li >= 2 && r() < 0.75) {
      const ip = INCIDENT_TEMPLATE_BY[li][si];
      if (ip.length) pool = ip;
    }
    const tmpl = pool[Math.floor(r() * pool.length)];
    let status: number;
    if (li <= 1) status = [200, 200, 200, 201, 204, 304][Math.floor(r() * 6)];
    else if (li === 2) status = [429, 408, 499, 200][Math.floor(r() * 4)];
    else {
      const text = TEMPLATES[tmpl].text;
      status = /timeout|deadline/.test(text) ? 504 : /pool|breaker|broker|reset/.test(text) ? 503 : [500, 502, 500][Math.floor(r() * 3)];
    }
    const med = BASE[svc].p50 * fx.lat;
    let lat = med * Math.exp(0.6 * gauss(r));
    if (r() < 0.12) lat *= fx.tail * (0.8 + 0.7 * r());
    if (li === 3 && /timeout|deadline/.test(TEMPLATES[tmpl].text)) lat = 3000 + r() * 40;
    c.ts[i] = this.ts;
    c.svc[i] = si;
    c.lvl[i] = li;
    c.region[i] = Math.floor(r() * r() * 4); // skew towards us-east
    c.host[i] = si * HOSTS_PER_SERVICE + Math.floor(r() * HOSTS_PER_SERVICE);
    c.status[i] = status;
    c.latency[i] = Math.min(65535, Math.round(lat));
    c.tmpl[i] = tmpl;
    c.trace[i] = (r() * 4294967296) >>> 0;
    this.count++;
  }

  /** Generates [count, count+n) rows over the history span. */
  fillHistory(n: number, fixes: Fixes): void {
    const avg = LOG_SPAN_MS / LOG_HISTORY;
    for (let k = 0; k < n && this.count < LOG_HISTORY; k++) {
      this.ts += avg * (0.2 + 1.6 * this.rng());
      this.row(fixes);
    }
  }
  /** Rows for one simulated second of live traffic. */
  live(tMs: number, fixes: Fixes): number {
    const start = this.count;
    const per = 11 + Math.floor(this.rng() * 4);
    if (this.count + per >= this.cols.ts.length) return 0;
    this.ts = Math.max(this.ts, tMs - STEP_MS);
    for (let k = 0; k < per; k++) {
      this.ts += (STEP_MS / per) * (0.6 + 0.8 * this.rng());
      this.row(fixes);
    }
    return this.count - start;
  }
  get lastTs() {
    return this.ts;
  }
}

export const T0_MS = T0;
export const NMETRICS = METRICS.length;
