/**
 * One shared requestAnimationFrame loop. Nothing is scheduled unless something is dirty,
 * so an idle dashboard costs zero frames.
 */
export interface Drawable {
  draw(): void;
}
const dirty = new Set<Drawable>();
let raf = 0;

const RING = 1200;
export const frameStats = {
  /** Wall time of each flush (all dirty charts drawn), in ms. */
  flushMs: new Float32Array(RING),
  flushes: 0,
  pointsLastFrame: 0,
  chartsLastFrame: 0,
  enabled: true,
};

function flush() {
  raf = 0;
  const t0 = performance.now();
  const list = [...dirty];
  dirty.clear();
  frameStats.pointsLastFrame = 0;
  for (const d of list) d.draw();
  frameStats.chartsLastFrame = list.length;
  if (frameStats.enabled) frameStats.flushMs[frameStats.flushes++ % RING] = performance.now() - t0;
}

export function markDirty(d: Drawable) {
  dirty.add(d);
  if (!raf) raf = requestAnimationFrame(flush);
}
export function forget(d: Drawable) {
  dirty.delete(d);
}
(globalThis as unknown as Record<string, unknown>).__pulseFrames = frameStats;
