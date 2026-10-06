import { useEffect } from 'react';
import { setState, useStore } from '../state/store';
import { AlertsPage, RuleEditor } from './Alerts';
import { IncidentsPage } from './Incidents';
import { LogsPage } from './Logs';
import { MissionPanel, MissionPill } from './Mission';
import { Overview } from './Overview';
import { Palette } from './Palette';
import { DeployPopover, Loading, Toasts } from './Overlays';
import { TopBar } from './TopBar';

export function App() {
  const tab = useStore((s) => s.tab);
  const loaded = useStore((s) => s.loaded);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setState((s) => ({ palette: !s.palette }));
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  return (
    <div className="app">
      <a className="skip" href="#main">
        Skip to content
      </a>
      <TopBar />
      <main id="main" tabIndex={-1}>
        {tab === 'overview' && <Overview />}
        {tab === 'logs' && loaded && <LogsPage />}
        {tab === 'alerts' && <AlertsPage />}
        {tab === 'incidents' && <IncidentsPage />}
      </main>
      <footer className="foot">
        All data is simulated by a seeded generator in a Web Worker (seed shown in the URL). Nothing here is real telemetry.
      </footer>
      <DeployPopover />
      <RuleEditor />
      <Palette />
      <MissionPanel />
      <MissionPill />
      <Toasts />
      <Loading />
    </div>
  );
}
