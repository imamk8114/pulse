import { describe, expect, it } from 'vitest';
import { decodeState, DEFAULTS, encodeState, ViewState } from './urlState';

const sample: ViewState = {
  tab: 'logs',
  seed: 4,
  live: false,
  spanSec: DEFAULTS.spanSec,
  from: 1781445600000,
  to: 1781447400000,
  q: 'level:error latency>500 "time out" AND NOT region:eu',
  chips: [
    { field: 'service', value: 'checkout', neg: false },
    { field: 'host', value: 'checkout-2', neg: true },
  ],
  logScale: true,
};

describe('url state', () => {
  it('round-trips a fully specified view', () => {
    expect(decodeState('#' + encodeState(sample))).toEqual(sample);
  });
  it('round-trips live mode and defaults', () => {
    const live: ViewState = { ...DEFAULTS, chips: [], live: true, spanSec: 900, from: 0, to: 0, tab: 'alerts' };
    expect(decodeState('#' + encodeState(live))).toEqual(live);
    expect(decodeState('')).toEqual({ ...DEFAULTS, chips: [] });
  });
  it('survives tricky characters in queries and chip values', () => {
    const s: ViewState = { ...sample, q: 'msg:"a&b=c#d,e" OR (x:y)', chips: [{ field: 'service', value: 'a,b:c%d', neg: false }] };
    expect(decodeState('#' + encodeState(s))).toEqual(s);
  });
  it('sanitises hostile or malformed input', () => {
    const d = decodeState('#tab=evil&seed=-3&from=10&to=5&span=abc&chips=nocolon,%E0%A4%A&scale=sideways');
    expect(d.tab).toBe('overview');
    expect(d.seed).toBe(1);
    expect(d.live).toBe(true);
    expect(d.spanSec).toBe(DEFAULTS.spanSec);
    expect(d.chips).toEqual([]);
    expect(d.logScale).toBe(false);
  });
});
