/** All state transitions. UI components call these; nothing else mutates the store. */
import { decodeState, encodeState, ViewState } from '../engine/urlState';
import { AlertEvent, AlertRule, Chip, Deploy, METRICS, METRIC_META, MetricId, SERVICES, ServiceId, Severity, seriesIndex } from '../shared/types';
import { data, setHover } from './data';
import { fmtClock, fmtDateTime, fmtDuration, fmtNum } from './format';
import { MISSION_STEPS } from './mission';
import { runQuery, send, startSim } from './sim';
import { emptyMission, getState, Incident, IncidentEvent, IncidentStatus, MissionState, SavedQuery, setState, subscribe } from './store';

/* ------------------------------ constants ------------------------------ */

export const DEFAULT_SPAN_SEC = 90 * 60;
export const RESPONDERS = ['Maya Chen', 'Dev Patel', 'Lena Ortiz', 'Sam Okafor', 'Ivo Novak'];

export const DEFAULT_RULES: AlertRule[] = [
  { id: 'r-err', name: 'Error rate above 5%', metric: 'err', service: 'any', op: '>', threshold: 5, windowSec: 60, severity: 'sev2', enabled: true, backfill: true, origin: 'seed' },
  { id: 'r-mem', name: 'Memory pressure', metric: 'mem', service: 'any', op: '>', threshold: 85, windowSec: 60, severity: 'sev3', enabled: true, backfill: true, origin: 'seed' },
  { id: 'r-cpu', name: 'CPU saturation', metric: 'cpu', service: 'any', op: '>', threshold: 85, windowSec: 120, severity: 'sev2', enabled: true, backfill: true, origin: 'seed' },
];

const DEFAULT_SAVED: SavedQuery[] = [
  { name: 'Errors from the culprit', q: 'level:error service:checkout' },
  { name: 'Slow requests', q: 'latency>500 AND NOT level:debug' },
  { name: 'Timeouts outside EU', q: '"timeout" AND NOT region:eu' },
  { name: '5xx from payments', q: 'status>=500 service:payments' },
];

const safe = {
  get(k: string): string | null {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set(k: string, v: string) {
    try {
      localStorage.setItem(k, v);
    } catch {
      /* private mode */
    }
  },
};

/* ------------------------------ toasts / a11y ------------------------------ */

let toastSeq = 1;
export function toast(text: string, kind: 'info' | 'alert' | 'success' = 'info') {
  const id = toastSeq++;
  setState((s) => ({ toasts: [...s.toasts, { id, text, kind }].slice(-4) }));
  setTimeout(() => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })), 5200);
}
export const dismissToast = (id: number) => setState((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));

/* ------------------------------ view / time ------------------------------ */

export function getView(): { from: number; to: number } {
  const s = getState();
  if (s.live) {
    const to = data.latestT();
    return { from: to - s.spanSec * 1000, to };
  }
  return { from: s.from, to: s.to };
}

function clampRange(from: number, to: number) {
  const lo = data.t0;
  const hi = data.latestT() + 60_000;
  let span = Math.min(Math.max(5000, to - from), hi - lo);
  if (from < lo) {
    from = lo;
    to = from + span;
  }
  if (to > hi) {
    to = hi;
    from = to - span;
  }
  span = to - from;
  return { from, to };
}

export function setRange(from: number, to: number) {
  const r = clampRange(from, to);
  setState({ live: false, from: r.from, to: r.to });
}
export function zoomAround(anchor: number, factor: number) {
  const v = getView();
  const span = (v.to - v.from) * factor;
  const f = (anchor - v.from) / (v.to - v.from);
  setRange(anchor - f * span, anchor + (1 - f) * span);
}
export function panBy(dt: number) {
  const v = getView();
  setRange(v.from + dt, v.to + dt);
}
export function setLive(on: boolean) {
  const v = getView();
  if (on) setState({ live: true, spanSec: Math.max(5, Math.round((v.to - v.from) / 1000)) });
  else setState({ live: false, from: v.from, to: v.to });
}
export function resetView() {
  setState({ live: true, spanSec: DEFAULT_SPAN_SEC });
}
export function setPreset(minutes: number) {
  setState({ live: true, spanSec: minutes * 60 });
}

/* ------------------------------ chips / queries ------------------------------ */

export function addChip(chip: Chip, fromRow = false) {
  const s = getState();
  if (s.chips.some((c) => c.field === chip.field && c.value === chip.value && c.neg === chip.neg)) return;
  const chips = s.chips.filter((c) => !(chip.field === 'service' && !chip.neg && c.field === 'service' && !c.neg));
  chips.push(chip);
  setState({ chips, mission: fromRow ? { ...s.mission, flags: { ...s.mission.flags, chipFromRow: true } } : s.mission });
}
export const removeChip = (i: number) => setState((s) => ({ chips: s.chips.filter((_, k) => k !== i) }));
export function toggleServiceFilter(svc: ServiceId) {
  const s = getState();
  const has = s.chips.some((c) => c.field === 'service' && c.value === svc && !c.neg);
  if (has) setState({ chips: s.chips.filter((c) => !(c.field === 'service' && c.value === svc && !c.neg)) });
  else addChip({ field: 'service', value: svc, neg: false });
}
export const setQuery = (q: string) => setState({ q });
export const setTab = (tab: ViewState['tab']) => setState({ tab, deployPop: null });
export function activeServices(chips: Chip[]): ServiceId[] | null {
  const sel = chips.filter((c) => c.field === 'service' && !c.neg).map((c) => c.value as ServiceId);
  return sel.length ? sel : null;
}
export function saveQuery(name: string) {
  const s = getState();
  if (!s.q.trim()) return;
  const saved = [...s.saved.filter((x) => x.name !== name), { name, q: s.q }];
  setState({ saved });
  safe.set('pulse.saved', JSON.stringify(saved));
  toast(`Saved query "${name}"`, 'success');
}
export function deleteSaved(name: string) {
  const saved = getState().saved.filter((x) => x.name !== name);
  setState({ saved });
  safe.set('pulse.saved', JSON.stringify(saved));
}

/* ------------------------------ alert rules ------------------------------ */

export function openEditor(rule?: Partial<AlertRule>, isNew = true) {
  const s = getState();
  const base: AlertRule = {
    id: `r-${Date.now().toString(36)}`,
    name: 'New alert rule',
    metric: 'p95',
    service: (data.scenario?.culprit ?? 'checkout') as ServiceId,
    op: '>',
    threshold: 500,
    windowSec: 30,
    severity: 'sev2',
    enabled: true,
    origin: 'manual',
  };
  setState({ editor: { rule: { ...base, ...rule }, isNew }, tab: s.tab });
}
export const closeEditor = () => setState({ editor: null });
export function updateEditor(patch: Partial<AlertRule>) {
  setState((s) => (s.editor ? { editor: { ...s.editor, rule: { ...s.editor.rule, ...patch } } } : {}));
}
export function saveRule() {
  const s = getState();
  if (!s.editor) return;
  const r = s.editor.rule;
  const rules = s.editor.isNew ? [...s.rules, r] : s.rules.map((x) => (x.id === r.id ? r : x));
  setState({ rules, editor: null });
  send({ type: 'setRules', rules });
  toast(`Rule "${r.name}" saved. Evaluating live in the worker.`, 'success');
}
export function deleteRule(id: string) {
  const rules = getState().rules.filter((r) => r.id !== id);
  setState({ rules });
  send({ type: 'setRules', rules });
}
export function toggleRule(id: string) {
  const rules = getState().rules.map((r) => (r.id === id ? { ...r, enabled: !r.enabled } : r));
  setState({ rules });
  send({ type: 'setRules', rules });
}

/** Suggest a threshold from the data currently in view so the preview shows something meaningful. */
export function suggestThreshold(metric: MetricId, service: ServiceId): number {
  const v = getView();
  const si = SERVICES.indexOf(service);
  const arr = data.series[seriesIndex(si, METRICS.indexOf(metric))];
  const i0 = Math.max(0, Math.floor((v.from - data.t0) / data.step));
  const i1 = Math.min(data.count, Math.ceil((v.to - data.t0) / data.step));
  if (i1 <= i0) return 100;
  const stride = Math.max(1, Math.floor((i1 - i0) / 400));
  const vals: number[] = [];
  for (let i = i0; i < i1; i += stride) vals.push(arr[i]);
  vals.sort((a, b) => a - b);
  const med = vals[Math.floor(vals.length * 0.5)];
  const max = vals[vals.length - 1];
  const raw = med + (max - med) * 0.45;
  const mag = raw >= 100 ? 50 : raw >= 20 ? 10 : raw >= 5 ? 1 : 0.5;
  return Math.max(mag, Math.round(raw / mag) * mag);
}

export function openRuleFromChart(metric: MetricId, service?: ServiceId) {
  const svc = service ?? activeServices(getState().chips)?.[0] ?? data.scenario?.culprit ?? 'checkout';
  const th = suggestThreshold(metric, svc);
  openEditor({ metric, service: svc, threshold: th, name: `${METRIC_META[metric].label} ${svc}`, origin: 'chart', op: '>' });
}

/* ------------------------------ incidents ------------------------------ */

let evSeq = 1;
const ev = (kind: IncidentEvent['kind'], text: string, ts = data.latestT()): IncidentEvent => ({ id: `e${evSeq++}`, ts, kind, text });

function updateIncident(id: string, fn: (i: Incident) => Incident) {
  setState((s) => ({ incidents: s.incidents.map((i) => (i.id === id ? fn(i) : i)) }));
}

export function declareIncident(alertId: string) {
  const s = getState();
  const alert = s.alerts.find((a) => a.id === alertId);
  if (!alert) return;
  const existing = s.incidents.find((i) => i.id === alert.incidentId);
  if (existing) {
    setState({ tab: 'incidents', openIncidentId: existing.id });
    return;
  }
  const n = s.incidents.length + 1;
  const id = `INC-${100 + n}`;
  const now = data.latestT();
  const related = s.alerts.filter((a) => a.service === alert.service && !a.incidentId && (a.id === alert.id || a.resolvedAt == null || now - a.firedAt < 45 * 60_000));
  const metricLabel = METRIC_META[alert.metric].label;
  const inc: Incident = {
    id,
    title: `${metricLabel} degraded on ${alert.service}`,
    severity: alert.severity,
    status: 'investigating',
    responder: RESPONDERS[(n - 1) % RESPONDERS.length],
    service: alert.service,
    createdAt: now,
    resolvedAt: null,
    alertIds: related.map((a) => a.id),
    events: [ev('declared', `Incident declared from alert "${alert.ruleName}"`, now)],
    checklist: [
      { id: 'c1', text: 'Acknowledge the page and confirm the responder', done: false },
      { id: 'c2', text: `Check recent deploys of ${alert.service}`, done: false },
      { id: 'c3', text: 'Compare error rate and p95 before and after the change', done: false },
      { id: 'c4', text: 'Roll back or disable the suspect change', done: false },
      { id: 'c5', text: 'Confirm metrics recovered for 5 minutes', done: false },
      { id: 'c6', text: 'Capture follow-ups for the post-mortem', done: false },
    ],
  };
  setState({
    incidents: [...s.incidents, inc],
    alerts: s.alerts.map((a) => (related.some((r) => r.id === a.id) ? { ...a, incidentId: id } : a)),
    openIncidentId: id,
    tab: 'incidents',
  });
  toast(`${id} declared, ${inc.responder} is responding`, 'success');
}

export function autoAttachAlert(a: AlertEvent) {
  const s = getState();
  const inc = s.incidents.find((i) => i.service === a.service && i.status !== 'resolved');
  if (!inc || inc.alertIds.includes(a.id)) return;
  updateIncident(inc.id, (i) => ({ ...i, alertIds: [...i.alertIds, a.id] }));
  setState((st) => ({ alerts: st.alerts.map((x) => (x.id === a.id ? { ...x, incidentId: inc.id } : x)) }));
}

export function setIncidentStatus(id: string, status: IncidentStatus) {
  updateIncident(id, (i) => {
    if (i.status === status) return i;
    const ts = data.latestT();
    return {
      ...i,
      status,
      resolvedAt: status === 'resolved' ? ts : null,
      events: [...i.events, ev('status', `Status changed to ${status}`, ts)],
    };
  });
}
export const setIncidentSeverity = (id: string, severity: Severity) =>
  updateIncident(id, (i) => (i.severity === severity ? i : { ...i, severity, events: [...i.events, ev('severity', `Severity set to ${severity}`)] }));
export const assignIncident = (id: string, responder: string) =>
  updateIncident(id, (i) => (i.responder === responder ? i : { ...i, responder, events: [...i.events, ev('assign', `Assigned to ${responder}`)] }));
export const addNote = (id: string, text: string) => text.trim() && updateIncident(id, (i) => ({ ...i, events: [...i.events, ev('note', text.trim())] }));
export const toggleCheck = (id: string, cid: string) =>
  updateIncident(id, (i) => ({ ...i, checklist: i.checklist.map((c) => (c.id === cid ? { ...c, done: !c.done } : c)) }));

export function rollbackService(id: string) {
  const s = getState();
  const inc = s.incidents.find((i) => i.id === id);
  if (!inc || !data.scenario) return;
  const bad = [...data.deploys].reverse().find((d) => d.service === inc.service && d.kind === 'deploy');
  send({ type: 'rollback', service: inc.service });
  const now = data.latestT();
  const rb: Deploy = {
    id: `rb-${now}`,
    ts: now,
    service: inc.service,
    version: bad ? `${bad.version} (rollback)` : 'rollback',
    author: inc.responder,
    message: bad ? `Roll back ${bad.version}` : 'Roll back',
    kind: 'rollback',
  };
  data.deploys = [...data.deploys, rb];
  updateIncident(id, (i) => ({
    ...i,
    events: [...i.events, ev('rollback', `Rolled back ${inc.service}${bad ? ` ${bad.version}` : ''}`, now)],
    checklist: i.checklist.map((c) => (c.id === 'c4' ? { ...c, done: true } : c)),
  }));
  toast(`Rollback of ${inc.service} started, watch the charts recover`, 'info');
}

export function showIncidentInCharts(inc: Incident) {
  const to = inc.resolvedAt ?? data.latestT();
  setRange(inc.createdAt - 25 * 60_000, to + 10 * 60_000);
  setState({ tab: 'overview' });
}

function windowStat(service: ServiceId, metric: MetricId, from: number, to: number, mode: 'max' | 'mean') {
  const arr = data.series[seriesIndex(SERVICES.indexOf(service), METRICS.indexOf(metric))];
  const i0 = Math.max(0, Math.floor((from - data.t0) / data.step));
  const i1 = Math.min(data.count, Math.ceil((to - data.t0) / data.step));
  let m = 0;
  let sum = 0;
  for (let i = i0; i < i1; i++) {
    sum += arr[i];
    if (arr[i] > m) m = arr[i];
  }
  return mode === 'max' ? m : i1 > i0 ? sum / (i1 - i0) : 0;
}

export function incidentSummary(inc: Incident): string {
  const s = getState();
  const end = inc.resolvedAt ?? data.latestT();
  const alerts = s.alerts.filter((a) => inc.alertIds.includes(a.id));
  const firstAlert = alerts.reduce((m, a) => Math.min(m, a.firedAt), inc.createdAt);
  const deploys = data.deploys.filter((d) => d.service === inc.service && d.ts >= firstAlert - 90 * 60_000 && d.ts <= end);
  const base = windowStat(inc.service, 'p95', firstAlert - 3 * 3600_000, firstAlert - 3600_000, 'mean');
  const peakP95 = windowStat(inc.service, 'p95', firstAlert - 10 * 60_000, end, 'max');
  const peakErr = windowStat(inc.service, 'err', firstAlert - 10 * 60_000, end, 'max');
  const lines: string[] = [];
  lines.push(`# ${inc.id}: ${inc.title}`);
  lines.push('');
  lines.push(`- Severity: ${inc.severity.toUpperCase()}`);
  lines.push(`- Status: ${inc.status}`);
  lines.push(`- Responder: ${inc.responder}`);
  lines.push(`- Service: ${inc.service}`);
  lines.push(`- Window: ${fmtDateTime(Math.min(firstAlert, inc.createdAt))} to ${inc.resolvedAt ? fmtDateTime(inc.resolvedAt) : 'ongoing'} (${fmtDuration(end - Math.min(firstAlert, inc.createdAt))})`);
  lines.push(`- Impact: p95 latency peaked at ${fmtNum(peakP95, 'ms')} (baseline about ${fmtNum(base, 'ms')}); error rate peaked at ${fmtNum(peakErr, '%')}`);
  lines.push('');
  lines.push('## Timeline (UTC)');
  const rows: Array<{ ts: number; text: string }> = [];
  for (const d of deploys) rows.push({ ts: d.ts, text: `${d.kind === 'rollback' ? 'Rollback' : 'Deploy'} ${d.service} ${d.version} by ${d.author}: ${d.message}` });
  for (const a of alerts) {
    rows.push({ ts: a.firedAt, text: `Alert fired: ${a.ruleName} (${a.severity})` });
    if (a.resolvedAt) rows.push({ ts: a.resolvedAt, text: `Alert resolved: ${a.ruleName}` });
  }
  for (const e of inc.events) rows.push({ ts: e.ts, text: e.text });
  rows.sort((a, b) => a.ts - b.ts);
  for (const r of rows) lines.push(`- ${fmtClock(r.ts)} ${r.text}`);
  lines.push('');
  lines.push('## Runbook');
  for (const c of inc.checklist) lines.push(`- [${c.done ? 'x' : ' '}] ${c.text}`);
  lines.push('');
  lines.push('_Generated by Pulse from simulated data._');
  return lines.join('\n');
}

export async function copySummary(inc: Incident) {
  const text = incidentSummary(inc);
  let ok = false;
  try {
    await navigator.clipboard.writeText(text);
    ok = true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try {
      ok = document.execCommand('copy');
    } catch {
      ok = false;
    }
    ta.remove();
  }
  (window as unknown as { __lastSummary?: string }).__lastSummary = text;
  setState((s) => ({ mission: { ...s.mission, flags: { ...s.mission.flags, summaryCopied: true } } }));
  toast(ok ? 'Post-mortem summary copied to clipboard' : 'Summary generated (clipboard unavailable)', 'success');
}

/* ------------------------------ deploy markers ------------------------------ */

export function inspectDeploy(d: Deploy | null) {
  setState((s) => ({ deployPop: d, mission: d ? { ...s.mission, flags: { ...s.mission.flags, markerInspected: true } } : s.mission }));
}

/* ------------------------------ mission ------------------------------ */

const MISSION_KEY = 'pulse.mission.v1';
function persistMission(m: MissionState) {
  safe.set(MISSION_KEY, JSON.stringify({ ...m, highlight: null }));
}
export function setMission(patch: Partial<MissionState>) {
  setState((s) => ({ mission: { ...s.mission, ...patch } }));
}
export const minimizeMission = () => setMission({ minimized: true });
export const openMission = () => setMission({ open: true, minimized: false });
export const closeMission = () => setMission({ open: false, minimized: true });

export function showMe(stepId: string) {
  const sc = data.scenario;
  if (!sc) return;
  const hl = (h: string) => setMission({ highlight: h });
  switch (stepId) {
    case 'zoom':
      setState({ tab: 'overview' });
      setRange(sc.culpritDeployTs - 6 * 60_000, sc.culpritDeployTs + 14 * 60_000);
      break;
    case 'filter':
      setState({ tab: 'logs', q: `level:error service:${sc.culprit}` });
      break;
    case 'chip':
      setState({ tab: 'logs' });
      if (!getState().q) setState({ q: `level:error service:${sc.culprit}` });
      hl('chip');
      break;
    case 'marker':
      setState({ tab: 'overview' });
      setRange(sc.culpritDeployTs - 20 * 60_000, sc.culpritDeployTs + 25 * 60_000);
      hl('marker');
      break;
    case 'rule':
      setState({ tab: 'overview' });
      openRuleFromChart('p95', sc.culprit);
      break;
    case 'fire':
      if (getState().rules.some((r) => r.origin === 'chart')) setState({ tab: 'alerts' });
      else openRuleFromChart('p95', sc.culprit);
      break;
    case 'incident':
      setState({ tab: 'alerts' });
      hl('declare');
      break;
    case 'resolve': {
      const inc = getState().incidents[0];
      if (inc) setState({ tab: 'incidents', openIncidentId: inc.id });
      else setState({ tab: 'alerts' });
      hl('resolve');
      break;
    }
  }
  setMission({ minimized: false, open: true });
  setTimeout(() => setMission({ highlight: null }), 6000);
}

function startMissionWatcher() {
  subscribe(() => {
    const s = getState();
    if (!s.loaded) return;
    let changed = false;
    const done = { ...s.mission.done };
    for (const st of MISSION_STEPS) {
      if (!done[st.id] && st.test(s)) {
        done[st.id] = true;
        changed = true;
      }
    }
    const all = MISSION_STEPS.every((st) => done[st.id]);
    if (changed || (all && !s.mission.celebrated)) {
      const mission = { ...s.mission, done, celebrated: s.mission.celebrated || all, open: all || s.mission.open };
      setState({ mission });
      persistMission(mission);
      if (changed) {
        const n = MISSION_STEPS.filter((x) => done[x.id]).length;
        setState({ missionAnnounce: `Mission step complete. ${n} of ${MISSION_STEPS.length} done.` });
      }
    }
  });
}

/* ------------------------------ reseed / theme / boot ------------------------------ */

export function startNewIncident() {
  const s = getState();
  resetWorld(s.seed + 1, true);
}

function resetWorld(seed: number, resetMissionToo: boolean) {
  const s = getState();
  const mission = resetMissionToo ? emptyMission() : s.mission;
  setState({
    seed,
    loaded: false,
    progress: 0,
    alerts: [],
    incidents: [],
    openIncidentId: null,
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
    chips: [],
    q: '',
    live: true,
    spanSec: DEFAULT_SPAN_SEC,
    logView: null,
    selectedLog: null,
    deployPop: null,
    editor: null,
    tab: 'overview',
    mission: { ...mission, done: resetMissionToo ? {} : mission.done },
  });
  lastKey = '';
  if (resetMissionToo) persistMission(getState().mission);
  startSim(seed, getState().rules);
}

export function applyTheme(theme: 'dark' | 'light') {
  document.documentElement.setAttribute('data-theme', theme);
  safe.set('pulse.theme', theme);
  setState({ theme });
  window.dispatchEvent(new Event('pulse-theme'));
}
export const toggleTheme = () => applyTheme(getState().theme === 'dark' ? 'light' : 'dark');

export function copyLink() {
  const url = location.href;
  navigator.clipboard?.writeText(url).then(
    () => toast('Link to this exact view copied', 'success'),
    () => toast('Copy failed, the URL in the address bar has the same state', 'info'),
  );
}

/* ------------------------------ log query controller ------------------------------ */

let lastKey = '';
let qTimer: ReturnType<typeof setTimeout> | null = null;
async function execQuery() {
  const s = getState();
  if (!s.loaded) return;
  const v = getView();
  const res = await runQuery(s.q, s.chips, v.from, v.to, 100);
  if (res) setState({ logView: { res, from: v.from, to: v.to, q: s.q } });
}
function startLogController() {
  subscribe(() => {
    const s = getState();
    if (!s.loaded || s.tab !== 'logs') return;
    const k = `${s.q}|${JSON.stringify(s.chips)}|${s.live ? 'L' + s.spanSec : Math.round(s.from) + '-' + Math.round(s.to)}`;
    if (k === lastKey) return;
    lastKey = k;
    if (qTimer) clearTimeout(qTimer);
    qTimer = setTimeout(execQuery, 90);
  });
  setInterval(() => {
    const s = getState();
    if (s.loaded && s.tab === 'logs' && s.live) void execQuery();
  }, 1000);
  // when leaving the tab and coming back with the same key we still want fresh data
  let prevTab = '';
  subscribe(() => {
    const s = getState();
    if (s.tab !== prevTab) {
      if (s.tab === 'logs') lastKey = '';
      prevTab = s.tab;
    }
  });
}

/* ------------------------------ URL sync ------------------------------ */

let lastHash = '';
function startUrlSync() {
  let t: ReturnType<typeof setTimeout> | null = null;
  subscribe(() => {
    if (t) clearTimeout(t);
    t = setTimeout(() => {
      const s = getState();
      const enc = encodeState(s);
      if ('#' + enc === lastHash) return;
      lastHash = '#' + enc;
      history.replaceState(null, '', lastHash);
    }, 200);
  });
  window.addEventListener('hashchange', () => {
    if (location.hash === lastHash) return;
    lastHash = location.hash;
    const v = decodeState(location.hash);
    const s = getState();
    if (v.seed !== s.seed) {
      resetWorld(v.seed, false);
    }
    setState({ tab: v.tab, live: v.live, spanSec: v.spanSec, from: v.from, to: v.to, q: v.q, chips: v.chips, logScale: v.logScale });
  });
}

export function boot() {
  const v = decodeState(location.hash);
  const theme = (document.documentElement.getAttribute('data-theme') as 'dark' | 'light') || 'dark';
  let saved = DEFAULT_SAVED;
  try {
    const raw = safe.get('pulse.saved');
    if (raw) saved = JSON.parse(raw);
  } catch {
    /* ignore */
  }
  let mission = emptyMission();
  try {
    const raw = safe.get(MISSION_KEY);
    if (raw) mission = { ...mission, ...JSON.parse(raw), highlight: null };
  } catch {
    /* ignore */
  }
  // The tour is tied to the default seed's story; a shared link with an explicit view should not nag.
  setState({
    theme,
    saved,
    mission,
    tab: v.tab,
    seed: v.seed,
    live: v.live,
    spanSec: v.spanSec,
    from: v.from,
    to: v.to,
    q: v.q,
    chips: v.chips,
    logScale: v.logScale,
    rules: DEFAULT_RULES.map((r) => ({ ...r })),
  });
  lastHash = location.hash;
  startMissionWatcher();
  startLogController();
  startUrlSync();
  startSim(v.seed, getState().rules);
  // Debug/measurement handle (read-only usage by the e2e scripts).
  (window as unknown as Record<string, unknown>).__pulse = { getState, setState, data, getView };
  void setHover;
  void fmtClock;
}
