import { collectConjuncts, parse } from '../engine/query/parser';
import { AppState } from './store';
import { data } from './data';

export interface MissionStep {
  id: string;
  title: string;
  hint: string;
  test: (s: AppState) => boolean;
}

const mins = (n: number) => n * 60_000;

export function conjunctsOf(s: AppState) {
  const parsed = parse(s.q);
  const fromQuery = parsed.errors.length ? [] : collectConjuncts(parsed.ast);
  return [...fromQuery, ...s.chips.map((c) => ({ field: c.field, value: c.value, neg: c.neg }))];
}

export const MISSION_STEPS: MissionStep[] = [
  {
    id: 'zoom',
    title: 'Brush-zoom into the latency spike',
    hint: 'p95 latency jumps on one service. Drag across the jump on any chart to zoom every linked chart.',
    test: (s) => {
      const sc = data.scenario;
      if (!sc || s.live) return false;
      return s.to - s.from <= mins(35) && s.from >= sc.culpritDeployTs - mins(12) && s.to > sc.culpritDeployTs;
    },
  },
  {
    id: 'filter',
    title: 'Filter the logs to errors from the culprit',
    hint: 'Open Logs and type level:error service:<the slow service>. Autocomplete will help.',
    test: (s) => {
      const sc = data.scenario;
      if (!sc) return false;
      const c = conjunctsOf(s).filter((x) => !x.neg);
      return c.some((x) => x.field === 'level' && x.value === 'error') && c.some((x) => x.field === 'service' && x.value === sc.culprit);
    },
  },
  {
    id: 'chip',
    title: 'Click a value in a log row to add a filter chip',
    hint: 'Click any highlighted value (service, region, host, status) in a log row.',
    test: (s) => s.mission.flags.chipFromRow && s.chips.length > 0,
  },
  {
    id: 'marker',
    title: 'Inspect the deploy marker',
    hint: 'The dashed line with a triangle is a deploy. Click its flag to see what shipped and who shipped it.',
    test: (s) => s.mission.flags.markerInspected,
  },
  {
    id: 'rule',
    title: 'Create an alert rule from the chart',
    hint: 'Use the bell button on the p95 chart. Adjust the threshold and watch the preview shade where it would have fired.',
    test: (s) => s.rules.some((r) => r.origin === 'chart'),
  },
  {
    id: 'fire',
    title: 'Watch your rule fire',
    hint: 'Rules evaluate continuously in the worker. Your rule fires once the condition holds for its window.',
    test: (s) => s.alerts.some((a) => s.rules.find((r) => r.id === a.ruleId)?.origin === 'chart'),
  },
  {
    id: 'incident',
    title: 'Declare an incident from an alert',
    hint: 'In Alerts, press Declare incident on a firing alert.',
    test: (s) => s.incidents.length > 0,
  },
  {
    id: 'resolve',
    title: 'Roll back, resolve, and copy the post-mortem',
    hint: 'Walk the status steps to Resolved, then press Copy summary.',
    test: (s) => s.incidents.some((i) => i.status === 'resolved') && s.mission.flags.summaryCopied,
  },
];
