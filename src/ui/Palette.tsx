import { useEffect, useMemo, useRef, useState } from 'react';
import { SERVICES, METRIC_META } from '../shared/types';
import {
  copyLink,
  openEditor,
  openMission,
  openRuleFromChart,
  resetView,
  setLive,
  setPreset,
  setQuery,
  setTab,
  startNewIncident,
  toggleServiceFilter,
  toggleTheme,
  declareIncident,
} from '../state/actions';
import { getState, setState, useStore } from '../state/store';

interface Cmd {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const fuzzy = (q: string, s: string) => {
  q = q.toLowerCase();
  s = s.toLowerCase();
  let i = 0;
  for (const ch of s) if (ch === q[i]) i++;
  return i === q.length;
};

export function Palette() {
  const open = useStore((s) => s.palette);
  const saved = useStore((s) => s.saved);
  const [q, setQ] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const close = () => setState({ palette: false });

  const cmds = useMemo<Cmd[]>(() => {
    const list: Cmd[] = [
      { id: 'go-ov', label: 'Go to Overview', run: () => setTab('overview') },
      { id: 'go-logs', label: 'Go to Logs', run: () => setTab('logs') },
      { id: 'go-al', label: 'Go to Alerts', run: () => setTab('alerts') },
      { id: 'go-inc', label: 'Go to Incidents', run: () => setTab('incidents') },
      { id: 'live', label: 'Toggle live / paused', run: () => setLive(!getState().live) },
      { id: 'reset', label: 'Reset time range to live', run: resetView },
      { id: 'p15', label: 'Time range: last 15 minutes', run: () => setPreset(15) },
      { id: 'p60', label: 'Time range: last hour', run: () => setPreset(60) },
      { id: 'p360', label: 'Time range: last 6 hours', run: () => setPreset(360) },
      { id: 'p1440', label: 'Time range: last 24 hours', run: () => setPreset(1440) },
      { id: 'theme', label: 'Toggle dark / light theme', run: toggleTheme },
      { id: 'scale', label: 'Toggle log / linear scale', run: () => setState({ logScale: !getState().logScale }) },
      { id: 'link', label: 'Copy link to this view', run: copyLink },
      { id: 'newrule', label: 'Create alert rule…', run: () => openEditor() },
      { id: 'rule-p95', label: 'Create alert rule from p95 latency chart', run: () => openRuleFromChart('p95') },
      { id: 'mission', label: 'Open the "Investigate the outage" mission', run: openMission },
      { id: 'newinc', label: 'Start a new simulated incident (different seed)', run: startNewIncident },
      { id: 'clearchips', label: 'Clear all filters', run: () => setState({ chips: [], q: '' }) },
      {
        id: 'declare',
        label: 'Declare incident from the latest firing alert',
        run: () => {
          const a = getState().alerts.filter((x) => x.resolvedAt == null).sort((x, y) => y.firedAt - x.firedAt)[0];
          if (a) declareIncident(a.id);
          else setTab('alerts');
        },
      },
    ];
    for (const s of SERVICES) list.push({ id: `svc-${s}`, label: `Filter to service: ${s}`, hint: 'toggle', run: () => toggleServiceFilter(s) });
    for (const sq of saved) list.push({ id: `sq-${sq.name}`, label: `Run saved query: ${sq.name}`, hint: sq.q, run: () => (setTab('logs'), setQuery(sq.q)) });
    for (const m of ['p95', 'err', 'cpu', 'mem'] as const) list.push({ id: `alert-${m}`, label: `Alert on ${METRIC_META[m].label}`, run: () => openRuleFromChart(m) });
    return list;
  }, [saved]);

  const shown = useMemo(() => cmds.filter((c) => !q || fuzzy(q, c.label)).slice(0, 9), [cmds, q]);
  useEffect(() => setActive(0), [q, open]);
  useEffect(() => {
    if (open) {
      setQ('');
      requestAnimationFrame(() => input.current?.focus());
    }
  }, [open]);

  if (!open) return null;
  const run = (c?: Cmd) => {
    if (!c) return;
    close();
    c.run();
  };
  return (
    <div className="modal-back top" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={input}
          value={q}
          placeholder="Type a command, service or saved query…"
          role="combobox"
          aria-expanded="true"
          aria-controls="pal-list"
          aria-activedescendant={shown[active] ? `pal-${shown[active].id}` : undefined}
          aria-label="Command"
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') (e.preventDefault(), setActive((a) => Math.min(shown.length - 1, a + 1)));
            else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((a) => Math.max(0, a - 1)));
            else if (e.key === 'Enter') (e.preventDefault(), run(shown[active]));
            else if (e.key === 'Escape') close();
          }}
        />
        <ul id="pal-list" role="listbox" aria-label="Commands">
          {shown.map((c, i) => (
            <li key={c.id} id={`pal-${c.id}`} role="option" aria-selected={i === active} className={i === active ? 'on' : ''} onMouseEnter={() => setActive(i)} onMouseDown={(e) => (e.preventDefault(), run(c))}>
              <span>{c.label}</span>
              {c.hint && <code>{c.hint}</code>}
            </li>
          ))}
          {shown.length === 0 && <li className="none">No matching command</li>}
        </ul>
      </div>
    </div>
  );
}
