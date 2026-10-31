import { useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { Search } from '../ui/icons';
import type { IconProps } from '@phosphor-icons/react';

export interface Command {
  id: string;
  label: string;
  group: string;
  icon?: ComponentType<IconProps>;
  keys?: string;
  hint?: string;
  disabled?: boolean;
  run(): void;
}

interface Props {
  commands: Command[];
  onClose(): void;
  onQuery?(q: string): void;
  placeholder?: string;
}

const RECENT_KEY = 'pp.recentCommands';
const readRecent = (): string[] => { try { return JSON.parse(localStorage.getItem(RECENT_KEY) || '[]'); } catch { return []; } };
const remember = (id: string) => { try { localStorage.setItem(RECENT_KEY, JSON.stringify([id, ...readRecent().filter((x) => x !== id)].slice(0, 5))); } catch { /* storage off */ } };

function score(c: Command, q: string) {
  if (!q) return 1;
  const text = `${c.label} ${c.group} ${c.hint || ''}`.toLowerCase();
  const label = c.label.toLowerCase();
  if (label.startsWith(q)) return 4;
  if (label.split(/\s+/).some((w) => w.startsWith(q))) return 3;
  if (text.includes(q)) return 2;
  let i = 0;
  for (const ch of label) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

export function CommandPalette({ commands, onClose, onQuery, placeholder }: Props) {
  const [query, setQuery] = useState('');
  const [hi, setHi] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => { onQuery?.(query.trim()); }, [query]);
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) {
      // No query: the commands you used last come first, then everything in its usual order.
      const byId = new Map(commands.filter((c) => !c.disabled).map((c) => [c.id, c]));
      const recent = readRecent().map((id) => byId.get(id)).filter((c): c is Command => !!c && !c.id.startsWith('hit:')).map((c) => ({ ...c, group: 'Recent' }));
      const rest = commands.filter((c) => !c.disabled && !c.id.startsWith('hit:'));
      return [...recent, ...rest];
    }
    return commands
      .filter((c) => !c.disabled)
      .map((c, i) => ({ c, s: score(c, q), i }))
      .filter((r) => r.s > 0)
      .sort((a, b) => (q ? b.s - a.s : 0) || a.i - b.i)
      .map((r) => r.c);
  }, [commands, query]);

  useEffect(() => setHi(0), [query]);
  useEffect(() => {
    listRef.current?.querySelector('.cmd-item.hi')?.scrollIntoView({ block: 'nearest' });
  }, [hi]);

  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    remember(c.id.replace(/^Recent:/, ''));
    c.run();
  };

  let lastGroup = '';
  return (
    <div className="modal-backdrop cmd-backdrop" onMouseDown={onClose}>
      <div className="cmd" onMouseDown={(e) => e.stopPropagation()} role="dialog" aria-label="Commands">
        <label className="cmd-input">
          <Search size={15} />
          <input
            autoFocus value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder={placeholder || "Type a command or search chats…"} spellCheck={false}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => Math.min(results.length - 1, h + 1)); }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => Math.max(0, h - 1)); }
              else if (e.key === 'Enter') { e.preventDefault(); run(results[hi]); }
              else if (e.key === 'Escape') { e.preventDefault(); onClose(); }
            }}
          />
          <kbd>Esc</kbd>
        </label>
        <div className="cmd-list" ref={listRef}>
          {results.length === 0 && <div className="cmd-empty">Nothing matches “{query}”</div>}
          {results.map((c, i) => {
            const head = !query.trim() && c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <div key={`${c.group}:${c.id}`}>
                {head && <div className="cmd-group">{head}</div>}
                <button className={`cmd-item ${i === hi ? 'hi' : ''}`} onMouseMove={() => setHi(i)} onClick={() => run(c)}>
                  {c.icon ? <c.icon size={15} className="cmd-icon" /> : <span className="cmd-icon" />}
                  <span className="cmd-label">{c.label}</span>
                  {c.hint && <span className="cmd-hint">{c.hint}</span>}
                  {query.trim() && <span className="cmd-hint">{c.group}</span>}
                  {c.keys && <span className="cmd-keys">{c.keys.split(' ').map((k) => <kbd key={k}>{k}</kbd>)}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
