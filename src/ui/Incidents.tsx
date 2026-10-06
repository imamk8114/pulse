import { useMemo, useState } from 'react';
import { Severity } from '../shared/types';
import {
  addNote,
  assignIncident,
  copySummary,
  incidentSummary,
  RESPONDERS,
  rollbackService,
  setIncidentSeverity,
  setIncidentStatus,
  showIncidentInCharts,
  toggleCheck,
  setTab,
} from '../state/actions';
import { data } from '../state/data';
import { fmtClock, fmtDuration } from '../state/format';
import { Incident, setState, STATUS_STEPS, useStore } from '../state/store';
import { Icon } from './Icon';

interface Row {
  ts: number;
  kind: string;
  text: string;
  sub?: string;
}

function Timeline({ inc }: { inc: Incident }) {
  const alerts = useStore((s) => s.alerts);
  useStore((s) => s.liveTick);
  const rows = useMemo(() => {
    const out: Row[] = [];
    const first = alerts.filter((a) => inc.alertIds.includes(a.id)).reduce((m, a) => Math.min(m, a.firedAt), inc.createdAt);
    for (const d of data.deploys) {
      if (d.service === inc.service && d.ts >= first - 90 * 60_000 && d.ts <= (inc.resolvedAt ?? data.latestT()) + 1)
        out.push({ ts: d.ts, kind: d.kind === 'rollback' ? 'rollback' : 'deploy', text: `${d.kind === 'rollback' ? 'Rollback' : 'Deploy'} ${d.service} ${d.version}`, sub: `${d.author}: ${d.message}` });
    }
    for (const a of alerts) {
      if (!inc.alertIds.includes(a.id)) continue;
      out.push({ ts: a.firedAt, kind: 'alert', text: `Alert fired: ${a.ruleName}`, sub: `${a.service}, ${a.severity.toUpperCase()}` });
      if (a.resolvedAt) out.push({ ts: a.resolvedAt, kind: 'ok', text: `Alert resolved: ${a.ruleName}` });
    }
    for (const e of inc.events) out.push({ ts: e.ts, kind: e.kind === 'note' ? 'note' : 'event', text: e.text });
    return out.sort((a, b) => a.ts - b.ts);
  }, [inc, alerts]);
  return (
    <ol className="timeline" aria-label="Incident timeline">
      {rows.map((r, i) => (
        <li key={i} className={`tl-${r.kind}`}>
          <time>{fmtClock(r.ts)}</time>
          <span className="tl-dot" />
          <div>
            <b>{r.text}</b>
            {r.sub && <span className="dim"> {r.sub}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
}

function Detail({ inc }: { inc: Incident }) {
  const [note, setNote] = useState('');
  const [preview, setPreview] = useState(false);
  const hl = useStore((s) => s.mission.highlight === 'resolve');
  const copied = useStore((s) => s.mission.flags.summaryCopied);
  useStore((s) => s.liveTick);
  const stepIdx = STATUS_STEPS.indexOf(inc.status);
  const done = inc.checklist.filter((c) => c.done).length;
  const end = inc.resolvedAt ?? data.latestT();
  return (
    <article className="incident" aria-label={`Incident ${inc.id}`}>
      <header className="inc-head">
        <div>
          <span className="inc-id">{inc.id}</span>
          <h2>{inc.title}</h2>
          <p className="dim">
            {inc.service} · opened {fmtClock(inc.createdAt)} UTC · {inc.resolvedAt ? `resolved after ${fmtDuration(end - inc.createdAt)}` : `open for ${fmtDuration(end - inc.createdAt)}`}
          </p>
        </div>
        <div className="inc-actions">
          <button className="btn" onClick={() => showIncidentInCharts(inc)}>
            <Icon name="target" /> Show in charts
          </button>
          <button className="btn" onClick={() => rollbackService(inc.id)} disabled={inc.events.some((e) => e.kind === 'rollback')}>
            <Icon name="reset" /> Roll back latest deploy
          </button>
          <button className={`btn primary ${hl && inc.status === 'resolved' && !copied ? 'pulse' : ''}`} onClick={() => copySummary(inc)}>
            <Icon name="copy" /> {copied ? 'Copy summary again' : 'Copy summary'}
          </button>
        </div>
      </header>
      <ol className="steps" aria-label="Incident status">
        {STATUS_STEPS.map((st, i) => (
          <li key={st}>
            <button
              className={`step ${i < stepIdx ? 'past' : ''} ${i === stepIdx ? 'now' : ''} ${hl && i === STATUS_STEPS.length - 1 && inc.status !== 'resolved' ? 'pulse' : ''}`}
              aria-current={i === stepIdx ? 'step' : undefined}
              onClick={() => setIncidentStatus(inc.id, st)}
            >
              <span className="num">{i < stepIdx ? <Icon name="check" size={12} /> : i + 1}</span>
              {st}
            </button>
          </li>
        ))}
      </ol>
      <div className="inc-grid">
        <section className="card" aria-label="Details">
          <h3 className="card-title">Details</h3>
          <div className="form compact">
            <label>
              Severity
              <select value={inc.severity} onChange={(e) => setIncidentSeverity(inc.id, e.target.value as Severity)}>
                <option value="sev1">SEV1</option>
                <option value="sev2">SEV2</option>
                <option value="sev3">SEV3</option>
              </select>
            </label>
            <label>
              Responder
              <select value={inc.responder} onChange={(e) => assignIncident(inc.id, e.target.value)}>
                {RESPONDERS.map((r) => (
                  <option key={r}>{r}</option>
                ))}
              </select>
            </label>
          </div>
          <h3 className="card-title sub">
            Runbook <span className="count">{done}/{inc.checklist.length}</span>
          </h3>
          <ul className="checklist">
            {inc.checklist.map((c) => (
              <li key={c.id}>
                <label>
                  <input type="checkbox" checked={c.done} onChange={() => toggleCheck(inc.id, c.id)} />
                  <span>{c.text}</span>
                </label>
              </li>
            ))}
          </ul>
        </section>
        <section className="card" aria-label="Timeline">
          <h3 className="card-title">Timeline</h3>
          <Timeline inc={inc} />
          <form
            className="note-form"
            onSubmit={(e) => {
              e.preventDefault();
              addNote(inc.id, note);
              setNote('');
            }}
          >
            <input placeholder="Add a note to the timeline" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Add a note" />
            <button className="btn" disabled={!note.trim()}>
              Add
            </button>
          </form>
        </section>
      </div>
      <details className="card summary-card" open={preview} onToggle={(e) => setPreview((e.target as HTMLDetailsElement).open)}>
        <summary>Post-mortem summary preview</summary>
        {preview && <pre className="summary">{incidentSummary(inc)}</pre>}
      </details>
    </article>
  );
}

export function IncidentsPage() {
  const incidents = useStore((s) => s.incidents);
  const openId = useStore((s) => s.openIncidentId);
  const inc = incidents.find((i) => i.id === openId) ?? incidents[0];
  if (!inc)
    return (
      <div className="page">
        <div className="card empty-card">
          <h2>No incidents yet</h2>
          <p className="dim">Incidents start from an alert. Open Alerts and press “Declare incident” on a firing alert, or ask the mission panel to show you.</p>
          <button className="btn primary" onClick={() => setTab('alerts')}>
            Go to Alerts
          </button>
        </div>
      </div>
    );
  return (
    <div className="page incidents">
      {incidents.length > 1 && (
        <nav className="inc-tabs" aria-label="Incidents">
          {incidents.map((i) => (
            <button key={i.id} className={i.id === inc.id ? 'on' : ''} onClick={() => setState({ openIncidentId: i.id })}>
              {i.id} <span className={`sev ${i.severity}`}>{i.severity.toUpperCase()}</span>
            </button>
          ))}
        </nav>
      )}
      <Detail inc={inc} />
    </div>
  );
}
