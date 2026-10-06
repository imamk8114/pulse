import { useEffect, useState, useSyncExternalStore } from 'react';
import { hover, hoverBus } from '../state/data';
import { getView } from '../state/actions';
import { useStore } from '../state/store';

export function useView() {
  useStore((s) => s.live);
  useStore((s) => s.spanSec);
  useStore((s) => s.from);
  useStore((s) => s.to);
  useStore((s) => s.liveTick);
  return getView();
}

export function useHoverService(): string | null {
  return useSyncExternalStore(
    (cb) => hoverBus.on(cb),
    () => hover.service,
  );
}

export function useMedia(q: string): boolean {
  const [m, setM] = useState(() => (typeof matchMedia !== 'undefined' ? matchMedia(q).matches : false));
  useEffect(() => {
    const mq = matchMedia(q);
    const f = () => setM(mq.matches);
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, [q]);
  return m;
}
