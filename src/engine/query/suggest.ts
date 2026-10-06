/** Autocomplete: pure function of (text, caret, schema). */
import { Schema } from './evaluator';
import { tokenize } from './tokenizer';

export interface Suggestion {
  label: string;
  insert: string;
  detail: string;
  kind: 'field' | 'value' | 'keyword';
}
export interface SuggestResult {
  /** Replace text[from, to) with the chosen insert text. */
  from: number;
  to: number;
  items: Suggestion[];
}

const KEYWORDS: Suggestion[] = [
  { label: 'AND', insert: 'AND ', detail: 'both conditions', kind: 'keyword' },
  { label: 'OR', insert: 'OR ', detail: 'either condition', kind: 'keyword' },
  { label: 'NOT', insert: 'NOT ', detail: 'negate next condition', kind: 'keyword' },
];

export function suggest(text: string, caret: number, schema: Schema, limit = 8): SuggestResult {
  const tokens = tokenize(text.slice(0, caret));
  // Find the word being typed at the caret.
  let from = caret;
  while (from > 0 && !/[\s():"<>=!]/.test(text[from - 1])) from--;
  const prefix = text.slice(from, caret);
  const before = tokens.filter((t) => t.end <= from);
  const last = before[before.length - 1];
  const prev = before[before.length - 2];

  // Value context: "field:" + partial value
  if (last?.type === 'colon' && prev?.type === 'word') {
    const spec = schema[prev.value.toLowerCase()];
    if (spec?.kind === 'enum' && spec.values) {
      const items = spec.values
        .filter((v) => v.toLowerCase().startsWith(prefix.toLowerCase().replace(/^"/, '')))
        .slice(0, limit)
        .map((v) => ({ label: v, insert: v + ' ', detail: prev.value, kind: 'value' as const }));
      return { from, to: caret, items };
    }
    if (spec?.kind === 'number') {
      return { from, to: caret, items: ['200', '404', '500', '503'].filter((v) => v.startsWith(prefix) && prev.value === 'status').map((v) => ({ label: v, insert: v + ' ', detail: 'status code', kind: 'value' as const })) };
    }
    return { from, to: caret, items: [] };
  }
  if (last?.type === 'op') return { from, to: caret, items: [] };

  if (prefix.startsWith('"')) return { from, to: caret, items: [] };
  const lower = prefix.toLowerCase();
  const items: Suggestion[] = [];
  for (const [name, spec] of Object.entries(schema)) {
    if (name.startsWith(lower) && !(prefix === '' && false)) {
      items.push({ label: name, insert: spec.kind === 'number' ? name : name + ':', detail: spec.doc, kind: 'field' });
    }
  }
  if (prefix) for (const k of KEYWORDS) if (k.label.toLowerCase().startsWith(lower) && prefix === prefix.toUpperCase()) items.push(k);
  if (!prefix && last && last.type !== 'and' && last.type !== 'or' && last.type !== 'not' && last.type !== 'lparen') items.push(...KEYWORDS);
  return { from, to: caret, items: items.slice(0, limit) };
}
