/** Hand-written tokenizer for the log query language. Never throws: errors are tokens. */

export type TokenType = 'word' | 'string' | 'colon' | 'op' | 'lparen' | 'rparen' | 'and' | 'or' | 'not' | 'minus' | 'error';

export interface Token {
  type: TokenType;
  /** Raw source text. */
  text: string;
  /** Decoded value for words and strings (quotes and escapes removed). */
  value: string;
  start: number;
  end: number;
  /** For error tokens. */
  message?: string;
}

const isSpace = (c: string) => c === ' ' || c === '\t' || c === '\n' || c === '\r';
const isDelim = (c: string) => isSpace(c) || c === '(' || c === ')' || c === ':' || c === '"' || c === '>' || c === '<' || c === '=' || c === '!';

export function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (isSpace(c)) {
      i++;
      continue;
    }
    const start = i;
    if (c === '(') {
      out.push({ type: 'lparen', text: c, value: c, start, end: ++i });
    } else if (c === ')') {
      out.push({ type: 'rparen', text: c, value: c, start, end: ++i });
    } else if (c === ':') {
      out.push({ type: 'colon', text: c, value: c, start, end: ++i });
    } else if (c === '"') {
      i++;
      let val = '';
      let closed = false;
      while (i < n) {
        const d = src[i];
        if (d === '\\' && i + 1 < n) {
          val += src[i + 1];
          i += 2;
          continue;
        }
        if (d === '"') {
          closed = true;
          i++;
          break;
        }
        val += d;
        i++;
      }
      if (closed) out.push({ type: 'string', text: src.slice(start, i), value: val, start, end: i });
      else out.push({ type: 'error', text: src.slice(start, i), value: val, start, end: i, message: 'Unterminated string, expected closing "' });
    } else if (c === '>' || c === '<' || c === '=' || c === '!') {
      let op = c;
      if (src[i + 1] === '=') op += '=';
      i += op.length;
      if (op === '!' ) out.push({ type: 'error', text: op, value: op, start, end: i, message: "Unexpected '!', did you mean '!='?" });
      else out.push({ type: 'op', text: op, value: op, start, end: i });
    } else if (c === '-' && (start === 0 || isSpace(src[i - 1]) || src[i - 1] === '(') && i + 1 < n && !isSpace(src[i + 1])) {
      // leading minus before a clause is negation shorthand (-region:eu); "-5" stays a word
      if (/[0-9.]/.test(src[i + 1])) {
        i = readWord(src, i);
        out.push(wordToken(src, start, i));
      } else out.push({ type: 'minus', text: c, value: c, start, end: ++i });
    } else {
      i = readWord(src, i);
      out.push(wordToken(src, start, i));
    }
  }
  return out;
}

function readWord(src: string, i: number): number {
  let j = i;
  while (j < src.length && !isDelim(src[j])) j++;
  return j === i ? i + 1 : j;
}

function wordToken(src: string, start: number, end: number): Token {
  const text = src.slice(start, end);
  const up = text.toUpperCase();
  // Keywords are only keywords when upper-case, so the free-text word "and" still works lowercase.
  if (text === up && (up === 'AND' || up === 'OR' || up === 'NOT'))
    return { type: up.toLowerCase() as TokenType, text, value: up, start, end };
  return { type: 'word', text, value: text, start, end };
}
