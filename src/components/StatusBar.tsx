import { useEffect } from 'react';
import { AlertTriangle, GitBranch, TerminalSquare, X } from './icons';

interface Props {
  branch?: string;
  dirty?: number;
  devRunning: boolean;
  devCommand: string;
  errors: number;
  agent: string;
  model: string;
  cost: number;
  today: number;
  onBranch(): void;
  onDev(): void;
  onErrors(): void;
}

export function StatusBar(p: Props) {
  return (
    <footer className="statusbar">
      {p.branch && (
        <button onClick={p.onBranch} title="Git: branches, commits and pull requests">
          <GitBranch size={12} /> {p.branch}{p.dirty ? <span className="sb-dim"> · {p.dirty} changed</span> : null}
        </button>
      )}
      <button onClick={p.onDev} title={p.devCommand ? `Dev server: ${p.devCommand}` : 'Dev server'}>
        <TerminalSquare size={12} /> <span className={`sb-dot ${p.devRunning ? 'on' : ''}`} /> {p.devRunning ? 'Dev server running' : 'Dev server stopped'}
      </button>
      {p.errors > 0 && (
        <button className="sb-errors" onClick={p.onErrors} title="Errors in the page's console">
          <AlertTriangle size={12} /> {p.errors} error{p.errors === 1 ? '' : 's'}
        </button>
      )}
      <div className="spacer" />
      {p.cost > 0 && <span className="sb-dim" title="What the runs in this chat have cost, as reported by the agent">${p.cost.toFixed(2)} this chat</span>}
      {p.today > 0 && <span className="sb-dim" title="Spent across all chats today, as reported by the agents">${p.today.toFixed(2)} today</span>}
      <span title="Agent and model">{p.agent}{p.model ? <span className="sb-dim"> · {p.model}</span> : null}</span>
    </footer>
  );
}

const SHORTCUTS: [string, [string, string][]][] = [
  ['General', [['Ctrl/⌘ K', 'Command palette'], ['?', 'This list'], ['Ctrl/⌘ ,', 'Settings']]],
  ['Chats', [['Ctrl/⌘ Shift O', 'New chat'], ['Ctrl/⌘ Shift A', 'New side chat'], ['Enter', 'Send (while working: after the current step)'], ['Ctrl/⌘ Enter', 'Interrupt and send now'], ['@', 'Mention a file'], ['/', 'Commands']]],
  ['Page', [['V', 'Browse'], ['S', 'Annotate: click an element or drag to draw'], ['↑ ↓', 'Annotate: pick the parent or child'], ['Alt', 'Annotate: measure from the selected element'], ['D', 'Draw'], ['K', 'Sketch'], ['F', 'Freeze the page'], ['Ctrl/⌘ T', 'New tab'], ['Esc', 'Back to browsing']]],
  ['Layout', [['Ctrl/⌘ Shift B', 'Chats sidebar'], ['Ctrl/⌘ B', 'Agent panel'], ['Ctrl/⌘ J', 'Terminal and logs'], ['Ctrl/⌘ Shift E', 'Files'], ['Ctrl/⌘ .', 'Zen mode'], ['Ctrl/⌘ Shift L', 'Copy a layout report']]],
];

const IS_MAC = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const keysFor = (k: string) => k.replace('Ctrl/⌘', IS_MAC ? '⌘' : 'Ctrl').replace('Shift', IS_MAC ? '⇧' : 'Shift');

export function ShortcutsSheet({ onClose }: { onClose(): void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape' || e.key === '?') { e.preventDefault(); onClose(); } };
    window.addEventListener('keydown', esc);
    return () => window.removeEventListener('keydown', esc);
  }, [onClose]);
  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal shortcuts" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head"><h3>Keyboard shortcuts</h3><button className="icon-btn" onClick={onClose}><X size={16} /></button></div>
        <div className="shortcut-cols">
          {SHORTCUTS.map(([group, rows]) => (
            <section key={group}>
              <h4>{group}</h4>
              {rows.map(([k, what]) => (
                <div key={k} className="shortcut-row"><span>{what}</span><span className="shortcut-keys">{keysFor(k).split(' ').map((x) => <kbd key={x}>{x}</kbd>)}</span></div>
              ))}
            </section>
          ))}
        </div>
      </div>
    </div>
  );
}
