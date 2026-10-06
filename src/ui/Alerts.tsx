import { useEffect, useMemo, useRef } from 'react';
import { evaluateSeries } from '../engine/alerts';
import { TimeSeriesChart } from '../render/timeseries';
import { AlertRule, METRIC_META, METRICS, MetricId, SERVICES, SERVICE_COLORS, ServiceId, Severity, seriesIndex } from '../shared/types';
import { closeEditor, declareIncident, deleteRule, openEditor, saveRule, setRange, setTab, toggleRule, updateEditor, getView } from '../state/actions';
import { data, hoverBus } from '../state/data';
import { fmtClock, fmtDuration, fmtNum } from '../state/format';
import { setState, useStore } from '../state/store';
import { frozenHost } from './chartHost';
import { Icon } from './Icon';

const sevLabel: Record<Severity, string> = { sev1: 'SEV1', sev2: 'SEV2', sev3: 'SEV3' };
export const ruleExpr = (r: AlertRule) =>
  `${r.metric} ${r.op} ${r.threshold}${METRIC_META[r.metric].unit === '%' ? '%' : METRIC_META[r.metric].unit === 'ms' ? 'ms' : ''} for ${r.windowSec}s on ${r.service}`;

export function AlertsPage() {
  const rules = useStore((s) => s.rules);
  const alerts = useStore((s) => s.alerts);
  const hl = useStore((s) => s.mission.highlight === 'declare');
  useStore((s) => s.liveTick);
  const sorted = [...alerts].sort((a, b) => (a.resolvedAt == null ? 0 : 1) - (b.resolvedAt == null ? 0 : 1) || b.firedAt - a.firedAt);
  const firing = alerts.filter((a) => a.resolvedAt == null).length;
  const now = data.latestT();
  return (
    <div className="page alerts">
      <section className="card" aria-label="Alert rules">
        <div className="card-head">
          <h2 className="card-title">Alert rules</h2>
          <button className="btn primary" onClick={() => openEditor()}>
            <Icon name="plus" /> New rule
          </button>
        </div>
        <ul className="rules">
          {rules.map((r) => {
            const live = alerts.filter((a) => a.ruleId === r.id && a.resolvedAt == null).length;
            return (
              <li key={r.id} className={r.enabled ? '' : 'off'}>
                <label className="switch" title={r.enabled ? 'Disable rule' : 'Enable rule'}>
                  <input type="checkbox" checked={r.enabled} onChange={() => toggleRule(r.id)} aria-label={`Rule ${r.name} enabled`} />
                  <span />
                </label>
                <div className="rule-main">
                  <b>{r.name}</b>
                  <code>{ruleExpr(r)}</code>
                </div>
                <span className={`sev ${r.severity}`}>{sevLabel[r.severity]}</span>
                <span className="rule-state">{!r.enabled ? 'disabled' : live ? <span className="firing-pill">{live} firing</span> : 'evaluating'}</span>
                <div className="rule-actions">
                  <button className="icon-btn" aria-label={`Edit rule ${r.name}`} onClick={() => openEditor(r, false)}>
                    <Icon name="edit" />
                  </button>
                  <button className="icon-btn" aria-label={`Delete rule ${r.name}`} onClick={() => deleteRule(r.id)}>
                    <Icon name="trash" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
      <section className="card" aria-label="Alerts">
        <div className="card-head">
          <h2 className="card-title">
            Alerts <span className="count">{firing} firing</span>
          </h2>
        </div>
        {sorted.length === 0 ? (
          <div className="empty">No alerts yet. Rules are evaluated continuously in the worker.</div>
        ) : (
          <div className="table-wrap">
            <table className="alert-table">
              <thead>
                <tr>
                  <th>State</th>
                  <th>Sev</th>
                  <th>Rule</th>
                  <th>Service</th>
                  <th>Started</th>
                  <th>Duration</th>
                  <th>Peak</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {sorted.map((a) => (
                  <tr key={a.id} className={a.resolvedAt == null ? 'firing' : ''} data-alert={a.id}>
                    <td>
                      <span className={`state ${a.resolvedAt == null ? 'fire' : 'ok'}`}>{a.resolvedAt == null ? 'Firing' : 'Resolved'}</span>
                    </td>
                    <td>
                      <span className={`sev ${a.severity}`}>{sevLabel[a.severity]}</span>
                    </td>
                    <td>{a.ruleName}</td>
                    <td>
                      <i className="swatch" style={{ background: SERVICE_COLORS[a.service] }} /> {a.service}
                    </td>
                    <td>{fmtClock(a.firedAt)}</td>
                    <td>{fmtDuration((a.resolvedAt ?? now) - a.firedAt)}</td>
                    <td>
                      {fmtNum(a.peak, METRIC_META[a.metric].unit)}
                    </td>
                    <td className="row-actions">
                      <button className="btn small ghost" onClick={() => (setRange(a.firedAt - 20 * 60_000, (a.resolvedAt ?? now) + 10 * 60_000), setTab('overview'))}>
                        Show in charts
                      </button>
                      {a.incidentId ? (
                        <button className="btn small" onClick={() => declareIncident(a.id)}>
                          {a.incidentId}
                        </button>
                      ) : (
                        <button className={`btn small primary ${hl && a.resolvedAt == null ? 'pulse' : ''}`} onClick={() => declareIncident(a.id)}>
                          Declare incident
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}

function Preview({ rule }: { rule: AlertRule }) {
  const hostEl = useRef<HTMLDivElement>(null);
  const chartRef = useRef<TimeSeriesChart | null>(null);
  const view = useMemo(() => {
    const v = getView();
    return { from: v.from, to: v.to };
    // freeze the range when the editor opens so editing is stable
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const targets: ServiceId[] = rule.service === 'any' ? [...SERVICES] : [rule.service];
  const mi = METRICS.indexOf(rule.metric);
  const intervals = useMemo(() => {
    const out: Array<{ svc: ServiceId; start: number; end: number | null; peak: number }> = [];
    for (const s of targets) {
      const vals = data.series[seriesIndex(SERVICES.indexOf(s), mi)];
      for (const iv of evaluateSeries(vals, data.t0, data.step, data.count, view.from, view.to, rule)) out.push({ svc: s, ...iv });
    }
    return out.sort((a, b) => a.start - b.start);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule.metric, rule.service, rule.op, rule.threshold, rule.windowSec, view]);

  useEffect(() => {
    const c = new TimeSeriesChart(hostEl.current!, frozenHost(view), 'Alert preview');
    chartRef.current = c;
    const off = hoverBus.on(() => c.invalidateOverlay());
    return () => {
      off();
      c.destroy();
    };
  }, [view]);
  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.setUnit(METRIC_META[rule.metric].unit);
    c.setSeries(targets.map((s) => ({ id: s, label: s, color: SERVICE_COLORS[s], values: data.series[seriesIndex(SERVICES.indexOf(s), mi)], hidden: false })));
    c.setThresholds([{ value: rule.threshold, label: `threshold ${rule.threshold}` }]);
    c.setPreviewBands(intervals.map((iv) => ({ from: iv.start, to: iv.end ?? view.to + 60_000, color: 'rgba(248,113,113,0.18)' })));
    c.invalidate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rule.metric, rule.service, rule.threshold, intervals]);

  const first = intervals[0];
  return (
    <div className="preview">
      <div className="preview-chart" ref={hostEl} data-chart="preview" />
      <p className="preview-sum" role="status" aria-live="polite" data-testid="preview-sum">
        {intervals.length === 0
          ? `Would not have fired in this range (${fmtClock(view.from, false)} to ${fmtClock(view.to, false)} UTC).`
          : `Would have fired ${intervals.length} time${intervals.length > 1 ? 's' : ''} in this range; first on ${first.svc} at ${fmtClock(first.start)} UTC, peak ${fmtNum(Math.max(...intervals.map((i) => i.peak)), METRIC_META[rule.metric].unit)}.`}
      </p>
    </div>
  );
}

export function RuleEditor() {
  const ed = useStore((s) => s.editor);
  const dlg = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!ed) return;
    const prev = document.activeElement as HTMLElement | null;
    dlg.current?.querySelector<HTMLElement>('input,select')?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeEditor();
      if (e.key === 'Tab' && dlg.current) {
        const f = [...dlg.current.querySelectorAll<HTMLElement>('input,select,button:not([disabled])')];
        if (!f.length) return;
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) (e.preventDefault(), last.focus());
        else if (!e.shiftKey && document.activeElement === last) (e.preventDefault(), first.focus());
      }
    };
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [!!ed]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!ed) return null;
  const r = ed.rule;
  const unit = METRIC_META[r.metric].unit;
  return (
    <div className="modal-back" onMouseDown={(e) => e.target === e.currentTarget && closeEditor()}>
      <div className="modal" role="dialog" aria-modal="true" aria-labelledby="ed-title" ref={dlg}>
        <header>
          <h2 id="ed-title">{ed.isNew ? 'Create alert rule' : 'Edit alert rule'}</h2>
          <button className="icon-btn" aria-label="Close" onClick={closeEditor}>
            <Icon name="x" />
          </button>
        </header>
        <div className="modal-body">
          <form
            className="form"
            onSubmit={(e) => {
              e.preventDefault();
              saveRule();
            }}
          >
            <label>
              Name
              <input value={r.name} onChange={(e) => updateEditor({ name: e.target.value })} />
            </label>
            <div className="two">
              <label>
                Metric
                <select value={r.metric} onChange={(e) => updateEditor({ metric: e.target.value as MetricId })}>
                  {METRICS.map((m) => (
                    <option key={m} value={m}>
                      {METRIC_META[m].label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Service
                <select value={r.service} onChange={(e) => updateEditor({ service: e.target.value as ServiceId | 'any' })}>
                  <option value="any">any service</option>
                  {SERVICES.map((s) => (
                    <option key={s}>{s}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="three">
              <label>
                Condition
                <select value={r.op} onChange={(e) => updateEditor({ op: e.target.value as '>' | '<' })}>
                  <option value=">">above</option>
                  <option value="<">below</option>
                </select>
              </label>
              <label>
                Threshold ({unit})
                <input type="number" step="any" value={r.threshold} onChange={(e) => updateEditor({ threshold: Number(e.target.value) })} />
              </label>
              <label>
                For (seconds)
                <input type="number" min={5} step={5} value={r.windowSec} onChange={(e) => updateEditor({ windowSec: Math.max(5, Number(e.target.value) || 5) })} />
              </label>
            </div>
            <label>
              Severity
              <select value={r.severity} onChange={(e) => updateEditor({ severity: e.target.value as Severity })}>
                <option value="sev1">SEV1 critical</option>
                <option value="sev2">SEV2 major</option>
                <option value="sev3">SEV3 minor</option>
              </select>
            </label>
            <p className="dim small-note">Fires when the metric stays {r.op === '>' ? 'above' : 'below'} the threshold continuously for the window. Evaluated every simulated second in the worker.</p>
            <div className="modal-actions">
              <button type="button" className="btn" onClick={closeEditor}>
                Cancel
              </button>
              <button type="submit" className="btn primary" disabled={!r.name.trim() || !isFinite(r.threshold)}>
                Save rule
              </button>
            </div>
          </form>
          <Preview rule={r} />
        </div>
      </div>
    </div>
  );
}

export { setState };
