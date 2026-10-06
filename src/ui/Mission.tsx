import { useEffect, useRef, useState } from 'react';
import { closeMission, minimizeMission, openMission, setMission, showMe, startNewIncident } from '../state/actions';
import { MISSION_STEPS } from '../state/mission';
import { useStore } from '../state/store';
import { Icon } from './Icon';

function Confetti() {
  const bits = Array.from({ length: 36 }, (_, i) => i);
  return (
    <div className="confetti" aria-hidden>
      {bits.map((i) => (
        <i key={i} style={{ left: `${(i * 97) % 100}%`, animationDelay: `${(i % 9) * 60}ms`, background: ['#38bdf8', '#34d399', '#fbbf24', '#f87171', '#b58af0'][i % 5], ['--dx' as string]: `${((i * 53) % 80) - 40}px` }} />
      ))}
    </div>
  );
}

export function MissionPanel() {
  const m = useStore((s) => s.mission);
  const loaded = useStore((s) => s.loaded);
  const doneCount = MISSION_STEPS.filter((x) => m.done[x.id]).length;
  const all = doneCount === MISSION_STEPS.length;
  const firstUndone = MISSION_STEPS.find((x) => !m.done[x.id])?.id ?? null;
  const [expanded, setExpanded] = useState<string | null>(firstUndone);
  const [celebrate, setCelebrate] = useState(false);
  const prev = useRef(doneCount);
  useEffect(() => setExpanded(firstUndone), [firstUndone]);
  useEffect(() => {
    if (all && prev.current < MISSION_STEPS.length) {
      setCelebrate(true);
      const t = setTimeout(() => setCelebrate(false), 3800);
      prev.current = doneCount;
      return () => clearTimeout(t);
    }
    prev.current = doneCount;
  }, [all, doneCount]);

  const shown = loaded && m.open && !m.minimized;
  useEffect(() => {
    document.body.classList.toggle('mission-open', shown);
    return () => document.body.classList.remove('mission-open');
  }, [shown]);
  if (!shown) return null;
  const pct = Math.round((doneCount / MISSION_STEPS.length) * 100);
  return (
    <aside className="mission" aria-label="Guided mission: Investigate the outage" data-testid="mission">
      {celebrate && <Confetti />}
      <header>
        <div>
          <span className="eyebrow">Guided mission</span>
          <h2>Investigate the outage</h2>
        </div>
        <div className="mission-btns">
          <button className="icon-btn" aria-label="Minimize mission" onClick={minimizeMission}>
            <Icon name="chevron" size={14} />
          </button>
          <button className="icon-btn" aria-label="Dismiss mission (resume any time from the Mission button)" onClick={closeMission}>
            <Icon name="x" size={14} />
          </button>
        </div>
      </header>
      <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={MISSION_STEPS.length} aria-valuenow={doneCount} aria-label="Mission progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <p className="progress-text">
        {all ? 'Mission complete. Incident resolved and post-mortem copied.' : `${doneCount} of ${MISSION_STEPS.length} steps done. Steps check themselves off when you actually do them.`}
      </p>
      <ol className="msteps">
        {MISSION_STEPS.map((st, i) => {
          const done = !!m.done[st.id];
          const open = expanded === st.id && !done;
          return (
            <li key={st.id} className={`${done ? 'done' : ''} ${st.id === firstUndone ? 'current' : ''}`} data-step={st.id} data-done={done}>
              <button className="mhead" aria-expanded={open} disabled={done} onClick={() => setExpanded(open ? null : st.id)}>
                <span className="mnum">{done ? <Icon name="check" size={12} /> : i + 1}</span>
                <span className="mtitle">{st.title}</span>
              </button>
              {open && (
                <div className="mbody">
                  <p>{st.hint}</p>
                  <button className="btn small primary" onClick={() => showMe(st.id)}>
                    Show me
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      {all && (
        <div className="done-card">
          <Icon name="star" size={16} /> Nicely done. You went from a latency spike to a resolved incident with a written summary.
        </div>
      )}
      <footer>
        <button className="btn small" onClick={startNewIncident} title="Re-runs the simulator with a different seed: new culprit service, new timing, new noise.">
          <Icon name="zap" /> Start a new simulated incident
        </button>
      </footer>
    </aside>
  );
}

export function MissionPill() {
  const m = useStore((s) => s.mission);
  const loaded = useStore((s) => s.loaded);
  const done = MISSION_STEPS.filter((x) => m.done[x.id]).length;
  if (!loaded || (m.open && !m.minimized)) return null;
  return (
    <button className="mission-fab" onClick={() => (openMission(), setMission({ minimized: false }))} aria-label={`Resume mission, ${done} of ${MISSION_STEPS.length} done`}>
      <Icon name="flag" /> Mission {done}/{MISSION_STEPS.length}
    </button>
  );
}
