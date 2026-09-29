import { useEffect, useRef, useState } from 'react';
import { Play, Square, X } from 'lucide-react';
import type { DevCandidate } from '../lib/types';

interface Props {
  tab: 'dev' | 'agent';
  setTab(t: 'dev' | 'agent'): void;
  devLog: string;
  agentLog: string;
  devRunning: boolean;
  devCommand: string;
  devCandidates?: DevCandidate[];
  onStartDev(cmd: string): void;
  onStopDev(): void;
  onClose(): void;
}

// Bottom drawer: the dev-server terminal and raw agent logs.
export function Drawer(p: Props) {
  const [cmd, setCmd] = useState(p.devCommand);
  const pre = useRef<HTMLPreElement>(null);
  const text = p.tab === 'dev' ? p.devLog : p.agentLog;

  useEffect(() => { setCmd(p.devCommand); }, [p.devCommand]);
  useEffect(() => { pre.current?.scrollTo(0, pre.current.scrollHeight); }, [text]);

  return (
    <div className="drawer">
      <div className="drawer-head">
        <div className="tabs">
          <button className={p.tab === 'dev' ? 'on' : ''} onClick={() => p.setTab('dev')}>
            Dev server {p.devRunning && <span className="live-dot" />}
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
        <button className="icon-btn" onClick={p.onClose}><X size={15} /></button>
      </div>
      <pre ref={pre} className="drawer-log">{text || (p.tab === 'dev' ? 'Run your dev server here. Pinpoint opens the local URL it prints.' : 'No agent output yet.')}</pre>
    </div>
  );
}
