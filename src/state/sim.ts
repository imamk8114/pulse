/** Worker client: owns the Worker, mirrors its data into the data plane and feeds the store. */
import { FromWorker, LogChunk, QueryResult, ToWorker } from '../shared/protocol';
import { AlertEvent, AlertRule, METRICS, SERVICES, STEP_MS, T0 } from '../shared/types';
import { LOG_KEYS } from '../shared/gen';
import { data, dataBus } from './data';
import { getState, setState } from './store';

let worker: Worker | null = null;
let queryId = 0;
let lastSent = 0;
const pendingQuery = new Map<number, (r: QueryResult) => void>();
export const perf = { lastQueryMs: 0, queryHistory: [] as number[], genMs: 0, ticks: 0 };

function applyLogs(chunk: LogChunk) {
  const n = chunk.cols.ts.length;
  for (const k of LOG_KEYS) (data.logs[k] as Float64Array).set(chunk.cols[k] as Float64Array, chunk.start);
  data.logCount = Math.max(data.logCount, chunk.start + n);
}

function applyAlerts(list: import('../shared/protocol').WireAlert[]) {
  if (!list.length) return;
  const st = getState();
  const alerts = [...st.alerts];
  const fresh: AlertEvent[] = [];
  for (const w of list) {
    if (w.kind === 'fire') {
      const rule = st.rules.find((r) => r.id === w.ruleId);
      if (!rule) continue;
      const a: AlertEvent = {
        id: w.id,
        ruleId: rule.id,
        ruleName: rule.name,
        service: w.service,
        metric: rule.metric,
        severity: rule.severity,
        op: rule.op,
        threshold: rule.threshold,
        firedAt: w.firedAt ?? w.t,
        resolvedAt: null,
        peak: w.value,
      };
      alerts.push(a);
      if (w.firedAt == null) fresh.push(a);
    } else {
      const a = alerts.find((x) => x.id === w.id);
      if (a) {
        a.resolvedAt = w.t;
        a.peak = w.value;
      }
    }
  }
  const patch: Partial<ReturnType<typeof getState>> = { alerts };
  if (fresh.length) {
    const toasts = [...st.toasts];
    const ids: number[] = [];
    for (const a of fresh) {
      const id = Date.now() + Math.random();
      ids.push(id);
      toasts.push({ id, text: `Alert fired: ${a.ruleName} on ${a.service}`, kind: 'alert' });
    }
    patch.toasts = toasts.slice(-4);
    // Alert toasts must auto-dismiss like every other toast (actions.toast uses 5200 ms).
    setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => !ids.includes(t.id)) })), 5200);
    patch.announce = `Alert fired: ${fresh[0].ruleName} on ${fresh[0].service}, severity ${fresh[0].severity}`;
  }
  setState(patch);
  // auto-attach to an open incident on the same service
  import('./actions').then((m) => fresh.forEach((a) => m.autoAttachAlert(a)));
}

function onMessage(msg: FromWorker) {
  switch (msg.type) {
    case 'ready':
      data.scenario = msg.scenario;
      data.deploys = [...msg.scenario.deploys];
      break;
    case 'progress':
      setState({ progress: msg.fraction });
      break;
    case 'series': {
      msg.values.forEach((vals, m) => data.series[msg.service * METRICS.length + m].set(vals, 0));
      break;
    }
    case 'logs':
      applyLogs(msg.chunk);
      break;
    case 'loaded':
      data.count = msg.historyCount;
      perf.genMs = msg.genMs;
      setState({ loaded: true, progress: 1, loadMs: msg.genMs });
      dataBus.emit();
      break;
    case 'backfill':
      applyAlerts(msg.alerts);
      break;
    case 'tick': {
      const idx = data.count;
      for (let k = 0; k < msg.values.length; k++) data.series[k][idx] = msg.values[k];
      data.count++;
      if (msg.logs) applyLogs(msg.logs);
      perf.ticks++;
      applyAlerts(msg.alerts);
      dataBus.emit();
      if (perf.ticks % 4 === 0) setState({ liveTick: getState().liveTick + 1 });
      break;
    }
    case 'result': {
      const cb = pendingQuery.get(msg.result.id);
      pendingQuery.delete(msg.result.id);
      cb?.(msg.result);
      break;
    }
  }
}

export function startSim(seed: number, rules: AlertRule[]) {
  worker?.terminate();
  pendingQuery.clear();
  data.reset();
  worker = new Worker(new URL('../worker/sim.worker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (e: MessageEvent<FromWorker>) => onMessage(e.data);
  const m: ToWorker = { type: 'init', seed, rules };
  worker.postMessage(m);
}
export function send(m: ToWorker) {
  worker?.postMessage(m);
}

export function runQuery(q: string, chips: import('../shared/types').Chip[], from: number, to: number, buckets: number): Promise<QueryResult | null> {
  const id = ++queryId;
  lastSent = id;
  return new Promise((resolve) => {
    pendingQuery.set(id, (r) => {
      perf.lastQueryMs = r.ms;
      perf.queryHistory.push(r.ms);
      resolve(id === lastSent ? r : null);
    });
    send({ type: 'query', id, q, chips, from, to, buckets });
  });
}

export const latestSimT = () => T0 + Math.max(0, data.count - 1) * STEP_MS;
export const SERVICE_COUNT = SERVICES.length;
