import { useMemo, useState } from 'react';
import { EDGES, SERVICES, ServiceId } from '../shared/types';
import { activeServices, showMe, toggleServiceFilter } from '../state/actions';
import { data } from '../state/data';
import { fmtNum } from '../state/format';
import { computeHealth, Health } from '../state/health';
import { useStore } from '../state/store';
import { ChartPanel } from './ChartPanel';

const POS: Record<ServiceId, [number, number]> = {
  gateway: [70, 140],
  auth: [215, 42],
  checkout: [225, 140],
  search: [215, 238],
  payments: [385, 64],
  inventory: [385, 176],
  notifications: [385, 252],
  'orders-db': [535, 130],
};
const STATUS_COLOR = { healthy: 'var(--ok)', degraded: 'var(--warn)', critical: 'var(--danger)' } as const;

function useHealth(): Health[] {
  const tick = useStore((s) => s.liveTick);
  const loaded = useStore((s) => s.loaded);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (loaded ? SERVICES.map((_, i) => computeHealth(i)) : []), [tick, loaded]);
}

export function AnomalyBanner({ health }: { health: Health[] }) {
  const worst = health.filter((h) => h.status === 'critical').sort((a, b) => b.p95Ratio - a.p95Ratio)[0];
  if (!worst) return null;
  const dep = [...data.deploys].reverse().find((d) => d.service === worst.service && d.kind === 'deploy');
  return (
    <div className="banner" role="status">
      <span className="dot crit" />
      <div>
        <strong>{worst.service}</strong> is critical: p95 {fmtNum(worst.p95, 'ms')} ({worst.p95Ratio.toFixed(1)}x baseline), error rate {fmtNum(worst.err, '%')}.
        {dep && <> Latest deploy: {dep.version} by {dep.author}.</>}
      </div>
      <button className="btn small" onClick={() => showMe('zoom')}>
        Zoom to the change
      </button>
    </div>
  );
}

function Tiles({ health }: { health: Health[] }) {
  const chips = useStore((s) => s.chips);
  const sel = activeServices(chips);
  const [, setH] = useState<string | null>(null);
  return (
    <div className="tiles" role="list" aria-label="Service health">
      {health.map((h) => (
        <button
          key={h.service}
          role="listitem"
          className={`tile ${h.status} ${sel?.includes(h.service) ? 'sel' : ''}`}
          aria-pressed={!!sel?.includes(h.service)}
          onClick={() => toggleServiceFilter(h.service)}
          onMouseEnter={() => setH(h.service)}
          title={`${h.service}: ${h.reason}. Click to filter everything to this service.`}
        >
          <span className="tile-top">
            <span className={`dot ${h.status === 'critical' ? 'crit' : h.status === 'degraded' ? 'warn' : 'ok'}`} />
            <b>{h.service}</b>
            <span className="tile-status">{h.status}</span>
          </span>
          <span className="tile-metrics">
            <span>
              <i>p95</i> {fmtNum(h.p95, 'ms')}
            </span>
            <span>
              <i>err</i> {fmtNum(h.err, '%')}
            </span>
            <span>
              <i>rps</i> {fmtNum(h.rps)}
            </span>
          </span>
          <svg viewBox="0 0 100 28" preserveAspectRatio="none" className="spark" aria-hidden>
            <polyline points={h.spark} fill="none" stroke={STATUS_COLOR[h.status]} strokeWidth="1.6" vectorEffect="non-scaling-stroke" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function Topology({ health }: { health: Health[] }) {
  const [hov, setHov] = useState<ServiceId | null>(null);
  const chips = useStore((s) => s.chips);
  const sel = activeServices(chips);
  const status = (s: ServiceId) => health.find((h) => h.service === s)?.status ?? 'healthy';
  const related = useMemo(() => {
    const set = new Set<string>();
    if (hov) {
      set.add(hov);
      for (const [a, b] of EDGES) {
        if (a === hov) set.add(b);
        if (b === hov) set.add(a);
      }
    }
    return set;
  }, [hov]);
  const dim = (a: ServiceId, b?: ServiceId) => !!hov && !(b ? (a === hov || b === hov) : related.has(a));
  return (
    <div className="topo" aria-label="Service topology">
      <svg viewBox="0 0 600 300" role="group" aria-label="Service dependency graph. Hover or focus a service to highlight its dependencies.">
        <defs>
          <marker id="arr" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="var(--text-dim)" />
          </marker>
          <marker id="arr-hot" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
            <path d="M0 0 10 5 0 10z" fill="var(--accent)" />
          </marker>
        </defs>
        {EDGES.map(([a, b]) => {
          const [x1, y1] = POS[a];
          const [x2, y2] = POS[b];
          const dx = x2 - x1;
          const dy = y2 - y1;
          const len = Math.hypot(dx, dy);
          const ux = dx / len;
          const uy = dy / len;
          const hot = hov && (a === hov || b === hov);
          const bad = status(b) === 'critical' || status(a) === 'critical';
          return (
            <line
              key={a + b}
              x1={x1 + ux * 26}
              y1={y1 + uy * 26}
              x2={x2 - ux * 30}
              y2={y2 - uy * 30}
              className={`edge ${hot ? 'hot' : ''} ${bad ? 'bad' : ''} ${dim(a, b) ? 'dim' : ''}`}
              markerEnd={hot ? 'url(#arr-hot)' : 'url(#arr)'}
            />
          );
        })}
        {SERVICES.map((s) => {
          const [x, y] = POS[s];
          const st = status(s);
          const on = !!sel?.includes(s);
          return (
            <g
              key={s}
              className={`node ${dim(s) ? 'dim' : ''} ${on ? 'sel' : ''} ${st}`}
              transform={`translate(${x},${y})`}
              tabIndex={0}
              role="button"
              aria-pressed={on}
              aria-label={`${s}, ${st}. Press to filter to this service.`}
              onMouseEnter={() => setHov(s)}
              onMouseLeave={() => setHov(null)}
              onFocus={() => setHov(s)}
              onBlur={() => setHov(null)}
              onClick={() => toggleServiceFilter(s)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  toggleServiceFilter(s);
                }
              }}
            >
              <circle r="24" fill="var(--panel-2)" stroke={STATUS_COLOR[st]} strokeWidth={on ? 4 : 2.5} />
              <circle r="31" fill="none" stroke={STATUS_COLOR[st]} className="halo" opacity={st === 'critical' ? 0.5 : 0} />
              <text y="4" textAnchor="middle" className="node-label">
                {s === 'notifications' ? 'notify' : s === 'orders-db' ? 'orders-db' : s}
              </text>
            </g>
          );
        })}
      </svg>
      <p className="topo-hint">
        {hov ? `${hov} calls ${EDGES.filter((e) => e[0] === hov).map((e) => e[1]).join(', ') || 'nothing'}; called by ${EDGES.filter((e) => e[1] === hov).map((e) => e[0]).join(', ') || 'nothing'}` : 'Hover a service to see its dependencies. Click to filter every chart and log.'}
      </p>
    </div>
  );
}

export function Overview() {
  const health = useHealth();
  const chips = useStore((s) => s.chips);
  return (
    <div className="page overview">
      <AnomalyBanner health={health} />
      <div className="top-grid">
        <section className="card" aria-label="Service health overview">
          <h2 className="card-title">Services {activeServices(chips) && <span className="filter-note">filtered</span>}</h2>
          <Tiles health={health} />
        </section>
        <section className="card" aria-label="Topology">
          <h2 className="card-title">Topology</h2>
          <Topology health={health} />
        </section>
      </div>
      <div className="chart-grid">
        <ChartPanel kind={{ type: 'metric', metric: 'p95' }} title="Latency p95" />
        <ChartPanel kind={{ type: 'metric', metric: 'err' }} />
        <ChartPanel kind={{ type: 'pct' }} />
        <ChartPanel kind={{ type: 'metric', metric: 'rps' }} />
        <ChartPanel kind={{ type: 'metric', metric: 'cpu' }} />
        <ChartPanel kind={{ type: 'metric', metric: 'mem' }} />
        <ChartPanel kind={{ type: 'metric', metric: 'queue' }} />
      </div>
    </div>
  );
}
