import { useEffect, useMemo, useRef, useState } from 'react';
import { ChartSeries, TimeSeriesChart } from '../render/timeseries';
import { activeServices, getView, openRuleFromChart, toggleServiceFilter } from '../state/actions';
import { data, dataBus, hoverBus, setHover } from '../state/data';
import { getState, setState, subscribe, useStore } from '../state/store';
import { METRIC_META, METRICS, MetricId, SERVICES, SERVICE_COLORS, ServiceId, seriesIndex } from '../shared/types';
import { chartHost } from './chartHost';
import { Icon } from './Icon';

export type ChartKind = { type: 'metric'; metric: MetricId } | { type: 'pct' };

const PCT = [
  { id: 'p50', label: 'p50', color: '#4fc3a1' },
  { id: 'p95', label: 'p95', color: '#f2a33a' },
  { id: 'p99', label: 'p99', color: '#f0605d' },
];

export function ChartPanel({ kind, title }: { kind: ChartKind; title?: string }) {
  const host = useRef<HTMLDivElement>(null);
  const chartRef = useRef<TimeSeriesChart | null>(null);
  const chips = useStore((s) => s.chips);
  const logScale = useStore((s) => s.logScale);
  const rules = useStore((s) => s.rules);
  const incidents = useStore((s) => s.incidents);
  const loaded = useStore((s) => s.loaded);
  const [hidden, setHidden] = useState<Set<string>>(new Set());

  const metric: MetricId = kind.type === 'metric' ? kind.metric : 'p95';
  const unit = METRIC_META[metric].unit;
  const sel = activeServices(chips);
  const pctSvc: ServiceId = sel?.[0] ?? ((data.scenario?.culprit as ServiceId) ?? 'checkout');
  const heading = title ?? (kind.type === 'pct' ? `Latency percentiles · ${pctSvc}` : METRIC_META[metric].label);

  const defs = useMemo(() => {
    if (kind.type === 'pct') {
      const si = SERVICES.indexOf(pctSvc);
      return PCT.map((p) => ({ id: p.id, label: p.label, color: p.color, idx: seriesIndex(si, METRICS.indexOf(p.id as MetricId)) }));
    }
    const mi = METRICS.indexOf(kind.metric);
    return SERVICES.map((s, si) => ({ id: s as string, label: s as string, color: SERVICE_COLORS[s], idx: seriesIndex(si, mi) })).filter((d) => !sel || sel.includes(d.id as ServiceId));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kind.type, metric, pctSvc, JSON.stringify(sel)]);

  useEffect(() => {
    const c = new TimeSeriesChart(host.current!, chartHost, heading);
    chartRef.current = c;
    let sig = '';
    const offs = [
      subscribe(() => {
        const s = getState();
        const n = `${s.live}|${s.spanSec}|${s.from}|${s.to}|${s.mission.highlight}`;
        if (n !== sig) {
          sig = n;
          c.invalidate();
        }
      }),
      dataBus.on(() => {
        if (getState().live || data.count < 2000) c.invalidate();
      }),
      hoverBus.on(() => c.invalidateOverlay()),
    ];
    return () => {
      offs.forEach((o) => o());
      c.destroy();
      chartRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const c = chartRef.current;
    if (!c) return;
    c.setUnit(unit);
    const series: ChartSeries[] = defs.map((d) => ({ id: d.id, label: d.label, color: d.color, values: data.series[d.idx], hidden: hidden.has(d.id) }));
    c.setSeries(series);
    c.setLog(logScale);
    const shown = new Set(defs.map((d) => d.id));
    c.setThresholds(
      rules
        .filter((r) => r.enabled && r.metric === metric && (r.service === 'any' || (kind.type === 'pct' ? r.service === pctSvc : shown.has(r.service))))
        .map((r) => ({ value: r.threshold, label: `${r.name} ${r.op} ${r.threshold}${unit === '%' || unit === 'ms' ? unit : ''}` })),
    );
    c.setBands(
      incidents.map((i) => ({ from: i.createdAt, to: i.resolvedAt ?? data.latestT(), color: 'rgba(248,113,113,0.10)' })),
    );
    c.invalidate();
  }, [defs, hidden, logScale, rules, incidents, loaded, metric, unit, kind.type, pctSvc]);

  const toggle = (id: string) =>
    setHidden((h) => {
      const n = new Set(h);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  return (
    <section className="chart-card" aria-label={heading}>
      <header className="chart-head">
        <h3>
          {heading}
          <span className="unit">{unit}</span>
        </h3>
        <div className="chart-actions">
          <button className={`mini ${logScale ? 'on' : ''}`} aria-pressed={logScale} onClick={() => setState({ logScale: !logScale })} title="Toggle log / linear y axis">
            {logScale ? 'log' : 'linear'}
          </button>
          <button className="mini" onClick={() => openRuleFromChart(metric, kind.type === 'pct' ? pctSvc : undefined)} title="Create an alert rule from this chart" aria-label={`Create alert rule from ${heading}`}>
            <Icon name="bell" /> Alert
          </button>
        </div>
      </header>
      <ul className="legend" aria-label="Series legend. Press to toggle a series.">
        {defs.map((d) => (
          <li key={d.id}>
            <button
              className={`lg ${hidden.has(d.id) ? 'off' : ''}`}
              aria-pressed={!hidden.has(d.id)}
              onClick={() => toggle(d.id)}
              onDoubleClick={() => kind.type === 'metric' && toggleServiceFilter(d.id as ServiceId)}
              onMouseEnter={() => setHover(null, d.id, 'legend')}
              onMouseLeave={() => setHover(null, null, 'legend')}
              onFocus={() => setHover(null, d.id, 'legend')}
              onBlur={() => setHover(null, null, 'legend')}
            >
              <i style={{ background: d.color }} />
              {d.label}
            </button>
          </li>
        ))}
      </ul>
      <div className="chart-canvas" ref={host} data-chart={heading} data-metric={metric}>
        {!loaded && <div className="skeleton" aria-hidden />}
      </div>
    </section>
  );
}

export { getView };
