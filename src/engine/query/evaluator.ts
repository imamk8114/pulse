/**
 * Compiles an AST into a row predicate over a columnar table. Semantic problems
 * (unknown field, bad value) are reported with source positions just like syntax errors.
 */
import { CmpOp, Node, ParseError } from './parser';

export type FieldKind = 'enum' | 'number' | 'text';
export interface FieldSpec {
  kind: FieldKind;
  /** Enum dictionary, index == column code. */
  values?: readonly string[];
  doc: string;
}
export type Schema = Record<string, FieldSpec>;

export interface Table {
  length: number;
  schema: Schema;
  enumColumn(field: string): ArrayLike<number>;
  numColumn(field: string): ArrayLike<number>;
  /** Predicate for a case-insensitive free-text term. */
  textMatcher(termLower: string): (row: number) => boolean;
}

export type Predicate = (row: number) => boolean;
export interface CompileResult {
  predicate: Predicate | null;
  errors: ParseError[];
}

const ALWAYS: Predicate = () => true;

function wildcardRegex(v: string): RegExp {
  const esc = v.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp(`^${esc}$`, 'i');
}

export function closest(word: string, options: readonly string[]): string | null {
  let best: string | null = null;
  let bd = 3;
  for (const o of options) {
    const d = editDistance(word.toLowerCase(), o.toLowerCase());
    if (d < bd || (o.startsWith(word.toLowerCase()) && word.length > 0)) {
      bd = Math.min(d, bd);
      best = o;
      if (o.startsWith(word.toLowerCase())) break;
    }
  }
  return best;
}
function editDistance(a: string, b: string): number {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++)
    for (let j = 1; j <= b.length; j++)
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return dp[a.length][b.length];
}

export function compile(ast: Node | null, table: Table): CompileResult {
  if (!ast) return { predicate: ALWAYS, errors: [] };
  const errors: ParseError[] = [];
  const fieldNames = Object.keys(table.schema);

  const build = (n: Node): Predicate => {
    switch (n.kind) {
      case 'and': {
        const a = build(n.left);
        const b = build(n.right);
        return (r) => a(r) && b(r);
      }
      case 'or': {
        const a = build(n.left);
        const b = build(n.right);
        return (r) => a(r) || b(r);
      }
      case 'not': {
        const a = build(n.child);
        return (r) => !a(r);
      }
      case 'text': {
        return table.textMatcher(n.value.toLowerCase());
      }
      case 'field': {
        const spec = table.schema[n.field];
        if (!spec) {
          const hint = closest(n.field, fieldNames);
          errors.push({ message: `Unknown field '${n.field}'${hint ? `. Did you mean '${hint}'?` : ''}`, start: n.start, end: n.fieldEnd });
          return ALWAYS;
        }
        if (spec.kind === 'enum') {
          const col = table.enumColumn(n.field);
          const vals = spec.values ?? [];
          const re = n.value.includes('*') ? wildcardRegex(n.value) : null;
          const codes = new Set<number>();
          vals.forEach((v, i) => (re ? re.test(v) : v.toLowerCase() === n.value.toLowerCase()) && codes.add(i));
          if (codes.size === 0) {
            const hint = closest(n.value, vals);
            errors.push({ message: `No ${n.field} matches '${n.value}'${hint ? `. Did you mean '${hint}'?` : ''}`, start: n.fieldEnd + 1, end: n.end });
            return ALWAYS;
          }
          if (codes.size === 1) {
            const code = [...codes][0];
            return (r) => col[r] === code;
          }
          return (r) => codes.has(col[r]);
        }
        if (spec.kind === 'number') {
          const num = Number(n.value);
          if (!isFinite(num)) {
            errors.push({ message: `'${n.field}' expects a number, got '${n.value}'`, start: n.fieldEnd + 1, end: n.end });
            return ALWAYS;
          }
          const col = table.numColumn(n.field);
          return (r) => col[r] === num;
        }
        // text field: substring match on the field name 'msg'
        return table.textMatcher(n.value.toLowerCase());
      }
      case 'cmp': {
        const spec = table.schema[n.field];
        if (!spec) {
          const hint = closest(n.field, fieldNames);
          errors.push({ message: `Unknown field '${n.field}'${hint ? `. Did you mean '${hint}'?` : ''}`, start: n.start, end: n.fieldEnd });
          return ALWAYS;
        }
        if (spec.kind !== 'number') {
          errors.push({ message: `'${n.field}' is not numeric, so '${n.op}' cannot be used. Try ${n.field}:value`, start: n.fieldEnd, end: n.end });
          return ALWAYS;
        }
        const col = table.numColumn(n.field);
        const v = n.value;
        return cmpPredicate(col, n.op, v);
      }
    }
  };
  const predicate = build(ast);
  return { predicate: errors.length ? null : predicate, errors };
}

function cmpPredicate(col: ArrayLike<number>, op: CmpOp, v: number): Predicate {
  switch (op) {
    case '>':
      return (r) => col[r] > v;
    case '>=':
      return (r) => col[r] >= v;
    case '<':
      return (r) => col[r] < v;
    case '<=':
      return (r) => col[r] <= v;
    case '=':
      return (r) => col[r] === v;
    case '!=':
      return (r) => col[r] !== v;
  }
}

/** Joins two ASTs with AND (used to combine filter chips with the typed query). */
export function andNodes(a: Node | null, b: Node | null): Node | null {
  if (!a) return b;
  if (!b) return a;
  return { kind: 'and', left: a, right: b, start: a.start, end: b.end };
}

/** Builds the AST node for a chip without going through text. */
export function chipNode(field: string, value: string, neg: boolean): Node {
  const n: Node = { kind: 'field', field, value, quoted: false, start: 0, end: 0, fieldEnd: 0 };
  return neg ? { kind: 'not', child: n, start: 0, end: 0 } : n;
}
