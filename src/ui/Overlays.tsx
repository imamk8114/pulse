import { useEffect } from 'react';
import { METRICS, SERVICES, seriesIndex } from '../shared/types';
import { dismissToast, inspectDeploy, setRange } from '../state/actions';
import { data } from '../state/data';
import { fmtDateTime, fmtNum } from '../state/format';
import { useStore } from '../state/store';
import { Icon } from './Icon';

function avg(si: number, metric: string, from: number, to: number) {
  const arr = data.series[seriesIndex(si, METRICS.indexOf(metric as (typeof METRICS)[number]))];
  const i0 = Math.max(0, Math.floor((from - data.t0) / data.step));
  const i1 = Math.min(data.count, Math.ceil((to - data.t0) / data.step));
  let s = 0;
  for (let i = i0; i < i1; i++) s += arr[i];
  return i1 > i0 ? s / (i1 - i0) : NaN;
}

export function DeployPopover() {
  const d = useStore((s) => s.deployPop);
  useEffect(() => {
    if (!d) return;
    const f = (e: KeyboardEvent) => e.key === 'Escape' && inspectDeploy(null);
    document.addEventListener('keydown', f);
    return () => document.removeEventListener('keydown', f);
  }, [d]);
  if (!d) return null;
  const si = SERVICES.indexOf(d.service);
  const before = avg(si, 'p95', d.ts - 10 * 60_000, d.ts);
  const after = avg(si, 'p95', d.ts + 3 * 60_000, Math.min(d.ts + 13 * 60_000, data.latestT()));
  const eb = avg(si, 'err', d.ts - 10 * 60_000, d.ts);
  const ea = avg(si, 'err', d.ts + 3 * 60_000, Math.min(d.ts + 13 * 60_000, data.latestT()));
  const worse = after / before > 1.5;
  return (
    <div className="deploy-pop" role="dialog" aria-label={`Deploy ${d.service} ${d.version}`} data-testid="deploy-pop">
      <header>
        <b>
          {d.kind === 'rollback' ? 'Rollback' : 'Deploy'} · {d.service} {d.version}
        </b>
        <button className="icon-btn" aria-label="Close deploy details" onClick={() => inspectDeploy(null)}>
          <Icon name="x" />
        </button>
      </header>
      <p className="dim">{fmtDateTime(d.ts)}</p>
      <p>
        <b>{d.author}</b>: {d.message}
      </p>
      <dl>
        <div>
          <dt>p95 10m before</dt>
          <dd>{fmtNum(before, 'ms')}</dd>
        </div>
        <div>
          <dt>p95 3 to 13m after</dt>
          <dd className={worse ? 'bad' : ''}>{isNaN(after) ? 'n/a' : fmtNum(after, 'ms')}</dd>
        </div>
        <div>
          <dt>error rate before</dt>
          <dd>{fmtNum(eb, '%')}</dd>
        </div>
        <div>
          <dt>error rate after</dt>
          <dd className={ea > 3 ? 'bad' : ''}>{isNaN(ea) ? 'n/a' : fmtNum(ea, '%')}</dd>
        </div>
      </dl>
      {worse && <p className="verdict">p95 rose {(after / before).toFixed(1)}x after this deploy. A strong suspect.</p>}
      <button className="btn small" onClick={() => setRange(d.ts - 15 * 60_000, d.ts + 30 * 60_000)}>
        Zoom to this deploy
      </button>
    </div>
  );
}

export function Toasts() {
  const toasts = useStore((s) => s.toasts);
  const announce = useStore((s) => s.announce);
  const missionAnnounce = useStore((s) => s.missionAnnounce);
  return (
    <>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true" data-testid="live-region">
        {announce}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">
        {missionAnnounce}
      </div>
      <div className="toasts" aria-live="off">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.text}</span>
            <button className="icon-btn" aria-label="Dismiss notification" onClick={() => dismissToast(t.id)}>
              <Icon name="x" size={12} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}

export function Loading() {
  const loaded = useStore((s) => s.loaded);
  const p = useStore((s) => s.progress);
  if (loaded) return null;
  return (
    <div className="loading" role="status">
      <div className="loading-card">
        <svg width="34" height="34" viewBox="0 0 32 32" aria-hidden>
          <path d="M3 17h6l3-9 5 17 4-12 2 4h6" fill="none" stroke="var(--ok)" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
        <b>Warming up the simulator</b>
        <p className="dim">Generating 28 hours of 1-second metrics for 8 services and 240,000 log lines in a Web Worker.</p>
        <div className="progress">
          <span style={{ width: `${Math.round(p * 100)}%` }} />
        </div>
      </div>
    </div>
  );
}
