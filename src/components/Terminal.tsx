import { useEffect, useRef, useState } from 'react';
import { ChevronDown, Plus, X } from 'lucide-react';
import { Terminal as Xterm } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import '@xterm/xterm/css/xterm.css';
import type { TermSession, TermShell } from '../lib/types';

const api = window.pinpoint;

const THEME = {
  background: '#131419', foreground: '#d7d9e0', cursor: '#ffd60a', cursorAccent: '#131419', selectionBackground: 'rgba(255, 214, 10, .28)',
  black: '#1c1d24', red: '#ff5d73', green: '#34d399', yellow: '#ffd60a', blue: '#6aa8ff', magenta: '#c792ea', cyan: '#5fd7e6', white: '#d7d9e0',
  brightBlack: '#6b7080', brightRed: '#ff8597', brightGreen: '#6ee7b7', brightYellow: '#ffe45c', brightBlue: '#93c0ff', brightMagenta: '#dab4f5', brightCyan: '#8be9f5', brightWhite: '#ffffff',
};

// One session's screen. It is created when the session is first shown and kept
// (hidden) while another session is in front, so its scrollback and cursor survive.
function Screen({ id, active }: { id: string; active: boolean }) {
  const box = useRef<HTMLDivElement>(null);
  const term = useRef<Xterm | null>(null);
  const fit = useRef<FitAddon | null>(null);
  const [ready, setReady] = useState(false); // its earlier output has been put back

  useEffect(() => {
    const t = new Xterm({ fontFamily: 'ui-monospace, "Cascadia Mono", "SF Mono", Menlo, Consolas, monospace', fontSize: 12.5, lineHeight: 1.25, cursorBlink: true, scrollback: 5000, theme: THEME, allowProposedApi: true });
    const f = new FitAddon();
    t.loadAddon(f);
    t.open(box.current!);
    term.current = t;
    fit.current = f;
    let live = true;
    // What it printed before this view existed (the drawer was closed, or the app was showing something else).
    // It is replayed at the size it was printed for (the output moves the cursor around
    // by row and column), and only then fitted to the space there is now.
    api.termAttach(id).then((s) => {
      if (!live) return;
      if (s) {
        if (s.buffer) { t.resize(s.cols, s.rows); t.write(s.buffer); }
        if (s.exited) t.write('\r\n\x1b[2m[process ended]\x1b[0m\r\n');
      }
      t.write('', () => { if (live) setReady(true); });
    });
    const offData = api.onTermData((e) => { if (e.id === id) t.write(e.data); });
    const offExit = api.onTermExit((e) => { if (e.id === id) t.write(`\r\n\x1b[2m[process ended${e.code ? ` with code ${e.code}` : ''}]\x1b[0m\r\n`); });
    const typed = t.onData((data) => api.termWrite(id, data));
    const sized = t.onResize(({ cols, rows }) => api.termResize(id, cols, rows));
    // Copy with Ctrl+C when text is selected (otherwise it interrupts, as usual); paste with Ctrl+V.
    t.attachCustomKeyEventHandler((e) => {
      if (e.type !== 'keydown' || !(e.ctrlKey || e.metaKey)) return true;
      if (e.key.toLowerCase() === 'c' && t.hasSelection()) { navigator.clipboard.writeText(t.getSelection()).catch(() => {}); t.clearSelection(); return false; }
      if (e.key.toLowerCase() === 'v') { navigator.clipboard.readText().then((text) => { if (text) t.paste(text); }).catch(() => {}); e.preventDefault(); return false; }
      return true;
    });
    return () => { live = false; offData(); offExit(); typed.dispose(); sized.dispose(); t.dispose(); term.current = null; };
  }, [id]);

  // Fits the grid of characters to the space it has, whenever that changes.
  useEffect(() => {
    if (!active || !ready || !box.current) return;
    const refit = () => { try { fit.current?.fit(); } catch { /* not laid out yet */ } };
    const ro = new ResizeObserver(refit);
    ro.observe(box.current);
    refit();
    term.current?.focus();
    return () => ro.disconnect();
  }, [active, ready]);

  return <div ref={box} className="term-screen" style={{ display: active ? 'block' : 'none' }} />;
}

// The Terminal tab of the drawer: one or more sessions, each in a shell you choose
// from the ones installed on this computer, started in the project folder.
export function TerminalPane({ cwd, preferred, onPrefer }: { cwd: string; preferred?: string; onPrefer(shell: string): void }) {
  const [shells, setShells] = useState<TermShell[] | null>(null);
  const [sessions, setSessions] = useState<TermSession[]>([]);
  const [current, setCurrent] = useState<string | null>(null);
  const [menu, setMenu] = useState<{ left: number; bottom: number } | null>(null); // where the shell list opens (above the button)
  const [error, setError] = useState<string | null>(null);
  const started = useRef(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const start = async (shell?: string) => {
    setMenu(null);
    try {
      const s = await api.termOpen({ shell, cwd, cols: 100, rows: 24 });
      setError(null);
      setSessions((l) => [...l, s]);
      setCurrent(s.id);
      if (shell) onPrefer(shell);
    } catch (e) { setError(String((e as Error).message || e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '')); }
  };

  useEffect(() => {
    let live = true;
    Promise.all([api.termShells(), api.termList()]).then(([sh, open]) => {
      if (!live) return;
      setShells(sh);
      setSessions(open);
      if (open.length) setCurrent(open[open.length - 1].id);
      // The first time the tab is opened there is nothing running yet: start your usual shell.
      else if (!started.current) { started.current = true; start(sh.some((s) => s.id === preferred) ? preferred : undefined); }
    }).catch((e) => setError(String(e.message || e)));
    return () => { live = false; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => api.onTermExit((e) => setSessions((l) => l.map((s) => (s.id === e.id ? { ...s, exited: true } : s)))), []);
  useEffect(() => {
    if (!menu) return;
    const close = (e: MouseEvent) => { if (!menuRef.current?.contains(e.target as Node)) setMenu(null); };
    window.addEventListener('mousedown', close);
    return () => window.removeEventListener('mousedown', close);
  }, [menu]);

  const close = (id: string) => {
    api.termClose(id);
    setSessions((l) => {
      const next = l.filter((s) => s.id !== id);
      if (current === id) setCurrent(next.length ? next[next.length - 1].id : null);
      return next;
    });
  };
  const usual = shells?.find((s) => s.id === preferred) || shells?.[0];

  return (
    <div className="term">
      <div className="term-bar">
        {sessions.map((s) => (
          <div key={s.id} className={`term-tab ${s.id === current ? 'on' : ''} ${s.exited ? 'ended' : ''}`} onClick={() => setCurrent(s.id)} title={s.exited ? `${s.name} (ended)` : s.name}>
            <span>{s.name}</span>
            <button onClick={(e) => { e.stopPropagation(); close(s.id); }} title="Close this terminal"><X size={11} /></button>
          </div>
        ))}
        <div className="term-new" ref={menuRef}>
          <button className="term-plus" onClick={() => start(usual?.id)} disabled={!usual} title={usual ? `New ${usual.name} terminal` : 'No shell found'}><Plus size={13} /></button>
          <button
            className="term-plus" disabled={!shells?.length} title="Choose a shell"
            onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setMenu(menu ? null : { left: Math.max(8, Math.min(r.left - 20, window.innerWidth - 300)), bottom: window.innerHeight - r.top + 6 }); }}
          ><ChevronDown size={12} /></button>
          {menu && (
            <div className="term-menu" style={menu}>
              <div className="dd-title">Shells on this computer</div>
              {shells!.map((s) => (
                <button key={s.id} onClick={() => start(s.id)} title={s.path}>
                  <b>{s.name}</b><small>{s.path}</small>
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
      <div className="term-body">
        {error && <div className="term-msg">{error}</div>}
        {!error && shells && !sessions.length && <div className="term-msg">No terminal open. Press + to start one in {cwd || 'your home folder'}.</div>}
        {sessions.map((s) => <Screen key={s.id} id={s.id} active={s.id === current} />)}
      </div>
    </div>
  );
}
