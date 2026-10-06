/**
 * Recursive-descent parser.
 *
 *   query   := or
 *   or      := and ( OR and )*
 *   and     := unary ( [AND] unary )*          -- adjacency is an implicit AND
 *   unary   := (NOT | '-') unary | primary
 *   primary := '(' or ')' | FIELD ':' value | FIELD op number | STRING | WORD
 *   value   := WORD | STRING                    -- '*' wildcards allowed in words
 *   op      := '>' | '>=' | '<' | '<=' | '=' | '!='
 */
import { Token, tokenize } from './tokenizer';

export type CmpOp = '>' | '>=' | '<' | '<=' | '=' | '!=';
export type Node =
  | { kind: 'and'; left: Node; right: Node; start: number; end: number }
  | { kind: 'or'; left: Node; right: Node; start: number; end: number }
  | { kind: 'not'; child: Node; start: number; end: number }
  | { kind: 'field'; field: string; value: string; quoted: boolean; start: number; end: number; fieldEnd: number }
  | { kind: 'cmp'; field: string; op: CmpOp; value: number; start: number; end: number; fieldEnd: number }
  | { kind: 'text'; value: string; start: number; end: number };

export interface ParseError {
  message: string;
  start: number;
  end: number;
}
export interface ParseResult {
  ast: Node | null;
  errors: ParseError[];
  tokens: Token[];
}

export function parse(src: string): ParseResult {
  const tokens = tokenize(src);
  const errors: ParseError[] = [];
  for (const t of tokens) if (t.type === 'error') errors.push({ message: t.message ?? 'Syntax error', start: t.start, end: t.end });
  if (errors.length) return { ast: null, errors, tokens };
  if (tokens.length === 0) return { ast: null, errors: [], tokens };

  let p = 0;
  const peek = () => tokens[p];
  const fail = (message: string, t?: Token): never => {
    const tok = t ?? peek();
    const start = tok ? tok.start : src.length;
    const end = tok ? tok.end : src.length;
    throw { message, start, end } as ParseError;
  };

  const startsPrimary = (t: Token | undefined) =>
    !!t && (t.type === 'word' || t.type === 'string' || t.type === 'lparen' || t.type === 'not' || t.type === 'minus');

  function parseOr(): Node {
    let left = parseAnd();
    while (peek()?.type === 'or') {
      p++;
      if (!startsPrimary(peek())) fail('Expected a condition after OR');
      const right = parseAnd();
      left = { kind: 'or', left, right, start: left.start, end: right.end };
    }
    return left;
  }
  function parseAnd(): Node {
    let left = parseUnary();
    for (;;) {
      const t = peek();
      if (t?.type === 'and') {
        p++;
        if (!startsPrimary(peek())) fail('Expected a condition after AND');
      } else if (!startsPrimary(t)) break;
      const right = parseUnary();
      left = { kind: 'and', left, right, start: left.start, end: right.end };
    }
    return left;
  }
  function parseUnary(): Node {
    const t = peek();
    if (t && (t.type === 'not' || t.type === 'minus')) {
      p++;
      if (!startsPrimary(peek())) fail(`Expected a condition after ${t.type === 'not' ? 'NOT' : "'-'"}`);
      const child = parseUnary();
      return { kind: 'not', child, start: t.start, end: child.end };
    }
    return parsePrimary();
  }
  function parsePrimary(): Node {
    const t = peek();
    if (!t) return fail('Unexpected end of query');
    if (t.type === 'lparen') {
      p++;
      if (peek()?.type === 'rparen') fail('Empty parentheses', peek());
      const inner = parseOr();
      const close = peek();
      if (close?.type !== 'rparen') fail("Missing closing ')'", close ?? t);
      p++;
      return { ...inner, start: t.start, end: close.end } as Node;
    }
    if (t.type === 'string') {
      p++;
      return { kind: 'text', value: t.value, start: t.start, end: t.end };
    }
    if (t.type === 'word') {
      const next = tokens[p + 1];
      if (next?.type === 'colon') {
        p += 2;
        const v = peek();
        if (!v || (v.type !== 'word' && v.type !== 'string')) {
          fail(`Expected a value after '${t.value}:'`, v ?? next);
        }
        p++;
        return { kind: 'field', field: t.value.toLowerCase(), value: v.value, quoted: v.type === 'string', start: t.start, end: v.end, fieldEnd: t.end };
      }
      if (next?.type === 'op') {
        p += 2;
        const v = peek();
        if (!v || v.type !== 'word' || !isFinite(Number(v.value)) || v.value === '') {
          fail(`Expected a number after '${next.value}'`, v ?? next);
        }
        p++;
        return { kind: 'cmp', field: t.value.toLowerCase(), op: next.value as CmpOp, value: Number(v.value), start: t.start, end: v.end, fieldEnd: t.end };
      }
      p++;
      return { kind: 'text', value: t.value, start: t.start, end: t.end };
    }
    if (t.type === 'rparen') return fail("Unexpected ')'");
    if (t.type === 'colon') return fail("Unexpected ':', a field name must come first");
    if (t.type === 'op') return fail(`Unexpected '${t.value}', a field name must come first`);
    if (t.type === 'and' || t.type === 'or') return fail(`Unexpected ${t.value}, expected a condition`);
    return fail('Unexpected token');
  }

  try {
    const ast = parseOr();
    if (p < tokens.length) fail(tokens[p].type === 'rparen' ? "Unexpected ')'" : `Unexpected '${tokens[p].text}'`);
    return { ast, errors: [], tokens };
  } catch (e) {
    const err = e as ParseError;
    if (typeof err?.start !== 'number') throw e;
    return { ast: null, errors: [err], tokens };
  }
}

/** Positive top-level conjuncts of the form field:value, used by the guided tour and chips. */
export function collectConjuncts(ast: Node | null): Array<{ field: string; value: string; neg: boolean }> {
  const out: Array<{ field: string; value: string; neg: boolean }> = [];
  const walk = (n: Node, neg: boolean) => {
    if (n.kind === 'and') {
      walk(n.left, neg);
      walk(n.right, neg);
    } else if (n.kind === 'field') out.push({ field: n.field, value: n.value, neg });
    else if (n.kind === 'not' && n.child.kind === 'field') out.push({ field: n.child.field, value: n.child.value, neg: !neg });
  };
  if (ast) walk(ast, false);
  return out;
}
