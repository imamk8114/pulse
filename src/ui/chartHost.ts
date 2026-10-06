import { ChartHost } from '../render/timeseries';
import { hover, data, setHover } from '../state/data';
import { getState } from '../state/store';
import { getView, inspectDeploy, panBy, resetView, setLive, setRange, zoomAround } from '../state/actions';

export const chartHost: ChartHost = {
  view: getView,
  timeline: () => ({ t0: data.t0, step: data.step, count: data.count }),
  deploys: () => data.deploys,
  hover: () => hover,
  setHover: (t, s) => setHover(t, s, 'chart'),
  brush: (a, b) => setRange(a, b),
  pan: panBy,
  zoom: zoomAround,
  reset: resetView,
  live: () => setLive(true),
  markerClick: (d) => inspectDeploy(d),
  pulseMarkers: () => getState().mission.highlight === 'marker',
};

/** A host with a frozen view and no gestures, used by the alert-rule preview. */
export function frozenHost(view: { from: number; to: number }): ChartHost {
  const noop = () => undefined;
  return {
    view: () => view,
    timeline: () => ({ t0: data.t0, step: data.step, count: data.count }),
    deploys: () => data.deploys,
    hover: () => hover,
    setHover: (t, s) => setHover(t, s, 'preview'),
    brush: noop,
    pan: noop,
    zoom: noop,
    reset: noop,
    live: noop,
    markerClick: noop,
    pulseMarkers: () => false,
  };
}
