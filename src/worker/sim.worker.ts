/// <reference lib="webworker" />
import { evaluateSeries, freshRun, RunState, stepRun } from '../engine/alerts';
import { andNodes, chipNode, compile, Table } from '../engine/query/evaluator';
import { parse } from '../engine/query/parser';
import { LOG_SCHEMA, templateMatcher } from '../engine/table';
import { makeScenario } from '../shared/scenario';
import { createLogColumns, Fixes, LOG_KEYS, LogSim, ServiceGen } from '../shared/gen';
import { FromWorker, LogChunk, QueryResult, ToWorker, WireAlert } from '../shared/protocol';
import {
  AlertRule,
  HISTORY_POINTS,
  LEVELS,
  LOG_CAPACITY,
  LOG_HISTORY,
  METRICS,
  NOW0,
  Scenario,
  SERIES_CAPACITY,
  SERIES_COUNT,
  SERVICES,
  ServiceId,
  STEP_MS,
  T0,
  seriesIndex,
} from '../shared/types';

const ctx = self as unknown as DedicatedWorkerGlobalScope;
const post = (m: FromWorker, transfer: Transferable[] = []) => ctx.postMessage(m, transfer);

let scenario: Scenario;
let series: Float32Array[] = [];
let gens: ServiceGen[] = [];
let logSim: LogSim;
let count = 0;
let fixes: Fixes = {};
let rules: AlertRule[] = [];
const runs = new Map<string, RunState & { alertId?: string }>();
let alertSeq = 0;
let timer: ReturnType<typeof setInterval> | null = null;
let paused = false;
let epoch = 0;

const metricIdx = (m: string) => METRICS.indexOf(m as (typeof METRICS)[number]);
const cap = (a: Float64Array | Uint8Array | Uint16Array | Uint32Array, s: number, e: number) => a.slice(s, e);

function logChunk(start: number, end: number): LogChunk {
  const c = logSim.cols;
  const cols = {} as Record<string, ArrayBufferView>;
  for (const k of LOG_KEYS) cols[k] = cap(c[k], start, end);
  return { start, cols: cols as unknown as LogChunk['cols'] };
}
const chunkBuffers = (ch: LogChunk): Transferable[] => LOG_KEYS.map((k) => ch.cols[k].buffer as ArrayBuffer);

function ruleTargets(rule: AlertRule): ServiceId[] {
  return rule.service === 'any' ? [...SERVICES] : [rule.service];
}

function backfillRules(list: AlertRule[]): WireAlert[] {
  const out: WireAlert[] = [];
  for (const rule of list) {
    if (!rule.backfill) continue;
    for (const svc of ruleTargets(rule)) {
      const si = SERVICES.indexOf(svc);
      const vals = series[seriesIndex(si, metricIdx(rule.metric))];
      const from = NOW0 - 3 * 3600_000;
      const ivs = evaluateSeries(vals, T0, STEP_MS, count, from, T0 + (count - 1) * STEP_MS, rule);
      for (const iv of ivs) {
        const id = `a${++alertSeq}`;
        out.push({ kind: 'fire', id, ruleId: rule.id, service: svc, t: iv.start, value: iv.peak, firedAt: iv.start });
        if (iv.end != null) out.push({ kind: 'resolve', id, ruleId: rule.id, service: svc, t: iv.end, value: iv.peak });
      }
      // Rebuild the live run state from history so a firing alert continues seamlessly.
      const key = `${rule.id}|${svc}`;
      const rs = freshRun() as RunState & { alertId?: string };
      const last = ivs[ivs.length - 1];
      const warm = Math.ceil((rule.windowSec * 1000) / STEP_MS) + 2;
      for (let i = Math.max(0, count - 4 * 3600 - warm); i < count; i++) stepRun(rs, rule, T0 + i * STEP_MS, vals[i]);
      if (rs.firing && last && last.end == null) {
        const fired = out.find((a) => a.kind === 'fire' && a.ruleId === rule.id && a.service === svc && a.t === last.start);
        rs.alertId = fired?.id;
      }
      runs.set(key, rs);
    }
  }
  return out;
}

function setRules(next: AlertRule[], initial: boolean) {
  const prev = new Map(rules.map((r) => [r.id, r]));
  rules = next;
  const keep = new Set<string>();
  for (const rule of rules) {
    const p = prev.get(rule.id);
    const same = p && p.metric === rule.metric && p.service === rule.service && p.op === rule.op && p.threshold === rule.threshold && p.windowSec === rule.windowSec;
    for (const svc of ruleTargets(rule)) {
      const key = `${rule.id}|${svc}`;
      keep.add(key);
      if (!same && !(initial && rule.backfill)) runs.set(key, freshRun());
    }
  }
  for (const k of [...runs.keys()]) if (!keep.has(k)) runs.delete(k);
}

function startLoad(seed: number, initRules: AlertRule[]) {
  const myEpoch = ++epoch;
  if (timer) clearInterval(timer);
  timer = null;
  const t0 = performance.now();
  scenario = makeScenario(seed);
  fixes = {};
  runs.clear();
  count = 0;
  series = Array.from({ length: SERIES_COUNT }, () => new Float32Array(SERIES_CAPACITY));
  gens = SERVICES.map((_, i) => new ServiceGen(i, scenario, seed));
  logSim = new LogSim(scenario, seed, createLogColumns(LOG_CAPACITY));
  post({ type: 'ready', scenario, seed });

  // Generate history one service at a time so the UI can show progress.
  const tmp = new Float32Array(METRICS.length);
  let svc = 0;
  const stepSvc = () => {
    if (myEpoch !== epoch) return;
    const g = gens[svc];
    const base = svc * METRICS.length;
    for (let i = 0; i < HISTORY_POINTS; i++) {
      g.sample(T0 + i * STEP_MS, fixes, tmp);
      for (let m = 0; m < METRICS.length; m++) series[base + m][i] = tmp[m];
    }
    const vs = series.slice(base, base + METRICS.length).map((a) => a.slice(0, HISTORY_POINTS));
    post({ type: 'series', service: svc, values: vs }, vs.map((a) => a.buffer as ArrayBuffer));
    svc++;
    post({ type: 'progress', fraction: (svc / SERVICES.length) * 0.7 });
    if (svc < SERVICES.length) setTimeout(stepSvc, 0);
    else {
      count = HISTORY_POINTS;
      setTimeout(stepLogs, 0);
    }
  };
  const stepLogs = () => {
    if (myEpoch !== epoch) return;
    const before = logSim.count;
    logSim.fillHistory(20_000, fixes);
    const ch = logChunk(before, logSim.count);
    post({ type: 'logs', chunk: ch }, chunkBuffers(ch));
    post({ type: 'progress', fraction: 0.7 + (logSim.count / LOG_HISTORY) * 0.3 });
    if (logSim.count < LOG_HISTORY) setTimeout(stepLogs, 0);
    else finish();
  };
  const finish = () => {
    setRules(initRules, true);
    const alerts = backfillRules(initRules);
    post({ type: 'loaded', historyCount: HISTORY_POINTS, logCount: logSim.count, genMs: performance.now() - t0 });
    post({ type: 'backfill', alerts });
    timer = setInterval(tick, STEP_MS / 4);
  };
  setTimeout(stepSvc, 0);
}

const tmpVals = new Float32Array(METRICS.length);
function tick() {
  if (paused || count >= SERIES_CAPACITY) return;
  const t = T0 + count * STEP_MS;
  const vals = new Float32Array(SERIES_COUNT);
  for (let s = 0; s < SERVICES.length; s++) {
    gens[s].sample(t, fixes, tmpVals);
    for (let m = 0; m < METRICS.length; m++) {
      const k = s * METRICS.length + m;
      series[k][count] = tmpVals[m];
      vals[k] = tmpVals[m];
    }
  }
  count++;
  const before = logSim.count;
  const added = logSim.live(t, fixes);
  const ch = added ? logChunk(before, logSim.count) : null;

  const alerts: WireAlert[] = [];
  for (const rule of rules) {
    if (!rule.enabled) continue;
    const mi = metricIdx(rule.metric);
    for (const svc of ruleTargets(rule)) {
      const key = `${rule.id}|${svc}`;
      let rs = runs.get(key);
      if (!rs) runs.set(key, (rs = freshRun()));
      const v = vals[seriesIndex(SERVICES.indexOf(svc), mi)];
      const tr = stepRun(rs, rule, t, v);
      if (tr === 'fire') {
        rs.alertId = `a${++alertSeq}`;
        alerts.push({ kind: 'fire', id: rs.alertId, ruleId: rule.id, service: svc, t, value: v });
      } else if (tr === 'resolve') {
        alerts.push({ kind: 'resolve', id: rs.alertId ?? '', ruleId: rule.id, service: svc, t, value: rs.peak });
      }
    }
  }
  const msg: FromWorker = { type: 'tick', t, values: vals, logs: ch, alerts };
  post(msg, [vals.buffer, ...(ch ? chunkBuffers(ch) : [])]);
}

/* ---------------------------- log queries ---------------------------- */

function makeTable(n: number): Table {
  const c = logSim.cols;
  const cache = new Map<string, Uint8Array>();
  return {
    length: n,
    schema: LOG_SCHEMA,
    enumColumn: (f) => (f === 'service' ? c.svc : f === 'level' ? c.lvl : f === 'region' ? c.region : c.host),
    numColumn: (f) => (f === 'status' ? c.status : c.latency),
    textMatcher: (term) => {
      let m = cache.get(term);
      if (!m) cache.set(term, (m = templateMatcher(term)));
      const tm = c.tmpl;
      return (r) => m![tm[r]] === 1;
    },
  };
}

function lowerBound(a: Float64Array, n: number, x: number) {
  let lo = 0;
  let hi = n;
  while (lo < hi) {
    const mid = (lo + hi) >>> 1;
    if (a[mid] < x) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function runQuery(req: Extract<ToWorker, { type: 'query' }>) {
  const t0 = performance.now();
  const n = logSim.count;
  const parsed = parse(req.q);
  const empty = (error: QueryResult['error']): QueryResult => ({
    id: req.id,
    error,
    matches: new Uint32Array(0),
    scanned: 0,
    matched: 0,
    hist: new Uint32Array(req.buckets),
    errHist: new Uint32Array(req.buckets),
    ms: performance.now() - t0,
  });
  if (parsed.errors.length) {
    const res = empty(parsed.errors[0]);
    return post({ type: 'result', result: res });
  }
  let ast = parsed.ast;
  for (const c of req.chips) ast = andNodes(chipNode(c.field, c.value, c.neg), ast);
  const table = makeTable(n);
  const compiled = compile(ast, table);
  if (compiled.errors.length || !compiled.predicate) {
    return post({ type: 'result', result: empty(compiled.errors[0] ?? { message: 'Invalid query', start: 0, end: 0 }) });
  }
  const pred = compiled.predicate;
  const ts = logSim.cols.ts;
  const lvl = logSim.cols.lvl;
  const lo = lowerBound(ts, n, req.from);
  const hi = lowerBound(ts, n, req.to + 1);
  const matches = new Uint32Array(Math.max(0, hi - lo));
  const hist = new Uint32Array(req.buckets);
  const errHist = new Uint32Array(req.buckets);
  const span = Math.max(1, req.to - req.from);
  const errCode = LEVELS.indexOf('error');
  let m = 0;
  for (let i = lo; i < hi; i++) {
    if (pred(i)) {
      matches[m++] = i;
      let b = Math.floor(((ts[i] - req.from) / span) * req.buckets);
      if (b >= req.buckets) b = req.buckets - 1;
      if (b < 0) b = 0;
      hist[b]++;
      if (lvl[i] === errCode) errHist[b]++;
    }
  }
  const out = matches.slice(0, m);
  const result: QueryResult = { id: req.id, error: null, matches: out, scanned: hi - lo, matched: m, hist, errHist, ms: performance.now() - t0 };
  post({ type: 'result', result }, [out.buffer, hist.buffer, errHist.buffer]);
}

ctx.onmessage = (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  switch (m.type) {
    case 'init':
      startLoad(m.seed, m.rules);
      break;
    case 'setRules':
      setRules(m.rules, false);
      break;
    case 'rollback':
      fixes = { ...fixes, [m.service]: T0 + (count - 1) * STEP_MS };
      break;
    case 'setSpeed':
      paused = m.paused;
      break;
    case 'query':
      if (logSim && logSim.count > 0) runQuery(m);
      break;
  }
};
