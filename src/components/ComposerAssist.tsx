import { useEffect, useMemo, useRef, useState, type ComponentType, type RefObject } from 'react';
import { FileText } from './icons';
import type { IconProps } from '@phosphor-icons/react';

export interface SlashCommand {
  name: string;
  hint: string;
  icon?: ComponentType<IconProps>;
  run(rest: string): void;
}

interface Match { key: string; label: string; sub?: string; icon?: ComponentType<IconProps>; apply(): void }

// What the caret is in the middle of: "/command" at the very start, or an "@path" word.
function tokenAt(value: string, caret: number) {
  const before = value.slice(0, caret);
  const slash = /^\/([\w-]*)$/.exec(before);
  if (slash) return { kind: 'slash' as const, query: slash[1], start: 0 };
  const at = /(^|\s)@([^\s@]*)$/.exec(before);
  if (at) return { kind: 'file' as const, query: at[2], start: caret - at[2].length - 1 };
  return null;
}

function fileScore(path: string, q: string) {
  if (!q) return 1;
  const p = path.toLowerCase(), name = p.slice(p.lastIndexOf('/') + 1);
  if (name.startsWith(q)) return 5;
  if (name.includes(q)) return 4;
  if (p.includes(q)) return 3;
  let i = 0;
  for (const ch of p) if (ch === q[i]) i++;
  return i === q.length ? 1 : 0;
}

export function useComposerAssist(ref: RefObject<HTMLTextAreaElement | null>, value: string, setValue: (v: string) => void, commands: SlashCommand[]) {
  const [caret, setCaret] = useState(0);
  const [hi, setHi] = useState(0);
  const [closed, setClosed] = useState<string | null>(null);
  const files = useRef<string[] | null>(null);
  const [filesReady, setFilesReady] = useState(0);

  const token = tokenAt(value, caret);
  useEffect(() => {
    if (token?.kind === 'file' && !files.current) {
      files.current = [];
      window.pinpoint.projectFiles().then((f) => { files.current = f; setFilesReady((n) => n + 1); }).catch(() => {});
    }
  }, [token?.kind]);

  const insert = (start: number, end: number, text: string) => {
    const next = value.slice(0, start) + text + value.slice(end);
    setValue(next);
    setTimeout(() => { const t = ref.current; if (t) { t.focus({ preventScroll: true }); t.selectionStart = t.selectionEnd = start + text.length; setCaret(start + text.length); } }, 0);
  };

  const matches: Match[] = useMemo(() => {
    if (!token) return [];
    const q = token.query.toLowerCase();
    if (token.kind === 'slash') {
      return commands.filter((c) => c.name.startsWith(q)).slice(0, 8).map((c) => ({
        key: c.name, label: `/${c.name}`, sub: c.hint, icon: c.icon,
        apply: () => { setValue(''); c.run(value.slice(c.name.length + 1).trim()); },
      }));
    }
    return (files.current || [])
      .map((f) => ({ f, s: fileScore(f, q) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s || a.f.length - b.f.length)
      .slice(0, 8)
      .map(({ f }) => ({
        key: f, label: f.slice(f.lastIndexOf('/') + 1), sub: f.includes('/') ? f.slice(0, f.lastIndexOf('/')) : '', icon: FileText,
        apply: () => insert(token.start, caret, `@${f} `),
      }));
  }, [token?.kind, token?.query, token?.start, filesReady, commands, caret, value]);

  const open = matches.length > 0 && closed !== `${token?.kind}:${token?.start}`;
  useEffect(() => setHi(0), [token?.kind, token?.query]);

  // Returns true when the key was for the popover and the composer should ignore it.
  const onKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (!open) {
      // "/save some text" + Enter: a known command with an argument runs instead of being sent to the agent.
      const typed = /^\/([\w-]+)(?:\s+([\s\S]*))?$/.exec(value);
      const cmd = typed && e.key === 'Enter' && !e.shiftKey ? commands.find((c) => c.name === typed[1]) : null;
      if (cmd) { e.preventDefault(); setValue(''); cmd.run((typed![2] || '').trim()); return true; }
      return false;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => (h + 1) % matches.length); return true; }
    if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => (h - 1 + matches.length) % matches.length); return true; }
    if ((e.key === 'Enter' && !e.shiftKey) || e.key === 'Tab') { e.preventDefault(); matches[hi]?.apply(); return true; }
    if (e.key === 'Escape') { e.preventDefault(); setClosed(`${token?.kind}:${token?.start}`); return true; }
    return false;
  };
  const track = () => { const t = ref.current; if (t) setCaret(t.selectionStart); };

  const popover = open ? (
    <div className="assist" role="listbox">
      <div className="assist-title">{token?.kind === 'slash' ? 'Commands' : files.current?.length ? 'Files' : 'Reading the project…'}</div>
      {matches.map((m, i) => (
        <button key={m.key} className={`assist-item ${i === hi ? 'hi' : ''}`} onMouseDown={(e) => e.preventDefault()} onMouseMove={() => setHi(i)} onClick={() => m.apply()}>
          {m.icon ? <m.icon size={14} className="assist-icon" /> : <span className="assist-icon" />}
          <span className="assist-label">{m.label}</span>
          {m.sub && <span className="assist-sub">{m.sub}</span>}
        </button>
      ))}
    </div>
  ) : null;

  return { popover, onKeyDown, track };
}
