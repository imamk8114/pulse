import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { buildTrace } from '../engine/trace';
import { LogHistogram } from '../render/histogram';
import { HOSTS, LEVELS, REGIONS, SERVICES, SERVICE_COLORS, ServiceId } from '../shared/types';
import { TEMPLATES } from '../shared/logTemplates';
import { addChip, removeChip, setLive, setQuery } from '../state/actions';
import { data, dataBus, hoverBus } from '../state/data';
import { fmtClock, fmtDateTime, fmtNum } from '../state/format';
import { getState, setState, subscribe, useStore } from '../state/store';
import { chartHost } from './chartHost';
import { ChartPanel } from './ChartPanel';
import { Icon } from './Icon';
import { QueryBar } from './QueryBar';

const ROW_H = 26;
const OVERSCAN = 8;

function Val({ field, value, children, cls }: { field: string; value: string; children?: React.ReactNode; cls?: string }) {
  const hl = useStore((s) => s.mission.highlight === 'chip');
  return (
    <button
      className={`val ${cls ?? ''} ${hl ? 'pulse' : ''}`}
      title={`Add filter ${field}:${value}`}
      onClick={(e) => {
        e.stopPropagation();
        addChip({ field, value, neg: false }, true);
      }}
      onContextMenu={(e) => {
        e.preventDefault();
        addChip({ field, value, neg: true }, true);
      }}
    >
      {children ?? value}
    </button>
  );
}

function ts3(ms: number) {
  return `${fmtClock(ms)}.${String(Math.floor(ms % 1000)).padStart(3, '0')}`;
}

function LogRow({ idx, top, selected, onSelect, pos, total }: { idx: number; top: number; selected: boolean; onSelect: () => void; pos: number; total: number }) {
  const c = data.logs;
  const svc = SERVICES[c.svc[idx]];
  const lvl = LEVELS[c.lvl[idx]];
  const tmpl = TEMPLATES[c.tmpl[idx]];
  return (
    <div
      role="option"
      id={`log-row-${pos}`}
      aria-selected={selected}
      aria-posinset={pos + 1}
      aria-setsize={total}
      className={`lrow lv-${lvl} ${selected ? 'sel' : ''}`}
      style={{ transform: `translateY(${top}px)`, height: ROW_H }}
      onClick={onSelect}
    >
      <span className="lt">{ts3(c.ts[idx])}</span>
      <span className={`lvl ${lvl}`}>{lvl}</span>
      <span className="lsvc">
        <i style={{ background: SERVICE_COLORS[svc] }} />
        <Val field="service" value={svc} />
      </span>
      <span className="lmsg">{tmpl.text}</span>
      <span className="lmeta">
        <Val field="region" value={REGIONS[c.region[idx]]} />
        <Val field="host" value={HOSTS[c.host[idx]]} />
        <Val field="status" value={String(c.status[idx])} cls={c.status[idx] >= 500 ? 'bad' : ''} />
        <span className={`lat ${c.latency[idx] > 500 ? 'slow' : ''}`}>{c.latency[idx]}ms</span>
      </span>
    </div>
  );
}

function LogList() {
  const lv = useStore((s) => s.logView);
  const live = useStore((s) => s.live);
  const selected = useStore((s) => s.selectedLog);
  const ref = useRef<HTMLDivElement>(null);
  const [scroll, setScroll] = useState(0);
  const [h, setH] = useState(400);
  const prevLen = useRef(0);
  const matches = lv?.res.matches;
  const total = matches?.length ?? 0;

  useEffect(() => {
    const el = ref.current!;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el);
    setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);

  // keep the viewport stable when new rows are prepended while the user is reading older ones
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const grew = total - prevLen.current;
    if (live && grew > 0 && el.scrollTop > ROW_H * 2 && prevLen.current > 0) el.scrollTop += grew * ROW_H;
    prevLen.current = total;
  }, [total, live]);

  const rafRef = useRef(0);
  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      setScroll(ref.current?.scrollTop ?? 0);
    });
  };
  const start = Math.max(0, Math.floor(scroll / ROW_H) - OVERSCAN);
  const end = Math.min(total, Math.ceil((scroll + h) / ROW_H) + OVERSCAN);
  const rows: JSX.Element[] = [];
  if (matches)
    for (let r = start; r < end; r++) {
      const idx = matches[total - 1 - r];
      rows.push(<LogRow key={idx} idx={idx} pos={r} total={total} top={r * ROW_H} selected={selected === idx} onSelect={() => setState({ selectedLog: selected === idx ? null : idx })} />);
    }

  const move = (d: number) => {
    if (!matches || !total) return;
    let r = selected == null ? -1 : total - 1 - matches.indexOf(selected);
    if (selected != null && r === total) r = -1;
    const nr = Math.min(total - 1, Math.max(0, r + d));
    setState({ selectedLog: matches[total - 1 - nr] });
    const el = ref.current!;
    if (nr * ROW_H < el.scrollTop) el.scrollTop = nr * ROW_H;
    else if ((nr + 1) * ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = (nr + 1) * ROW_H - el.clientHeight;
  };
  const atTop = scroll < ROW_H;
  return (
    <div className="loglist-wrap">
      <div className="log-head" aria-hidden>
        <span className="lt">time (UTC)</span>
        <span className="lvl-h">level</span>
        <span className="lsvc-h">service</span>
        <span className="lmsg">message</span>
        <span className="lmeta-h">region · host · status · ms</span>
      </div>
      <div
        ref={ref}
        className="loglist"
        role="listbox"
        tabIndex={0}
        aria-label={`Log lines, ${total.toLocaleString()} matches, newest first. Arrow keys move selection.`}
        aria-activedescendant={selected != null && matches ? `log-row-${total - 1 - matches.indexOf(selected)}` : undefined}
        onScroll={onScroll}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') (e.preventDefault(), move(1));
          else if (e.key === 'ArrowUp') (e.preventDefault(), move(-1));
          else if (e.key === 'PageDown') (e.preventDefault(), move(Math.floor(h / ROW_H)));
          else if (e.key === 'PageUp') (e.preventDefault(), move(-Math.floor(h / ROW_H)));
          else if (e.key === 'Home') ref.current!.scrollTop = 0;
        }}
      >
        <div style={{ height: total * ROW_H, position: 'relative' }}>{rows}</div>
        {lv && total === 0 && <div className="empty">No log lines match in this time range.</div>}
      </div>
      {live && (
        <div className="tail-badge">
          {atTop ? (
            <span className="following">
              <span className="dot live" /> following live tail
            </span>
          ) : (
            <button className="btn small" onClick={() => ref.current && (ref.current.scrollTop = 0)}>
              Jump to latest
            </button>
          )}
        </div>
      )}
      {!live && (
        <div className="tail-badge">
          <button className="btn small" onClick={() => setLive(true)}>
            Resume live tail
          </button>
        </div>
      )}
    </div>
  );
}

function Detail() {
  const idx = useStore((s) => s.selectedLog);
  const logView = useStore((s) => s.logView);
  if (idx == null || !logView) return null;
  const c = data.logs;
  const svc = SERVICES[c.svc[idx]] as ServiceId;
  const t = TEMPLATES[c.tmpl[idx]];
  const spans = buildTrace(c.trace[idx], svc, Math.max(40, c.latency[idx]), data.scenario?.culprit);
  const total = spans[0].duration;
  const traceHex = c.trace[idx].toString(16).padStart(8, '0');
  return (
    <aside className="detail" aria-label="Log detail">
      <header>
        <b>{t.text}</b>
        <button className="icon-btn" aria-label="Close detail" onClick={() => setState({ selectedLog: null })}>
          <Icon name="x" />
        </button>
      </header>
      <dl>
        <div><dt>time</dt><dd>{fmtDateTime(c.ts[idx])}</dd></div>
        <div><dt>service</dt><dd>{svc}</dd></div>
        <div><dt>level</dt><dd>{LEVELS[c.lvl[idx]]}</dd></div>
        <div><dt>host</dt><dd>{HOSTS[c.host[idx]]}</dd></div>
        <div><dt>region</dt><dd>{REGIONS[c.region[idx]]}</dd></div>
        <div><dt>status</dt><dd>{c.status[idx]}</dd></div>
        <div><dt>latency</dt><dd>{c.latency[idx]} ms</dd></div>
        <div><dt>trace_id</dt><dd><code>{traceHex}</code></dd></div>
      </dl>
      <h4>Trace (simulated spans)</h4>
      <svg className="trace" viewBox={`0 0 400 ${spans.length * 18 + 4}`} role="img" aria-label={`Trace waterfall with ${spans.length} spans`}>
        {spans.map((s, i) => (
          <g key={i} transform={`translate(0,${i * 18 + 2})`}>
            <rect x={90 + (s.start / total) * 240} width={Math.max(2, (s.duration / total) * 240)} y="2" height="12" rx="2" fill={SERVICE_COLORS[s.service]} opacity={s.service === data.scenario?.culprit && total > 400 ? 1 : 0.75} />
            <text x={4 + s.depth * 6} y="12" className="trace-t">
              {s.service}
            </text>
            <text x={94 + (s.start / total) * 240 + Math.max(2, (s.duration / total) * 240)} y="12" className="trace-t dim" dx="4">
              {fmtNum(s.duration, 'ms')}
            </text>
          </g>
        ))}
      </svg>
    </aside>
  );
}

function Chips() {
  const chips = useStore((s) => s.chips);
  if (!chips.length) return <div className="chips hint-row">Click any service, region, host or status in a row to add a filter chip. Right-click to exclude.</div>;
  return (
    <div className="chips" role="list" aria-label="Active filters">
      {chips.map((c, i) => (
        <span className={`chip ${c.neg ? 'neg' : ''}`} role="listitem" key={c.field + c.value + c.neg}>
          <button className="chip-l" title="Toggle include / exclude" onClick={() => setState((s) => ({ chips: s.chips.map((x, k) => (k === i ? { ...x, neg: !x.neg } : x)) }))}>
            {c.neg ? 'NOT ' : ''}
            {c.field}:<b>{c.value}</b>
          </button>
          <button className="chip-x" aria-label={`Remove filter ${c.field}:${c.value}`} onClick={() => removeChip(i)}>
            <Icon name="x" size={12} />
          </button>
        </span>
      ))}
      <button className="btn small ghost" onClick={() => setState({ chips: [] })}>
        Clear all
      </button>
    </div>
  );
}

function HistogramPanel() {
  const host = useRef<HTMLDivElement>(null);
  const ref = useRef<LogHistogram | null>(null);
  const lv = useStore((s) => s.logView);
  useEffect(() => {
    const h = new LogHistogram(host.current!, chartHost);
    ref.current = h;
    let sig = '';
    const offs = [
      subscribe(() => {
        const s = getState();
        const n = `${s.live}|${s.spanSec}|${s.from}|${s.to}`;
        if (n !== sig) {
          sig = n;
          h.invalidate();
        }
      }),
      dataBus.on(() => getState().live && h.invalidate()),
      hoverBus.on(() => h.invalidateOverlay()),
    ];
    return () => {
      offs.forEach((o) => o());
      h.destroy();
    };
  }, []);
  useEffect(() => {
    ref.current?.setData(lv ? { from: lv.from, to: lv.to, hist: lv.res.hist, errHist: lv.res.errHist } : null);
  }, [lv]);
  return (
    <section className="chart-card" aria-label="Matching logs over time">
      <header className="chart-head">
        <h3>Matching logs over time</h3>
        <div className="legend-inline">
          <span><i style={{ background: 'var(--accent)' }} /> matches</span>
          <span><i style={{ background: 'var(--danger)' }} /> errors</span>
          <span className="dim">drag to zoom, shift-drag to pan</span>
        </div>
      </header>
      <div className="chart-canvas hist" ref={host} data-chart="histogram" />
    </section>
  );
}

export function LogsPage() {
  const lv = useStore((s) => s.logView);
  const loaded = useStore((s) => s.loaded);
  const selectedOpen = useStore((s) => s.selectedLog != null);
  const stat = useMemo(() => {
    if (!lv) return loaded ? 'running query…' : 'loading data…';
    const r = lv.res;
    return r.error ? 'query error' : `${r.matched.toLocaleString()} matches of ${r.scanned.toLocaleString()} rows scanned in ${r.ms.toFixed(1)} ms`;
  }, [lv, loaded]);
  return (
    <div className="page logs">
      <QueryBar />
      <Chips />
      <div className="statline" role="status" aria-live="polite">
        <span data-testid="qstat">{stat}</span>
        <span className="dim">{data.logCount.toLocaleString()} rows in the store · query runs in the worker, timing measured with performance.now()</span>
      </div>
      <div className="logs-grid">
        <div className="logs-left">
          <ChartPanel kind={{ type: 'metric', metric: 'p95' }} title="Latency p95 (linked)" />
          <HistogramPanel />
        </div>
        <div className={`logs-right ${selectedOpen ? 'has-detail' : ''}`}>
          <LogList />
          <Detail />
        </div>
      </div>
    </div>
  );
}

export { setQuery };
