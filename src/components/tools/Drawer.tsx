import { lazy, Suspense, useEffect, useRef, useState, type ReactNode } from 'react';
import { Columns2, FileText, FileTree, Globe, Play, Square, TerminalSquare, X } from '../ui/icons';
import type { DevCandidate } from '../../types';

const TerminalPane = lazy(() => import('./Terminal').then((m) => ({ default: m.TerminalPane })));

export type DrawerTab = 'term' | 'dev' | 'agent' | 'net' | 'files';
export const TOOLS: { id: DrawerTab; label: string; icon: typeof Globe }[] = [
  { id: 'files', label: 'Files', icon: FileTree },
  { id: 'term', label: 'Terminal', icon: TerminalSquare },
  { id: 'dev', label: 'Dev server', icon: Play },
  { id: 'net', label: 'Network', icon: Globe },
  { id: 'agent', label: 'Agent logs', icon: FileText },
];
interface Props {
  tab: DrawerTab;
  setTab(t: DrawerTab): void;
  cwd: string;
  shell?: string;
  onShell(shell: string): void;
  network: ReactNode;
  files: ReactNode;
  split: boolean;
  onSplit(): void;
  netFailed: number;
  devLog: string;
  agentLog: string;
  devRunning: boolean;
  devCommand: string;
  devCandidates?: DevCandidate[];
  servicesRunning: string[];
  onService(c: DevCandidate, on: boolean): void;
  onStartDev(cmd: string): void;
  onStopDev(): void;
  onClose(): void;
}

export function Drawer(p: Props) {
  const [cmd, setCmd] = useState(p.devCommand);
  const pre = useRef<HTMLPreElement>(null);
  const seen = useRef(false);
  if (p.tab === 'term') seen.current = true;
  const text = (p.tab === 'dev' ? p.devLog : p.agentLog).slice(-40_000);

  useEffect(() => { setCmd(p.devCommand); }, [p.devCommand]);
  useEffect(() => { pre.current?.scrollTo(0, pre.current.scrollHeight); }, [text]);

  // Whatever else the project runs, offered next to the main command.
  const services = (p.devCandidates || []).filter((c) => c.command !== cmd && (c.kind === 'api' || c.kind === 'worker' || c.kind === 'stack'));
  const [termSlot, setTermSlot] = useState<HTMLDivElement | null>(null);
  return (
    <div className="drawer">
      <div className="drawer-head">
        <div className="tabs">
          <button className={p.tab === 'term' ? 'on' : ''} onClick={() => p.setTab('term')}>Terminal</button>
          <button className={p.tab === 'dev' ? 'on' : ''} onClick={() => p.setTab('dev')}>
            Dev server {p.devRunning && <span className="live-dot" />}
          </button>
          <button className={p.tab === 'net' ? 'on' : ''} onClick={() => p.setTab('net')}>
            Network {p.netFailed > 0 && <span className="tab-count">{p.netFailed}</span>}
          </button>
          <button className={p.tab === 'agent' ? 'on' : ''} onClick={() => p.setTab('agent')}>Agent logs</button>
        </div>
        {p.tab === 'dev' && (
          <form className="dev-cmd" onSubmit={(e) => { e.preventDefault(); if (cmd.trim()) p.onStartDev(cmd.trim()); }}>
            <span className="prompt-sign">$</span>
            <input value={cmd} onChange={(e) => setCmd(e.target.value)} spellCheck={false} list="dev-candidates" placeholder="npm run dev" />
            <datalist id="dev-candidates">
              {p.devCandidates?.map((c) => <option key={c.command} value={c.command}>{c.label}{c.dir !== '.' ? ` (${c.dir})` : ''}</option>)}
            </datalist>
            {p.devRunning
              ? <button type="button" className="btn xs danger" onClick={p.onStopDev}><Square size={11} /> Stop</button>
              : <button type="submit" className="btn xs primary"><Play size={11} /> Run</button>}
          </form>
        )}
        {p.tab === 'term' ? <div className="term-slot" ref={setTermSlot} /> : p.tab !== 'dev' && <div className="spacer" />}
        <button className={`icon-btn tool-split ${p.split ? 'on' : ''}`} onClick={p.onSplit} aria-pressed={p.split} title={p.split ? 'Show this over the page' : 'Show this beside the page'}><Columns2 size={15} /></button>
        <button className="icon-btn" onClick={p.onClose}><X size={15} /></button>
      </div>
      <div className="term-wrap" style={{ display: p.tab === 'term' ? 'flex' : 'none' }}>
        {(p.tab === 'term' || seen.current) && <Suspense fallback={null}><TerminalPane cwd={p.cwd} preferred={p.shell} onPrefer={p.onShell} barSlot={p.tab === 'term' ? termSlot : null} /></Suspense>}
      </div>
      {p.tab === 'dev' && services.length > 0 && (
        <div className="dev-services">
          {services.map((c) => {
            const on = p.servicesRunning.includes(c.command);
            return (
              <button key={c.command} className={on ? 'on' : ''} onClick={() => p.onService(c, !on)} title={`${on ? 'Stop' : 'Also run'}: ${c.command}`}>
                {on ? <Square size={11} /> : <Play size={11} />}<span>{c.label}</span>{on && <span className="live-dot" />}
              </button>
            );
          })}
        </div>
      )}
      {p.tab === 'net' && p.network}
      {p.tab === 'files' && p.files}
      <pre ref={pre} className="drawer-log" style={{ display: p.tab === 'term' || p.tab === 'net' || p.tab === 'files' ? 'none' : undefined }}>{text || (p.tab === 'dev' ? 'Run your dev server here. Pinpoint opens the local URL it prints.' : 'No agent output yet.')}</pre>
    </div>
  );
}
