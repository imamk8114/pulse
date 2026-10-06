import { describe, expect, it } from 'vitest';
import { effects, ServiceGen } from './gen';
import { makeScenario } from './scenario';
import { NOW0, STEP_MS } from './types';

describe('simulation determinism', () => {
  it('same seed gives the same scenario and samples; different seeds differ', () => {
    expect(makeScenario(3)).toEqual(makeScenario(3));
    expect(makeScenario(1).culprit).not.toBe(makeScenario(2).culprit);
    const a = new ServiceGen(2, makeScenario(1), 1);
    const b = new ServiceGen(2, makeScenario(1), 1);
    const oa = new Float32Array(8);
    const ob = new Float32Array(8);
    for (let i = 0; i < 500; i++) {
      a.sample(NOW0 + i * STEP_MS, {}, oa);
      b.sample(NOW0 + i * STEP_MS, {}, ob);
      expect(Array.from(oa)).toEqual(Array.from(ob));
    }
  });
  it('the culprit deploy produces a latency spike that a rollback recovers from', () => {
    const sc = makeScenario(1);
    const before = effects(sc.culprit, sc.culpritDeployTs - 60_000, sc, {});
    const during = effects(sc.culprit, sc.culpritDeployTs + 10 * 60_000, sc, {});
    const rolled = effects(sc.culprit, sc.culpritDeployTs + 10 * 60_000, sc, { [sc.culprit]: sc.culpritDeployTs + 5 * 60_000 });
    expect(before.tail).toBe(1);
    expect(during.tail).toBeGreaterThan(3);
    expect(rolled.tail).toBeLessThan(1.01);
  });
});
