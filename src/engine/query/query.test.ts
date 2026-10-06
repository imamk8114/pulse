import { describe, expect, it } from 'vitest';
import { compile, Schema, Table } from './evaluator';
import { collectConjuncts, parse } from './parser';
import { suggest } from './suggest';
import { tokenize } from './tokenizer';

describe('tokenizer', () => {
  it('splits fields, operators, strings and keywords with positions', () => {
    const t = tokenize('service:checkout latency>=500 "a b" AND NOT x');
    expect(t.map((x) => x.type)).toEqual(['word', 'colon', 'word', 'word', 'op', 'word', 'string', 'and', 'not', 'word']);
    expect(t[4]).toMatchObject({ text: '>=', start: 24, end: 26 });
    expect(t[6]).toMatchObject({ value: 'a b', start: 30, end: 35 });
  });
  it('treats lowercase and/or/not as free-text words', () => {
    expect(tokenize('and or not').map((x) => x.type)).toEqual(['word', 'word', 'word']);
  });
  it('reports unterminated strings as error tokens with a position', () => {
    const t = tokenize('foo "bar');
    expect(t[1]).toMatchObject({ type: 'error', start: 4 });
    expect(t[1].message).toMatch(/Unterminated/);
  });
  it('handles escapes and the minus negation shorthand', () => {
    expect(tokenize('"a\\"b"')[0].value).toBe('a"b');
    expect(tokenize('-region:eu').map((x) => x.type)).toEqual(['minus', 'word', 'colon', 'word']);
    expect(tokenize('latency>-5').map((x) => x.value)).toEqual(['latency', '>', '-5']);
  });
});

describe('parser', () => {
  const sh = (src: string) => {
    const r = parse(src);
    const f = (n: any): string =>
      n.kind === 'and' ? `(${f(n.left)} & ${f(n.right)})` : n.kind === 'or' ? `(${f(n.left)} | ${f(n.right)})` : n.kind === 'not' ? `!${f(n.child)}` : n.kind === 'field' ? `${n.field}=${n.value}` : n.kind === 'cmp' ? `${n.field}${n.op}${n.value}` : `"${n.value}"`;
    return r.ast ? f(r.ast) : r.errors;
  };
  it('implicit AND, explicit AND/OR and precedence NOT > AND > OR', () => {
    expect(sh('a:x b:y')).toBe('(a=x & b=y)');
    expect(sh('a:x OR b:y AND c:z')).toBe('(a=x | (b=y & c=z))');
    expect(sh('NOT a:x b:y')).toBe('(!a=x & b=y)');
    expect(sh('(a:x OR b:y) c:z')).toBe('((a=x | b=y) & c=z)');
    expect(sh('-region:eu')).toBe('!region=eu');
  });
  it('parses numeric comparisons and the README example', () => {
    expect(sh('latency>500')).toBe('latency>500');
    const r = parse('service:checkout level:error latency>500 "timeout" AND NOT region:eu');
    expect(r.errors).toEqual([]);
    expect(collectConjuncts(r.ast).map((c) => `${c.neg ? '!' : ''}${c.field}:${c.value}`)).toEqual(['service:checkout', 'level:error', '!region:eu']);
  });
  it('returns inline errors with start/end positions', () => {
    expect(parse('a:x AND').errors[0]).toMatchObject({ message: expect.stringMatching(/after AND/) });
    expect(parse('(a:x').errors[0]).toMatchObject({ message: expect.stringMatching(/closing '\)'/) });
    expect(parse('a:x)').errors[0]).toMatchObject({ start: 3, end: 4 });
    expect(parse('latency>abc').errors[0]).toMatchObject({ start: 8, message: expect.stringMatching(/number/) });
    expect(parse('service:').errors[0].message).toMatch(/Expected a value/);
    expect(parse('').errors).toEqual([]);
    expect(parse('').ast).toBeNull();
  });
  it('never throws on arbitrary garbage', () => {
    for (const s of [')(', '::', '>>', 'AND AND', '"""', 'NOT', '-', '(((', 'a:b:c', '!!x']) expect(() => parse(s)).not.toThrow();
  });
});

const schema: Schema = {
  service: { kind: 'enum', values: ['checkout', 'payments', 'auth'], doc: '' },
  level: { kind: 'enum', values: ['info', 'error'], doc: '' },
  region: { kind: 'enum', values: ['us', 'eu'], doc: '' },
  latency: { kind: 'number', doc: '' },
  msg: { kind: 'text', doc: '' },
};
const rows = [
  { service: 0, level: 1, region: 0, latency: 900, msg: 'upstream timeout' },
  { service: 0, level: 1, region: 1, latency: 800, msg: 'upstream timeout' },
  { service: 0, level: 0, region: 0, latency: 100, msg: 'ok' },
  { service: 1, level: 1, region: 0, latency: 700, msg: 'card declined' },
  { service: 2, level: 0, region: 1, latency: 30, msg: 'ok' },
];
const table: Table = {
  length: rows.length,
  schema,
  enumColumn: (f) => rows.map((r) => (r as any)[f]),
  numColumn: (f) => rows.map((r) => (r as any)[f]),
  textMatcher: (t) => (i) => rows[i].msg.includes(t),
};
const run = (q: string) => {
  const r = compile(parse(q).ast, table);
  if (!r.predicate) return r.errors;
  return rows.map((_, i) => i).filter(r.predicate);
};

describe('evaluator', () => {
  it('evaluates the full example language', () => {
    expect(run('service:checkout level:error latency>500 "timeout" AND NOT region:eu')).toEqual([0]);
    expect(run('service:checkout level:error')).toEqual([0, 1]);
    expect(run('region:eu OR service:payments')).toEqual([1, 3, 4]);
    expect(run('-level:error')).toEqual([2, 4]);
    expect(run('latency<=100')).toEqual([2, 4]);
    expect(run('latency!=900 latency>=700')).toEqual([1, 3]);
    expect(run('')).toEqual([0, 1, 2, 3, 4]);
  });
  it('supports wildcards and case-insensitive values', () => {
    expect(run('service:CHECK*')).toEqual([0, 1, 2]);
    expect(run('service:*s')).toEqual([3]);
  });
  it('reports semantic errors with positions and suggestions', () => {
    const e1 = run('servce:checkout') as any[];
    expect(e1[0]).toMatchObject({ start: 0, end: 6 });
    expect(e1[0].message).toMatch(/Did you mean 'service'/);
    const e2 = run('level:eror') as any[];
    expect(e2[0].message).toMatch(/Did you mean 'error'/);
    expect(e2[0].start).toBe(6);
    const e3 = run('service>3') as any[];
    expect(e3[0].message).toMatch(/not numeric/);
  });
});

describe('autocomplete', () => {
  it('suggests fields, then values after the colon', () => {
    const f = suggest('serv', 4, schema);
    expect(f.items[0]).toMatchObject({ label: 'service', insert: 'service:' });
    const v = suggest('service:ch', 10, schema);
    expect(v.items.map((i) => i.label)).toEqual(['checkout']);
    expect(v.from).toBe(8);
  });
});
