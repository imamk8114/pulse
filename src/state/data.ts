/**
 * Mutable, typed-array backed data plane on the UI thread. It is deliberately outside React:
 * charts read straight from these arrays inside requestAnimationFrame.
 */
import { createLogColumns, LogColumns } from '../shared/gen';
import { Deploy, LOG_CAPACITY, Scenario, SERIES_CAPACITY, SERIES_COUNT, STEP_MS, T0 } from '../shared/types';

type Listener = () => void;
class Bus {
  private ls = new Set<Listener>();
  on(l: Listener) {
    this.ls.add(l);
    return () => this.ls.delete(l);
  }
  emit() {
    this.ls.forEach((l) => l());
  }
}

export const data = {
  series: Array.from({ length: SERIES_COUNT }, () => new Float32Array(SERIES_CAPACITY)),
  count: 0,
  t0: T0,
  step: STEP_MS,
  logs: createLogColumns(LOG_CAPACITY) as LogColumns,
  logCount: 0,
  scenario: null as Scenario | null,
  deploys: [] as Deploy[],
  latestT(): number {
    return T0 + Math.max(0, this.count - 1) * STEP_MS;
  },
  reset() {
    this.count = 0;
    this.logCount = 0;
    this.scenario = null;
    this.deploys = [];
  },
};
/** Fires when a live sample or history chunk lands. */
export const dataBus = new Bus();
/** Fires for crosshair / highlight changes. */
export const hoverBus = new Bus();
export const hover = { t: null as number | null, service: null as string | null, source: '' };

export function setHover(t: number | null, service: string | null, source: string) {
  if (hover.t === t && hover.service === service) return;
  hover.t = t;
  hover.service = service;
  hover.source = source;
  hoverBus.emit();
}
