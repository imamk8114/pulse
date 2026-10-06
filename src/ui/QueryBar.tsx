import { useEffect, useMemo, useRef, useState } from 'react';
import { parse } from '../engine/query/parser';
import { suggest } from '../engine/query/suggest';
import { LOG_SCHEMA } from '../engine/table';
import { Token } from '../engine/query/tokenizer';
import { deleteSaved, saveQuery, setQuery } from '../state/actions';
import { useStore } from '../state/store';
import { Icon } from './Icon';

function classify(tokens: Token[], i: number): string {
  const t = tokens[i];
  switch (t.type) {
    case 'word': {
      const next = tokens[i + 1];
      const prev = tokens[i - 1];
      if (next?.type === 'colon' || next?.type === 'op') return LOG_SCHEMA[t.value.toLowerCase()] ? 'tk-field' : 'tk-bad';
      if (prev?.type === 'op') return 'tk-num';
      if (prev?.type === 'colon') return 'tk-val';
      return 'tk-text';
    }
    case 'string':
      return 'tk-str';
    case 'colon':
    case 'op':
      return 'tk-op';
    case 'and':
    case 'or':
    case 'not':
    case 'minus':
      return 'tk-kw';
    case 'lparen':
    case 'rparen':
      return 'tk-paren';
    default:
      return 'tk-bad';
  }
}

export function Highlighted({ text, err }: { text: string; err?: { start: number; end: number } | null }) {
  const { tokens } = useMemo(() => parse(text), [text]);
  const parts: JSX.Element[] = [];
  let pos = 0;
  tokens.forEach((t, i) => {
    if (t.start > pos) parts.push(<span key={`g${i}`}>{text.slice(pos, t.start)}</span>);
    const bad = err && t.start < err.end && t.end > err.start;
    parts.push(
      <span key={i} className={`${classify(tokens, i)} ${bad ? 'tk-err' : ''}`}>
        {t.text}
      </span>,
    );
    pos = t.end;
  });
  if (pos < text.length) parts.push(<span key="tail">{text.slice(pos)}</span>);
  return <>{parts}</>;
}

export function QueryBar() {
  const q = useStore((s) => s.q);
  const saved = useStore((s) => s.saved);
  const logView = useStore((s) => s.logView);
  const inputRef = useRef<HTMLInputElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const [caret, setCaret] = useState(0);
  const [focus, setFocus] = useState(false);
  const [active, setActive] = useState(0);
  const [menu, setMenu] = useState(false);
  const [name, setName] = useState('');

  const parsed = useMemo(() => parse(q), [q]);
  const semantic = logView && logView.q === q ? logView.res.error : null;
  const err = parsed.errors[0] ?? semantic ?? null;
  const sug = useMemo(() => suggest(q, caret, LOG_SCHEMA), [q, caret]);
  const open = focus && sug.items.length > 0;
  useEffect(() => setActive(0), [q, caret]);

  const syncScroll = () => {
    if (hlRef.current && inputRef.current) hlRef.current.scrollLeft = inputRef.current.scrollLeft;
  };
  const accept = (i: number) => {
    const it = sug.items[i];
    if (!it) return;
    const next = q.slice(0, sug.from) + it.insert + q.slice(sug.to);
    const pos = sug.from + it.insert.length;
    setQuery(next);
    requestAnimationFrame(() => {
      inputRef.current?.setSelectionRange(pos, pos);
      setCaret(pos);
      inputRef.current?.focus();
    });
  };

  return (
    <div className="qbar">
      <div className="qrow">
        <div className={`qwrap ${err ? 'bad' : ''}`}>
          <Icon name="search" />
          <div className="qfield">
            <div className="qhl" ref={hlRef} aria-hidden>
              <Highlighted text={q} err={err} />
              {'​'}
            </div>
            <input
              ref={inputRef}
              id="log-query"
              className="qinput"
              value={q}
              spellCheck={false}
              autoComplete="off"
              placeholder='service:checkout level:error latency>500 "timeout" AND NOT region:eu'
              aria-label="Log query"
              aria-invalid={!!err}
              aria-describedby={err ? 'q-err' : undefined}
              role="combobox"
              aria-expanded={open}
              aria-controls="q-list"
              aria-autocomplete="list"
              aria-activedescendant={open ? `q-opt-${active}` : undefined}
              onChange={(e) => {
                setQuery(e.target.value);
                setCaret(e.target.selectionStart ?? e.target.value.length);
              }}
              onSelect={(e) => setCaret((e.target as HTMLInputElement).selectionStart ?? 0)}
              onScroll={syncScroll}
              onKeyUp={syncScroll}
              onFocus={() => setFocus(true)}
              onBlur={() => setTimeout(() => setFocus(false), 120)}
              onKeyDown={(e) => {
                if (!open) return;
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  setActive((a) => (a + 1) % sug.items.length);
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault();
                  setActive((a) => (a - 1 + sug.items.length) % sug.items.length);
                } else if (e.key === 'Tab' || (e.key === 'Enter' && sug.items.length && (sug.to > sug.from || sug.items[active]?.kind === 'value'))) {
                  e.preventDefault();
                  accept(active);
                } else if (e.key === 'Escape') {
                  setFocus(false);
                }
              }}
            />
          </div>
          {q && (
            <button className="icon-btn" aria-label="Clear query" onClick={() => setQuery('')}>
              <Icon name="x" />
            </button>
          )}
          {open && (
            <ul className="suggest" id="q-list" role="listbox" aria-label="Suggestions">
              {sug.items.map((it, i) => (
                <li
                  key={it.label + i}
                  id={`q-opt-${i}`}
                  role="option"
                  aria-selected={i === active}
                  className={i === active ? 'on' : ''}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    accept(i);
                  }}
                >
                  <span className={`kind ${it.kind}`}>{it.kind === 'field' ? 'field' : it.kind === 'value' ? 'value' : 'op'}</span>
                  <b>{it.label}</b>
                  <span className="det">{it.detail}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="saved">
          <button className="btn" aria-haspopup="true" aria-expanded={menu} onClick={() => setMenu((m) => !m)}>
            <Icon name="star" /> Saved
          </button>
          {menu && (
            <div className="menu" role="menu" onMouseLeave={() => undefined}>
              {saved.map((s) => (
                <div className="menu-row" key={s.name}>
                  <button
                    role="menuitem"
                    onClick={() => {
                      setQuery(s.q);
                      setMenu(false);
                    }}
                  >
                    <b>{s.name}</b>
                    <code>{s.q}</code>
                  </button>
                  <button className="icon-btn" aria-label={`Delete saved query ${s.name}`} onClick={() => deleteSaved(s.name)}>
                    <Icon name="trash" />
                  </button>
                </div>
              ))}
              <form
                className="menu-save"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (name.trim()) {
                    saveQuery(name.trim());
                    setName('');
                    setMenu(false);
                  }
                }}
              >
                <input placeholder="Name current query" value={name} onChange={(e) => setName(e.target.value)} aria-label="Name for saved query" />
                <button className="btn small" disabled={!q.trim() || !name.trim()}>
                  Save
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
      {err && (
        <div id="q-err" className="qerr" role="alert">
          <code>{q.slice(0, 80)}</code>
          <code className="caret">{' '.repeat(Math.min(err.start, 80)) + '^'.padEnd(Math.max(1, Math.min(err.end - err.start, 80 - err.start)), '~')}</code>
          <span>
            {'position ' + (err.start + 1)}: {err.message}
          </span>
        </div>
      )}
    </div>
  );
}
