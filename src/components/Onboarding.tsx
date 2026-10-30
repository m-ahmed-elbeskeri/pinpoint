import { useState } from 'react';
import { Check, ClipboardCopy, FolderOpen, RotateCw, TerminalSquare, X } from './icons';
import { AgentIcon } from './AgentIcon';
import type { AgentId, HarnessInfo } from '../lib/types';

// How to get each agent. Signing in happens in the CLI itself: Pinpoint can see that it's installed, not that it's signed in.
const SETUP: Record<string, { install: string; signIn: string }> = {
  claude: { install: 'npm install -g @anthropic-ai/claude-code', signIn: 'claude' },
  codex: { install: 'npm install -g @openai/codex', signIn: 'codex login' },
  gemini: { install: 'npm install -g @google/gemini-cli', signIn: 'gemini' },
};

interface Props {
  agents: Record<string, { ok: boolean; version?: string }> | null;
  harnesses: HarnessInfo[];
  current: AgentId;
  projectDir: string;
  onPick(id: AgentId): void;
  onRecheck(): void;
  onTerminal(): void;
  onOpenProject(): void;
  onSettings(): void;
  onDone(): void;
}

export function Onboarding({ agents, harnesses, current, projectDir, onPick, onRecheck, onTerminal, onOpenProject, onSettings, onDone }: Props) {
  const [copied, setCopied] = useState('');
  const copy = (cmd: string) => { navigator.clipboard?.writeText(cmd); setCopied(cmd); setTimeout(() => setCopied((c) => (c === cmd ? '' : c)), 1400); };
  const installed = harnesses.filter((h) => agents?.[h.id]?.ok);
  const missing = harnesses.filter((h) => !agents?.[h.id]?.ok && SETUP[h.id]);
  const command = (cmd: string) => (
    <button className={`onb-cmd ${copied === cmd ? 'done' : ''}`} onClick={() => copy(cmd)} title="Copy">
      <code>{cmd}</code>{copied === cmd ? <Check size={12} /> : <ClipboardCopy size={12} />}
    </button>
  );
  return (
    <div className="onb" role="region" aria-label="Set up Pinpoint">
      <button className="icon-btn xs onb-x" onClick={onDone} title="Dismiss"><X size={14} /></button>
      <h4>Your agents</h4>
      {installed.map((h) => (
        <div key={h.id} className={`onb-row ${current === h.id ? 'on' : ''}`}>
          <AgentIcon id={h.id} name={h.name} size={16} />
          <span className="onb-name">{h.name}<small>{agents?.[h.id]?.version}</small></span>
          {SETUP[h.id] && command(SETUP[h.id].signIn)}
          {current === h.id ? <Check size={14} className="onb-tick" /> : <button className="btn xs ghost" onClick={() => onPick(h.id)}>Use</button>}
        </div>
      ))}
      {installed.length > 0 && <p className="onb-hint">Run the command once in a terminal if the agent hasn't been signed in yet.</p>}
      {missing.map((h) => (
        <div key={h.id} className="onb-row off">
          <AgentIcon id={h.id} name={h.name} size={16} />
          <span className="onb-name">{h.name}</span>
          {command(SETUP[h.id].install)}
        </div>
      ))}
      <div className="onb-foot">
        <button className="btn xs ghost" onClick={onTerminal}><TerminalSquare size={12} /> Terminal</button>
        <button className="btn xs ghost" onClick={onRecheck}><RotateCw size={12} /> Check again</button>
        <button className="btn xs ghost" onClick={onSettings}>Other agents…</button>
        <div className="spacer" />
        {!projectDir && <button className="btn xs primary" onClick={onOpenProject}><FolderOpen size={12} /> Open a project</button>}
        {projectDir && <button className="btn xs primary" onClick={onDone} disabled={!installed.length}>Done</button>}
      </div>
    </div>
  );
}
