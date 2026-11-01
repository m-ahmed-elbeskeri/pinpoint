import { useEffect, useRef, useState } from 'react';
import { Check, Eye, FileText, Loader2, PenLine, Plus, RotateCw, Search } from '../ui/icons';
import { Markdown } from '../chat';
import type { AgentExtension, AgentExtensions, InstructionFile, Settings } from '../../types';
import { errText } from '../../lib/util';

interface ListProps {
  kind: 'mcp' | 'skills';
  settings: Settings;
  saveSettings(p: Partial<Settings>): void;
  agentName: string;
}

const NOUN = { mcp: 'MCP servers', skills: 'skills' };

export function ExtensionList({ kind, settings, saveSettings, agentName }: ListProps) {
  const [data, setData] = useState<AgentExtensions | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const agent = settings.agent;

  const refresh = () => {
    setChecking(true);
    setError('');
    window.pinpoint.listExtensions().then(setData).catch((e) => setError(errText(e))).finally(() => setChecking(false));
  };
  useEffect(() => {
    setData(null);
    window.pinpoint.cachedExtensions().then((c) => setData((now) => now || c)).catch(() => {}); // the live list follows
    refresh();
  }, [agent]);

  const toggle = (item: AgentExtension, on: boolean) => {
    const mine = settings.extensions?.[agent] || { mcp: {}, skills: {} };
    saveSettings({ extensions: { ...settings.extensions, [agent]: { ...mine, [kind]: { ...mine[kind], [item.id]: on } } } });
    setData((d) => d && { ...d, [kind]: d[kind].map((x) => (x.id === item.id ? { ...x, enabled: on } : x)) });
  };

  const all = data?.[kind] || [];
  const q = query.trim().toLowerCase();
  const items = q ? all.filter((x) => `${x.name} ${x.description || ''}`.toLowerCase().includes(q)) : all;
  const active = all.filter((x) => x.enabled).length;

  if (data && !data.supported) return <div className="sheet-body"><div className="sheet-empty"><b>Not available for {agentName}</b><span>Switching {NOUN[kind]} on and off works with Claude Code and Codex. {agentName} uses its own configuration.</span></div></div>;
  return (
    <div className="sheet-body">
      <div className="ext-head">
        <span>{data ? `${active} of ${all.length} on for ${agentName}` : `Asking ${agentName}…`}</span>
        <button className="icon-btn xs" onClick={refresh} disabled={checking} title="Check again">{checking ? <Loader2 size={13} className="spin" /> : <RotateCw size={13} />}</button>
      </div>
      <p className="ext-note">Applies from your next message, in Pinpoint only. {agentName}'s own setup isn't changed.</p>
      {error && <p className="ext-error">{error}</p>}
      {all.length > 6 && (
        <label className="ext-search"><Search size={13} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={`Find ${kind === 'mcp' ? 'a server' : 'a skill'}`} spellCheck={false} /></label>
      )}
      {data && !all.length && <div className="sheet-empty"><b>No {NOUN[kind]} found</b></div>}
      <ul className="ext-list">
        {items.map((item) => (
          <li key={item.id} className={item.enabled ? '' : 'off'}>
            <div className="ext-text">
              <b title={item.name}>{item.name}</b>
              {item.description && <small title={item.description}>{item.description}</small>}
              {kind === 'mcp' && <small className={item.status === 'connected' ? 'ok' : ''}>{[item.status, item.source].filter(Boolean).join(' · ')}</small>}
            </div>
            <button className={`toggle ${item.enabled ? 'on' : ''}`} onClick={() => toggle(item, !item.enabled)} role="switch" aria-checked={item.enabled} aria-label={item.name} title={item.enabled ? 'Switch off' : 'Switch on'}>
              <span className="toggle-track"><span className="toggle-thumb" /></span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const fileNote = (f: InstructionFile) => (f.scope === 'All your projects' ? 'Applies to every project on this computer.' : f.key === 'claude-local' ? 'Just for you: usually kept out of git.' : 'Shared with anyone working in this project once committed.');
const READ_BY: Record<string, string> = { claude: 'Claude Code', 'claude-local': 'Claude Code', 'claude-user': 'Claude Code', agents: 'Codex and others', 'codex-user': 'Codex' };

export function InstructionsTab() {
  const [files, setFiles] = useState<InstructionFile[] | null>(null);
  const [key, setKey] = useState('claude');
  const [text, setText] = useState('');
  const [view, setView] = useState<'read' | 'edit'>('read');
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [error, setError] = useState('');
  const timer = useRef<number>();
  const pending = useRef<{ key: string; text: string } | null>(null);
  const editor = useRef<HTMLTextAreaElement>(null);

  const flush = () => {
    window.clearTimeout(timer.current);
    const p = pending.current;
    if (!p) return;
    pending.current = null;
    window.pinpoint.writeInstructions(p.key, p.text).then(() => {
      setFiles((l) => l && l.map((f) => (f.key === p.key ? { ...f, content: p.text, exists: true } : f)));
      setState('saved');
    }).catch((e) => { setError(errText(e)); setState('idle'); });
  };
  const show = (f: InstructionFile) => { setKey(f.key); setText(f.content); setView(f.content.trim() ? 'read' : 'edit'); setState('idle'); };
  useEffect(() => {
    window.pinpoint.readInstructions().then((l) => {
      setFiles(l);
      // Opens on the project's own file. Personal ones affect every project, so they're only ever picked by hand.
      show(l.find((f) => f.exists && f.scope.startsWith('Project')) || l[0]);
    }).catch((e) => setError(errText(e)));
    return flush;
  }, []);

  const edit = (value: string) => {
    setText(value);
    setState('saving');
    pending.current = { key, text: value };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, 500);
  };
  const create = () => {
    window.pinpoint.writeInstructions(key, '').then(() => {
      setFiles((l) => l && l.map((f) => (f.key === key ? { ...f, exists: true } : f)));
      setView('edit');
      setTimeout(() => editor.current?.focus(), 0);
    }).catch((e) => setError(errText(e)));
  };
  const current = files?.find((f) => f.key === key);
  const group = (title: string, list: InstructionFile[]) => (
    <div className="instr-group">
      <div className="instr-group-title">{title}</div>
      {list.map((f) => (
        <button key={f.key} className={`instr-file ${f.key === key ? 'on' : ''} ${f.exists ? '' : 'missing'}`} onClick={() => { flush(); show(f); }} title={f.path}>
          <FileText size={14} />
          <span className="instr-file-name">{f.label}<small>{f.exists ? READ_BY[f.key] : 'Not created'}</small></span>
        </button>
      ))}
    </div>
  );

  return (
    <div className="instr">
      {error && <p className="ext-error">{error}</p>}
      {files && (
        <nav className="instr-files">
          {group('This project', files.filter((f) => f.scope.startsWith('Project')))}
          {group('All your projects', files.filter((f) => !f.scope.startsWith('Project')))}
        </nav>
      )}
      {current && (
        <section className="instr-doc">
          <header className="instr-doc-head">
            <div className="instr-doc-title">
              <b>{current.label}</b>
              <small title={current.path}>{current.path}</small>
            </div>
            {state === 'saving' && <Loader2 size={13} className="spin" />}
            {state === 'saved' && <span className="instr-saved"><Check size={13} /> Saved</span>}
            {current.exists && (
              <div className="seg instr-mode">
                <button className={view === 'read' ? 'on' : ''} onClick={() => { flush(); setView('read'); }}><Eye size={13} /> Read</button>
                <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}><PenLine size={13} /> Edit</button>
              </div>
            )}
          </header>
          <p className="instr-note">{fileNote(current)}</p>
          {!current.exists ? (
            <div className="instr-empty">
              <FileText size={22} />
              <b>{current.label} doesn't exist yet</b>
              <span>Agents read it when a session starts. Use it for how this code should be written, run and tested.</span>
              <button className="btn sm primary instr-create" onClick={create}><Plus size={13} /> Create {current.label}</button>
            </div>
          ) : view === 'edit' ? (
            <textarea ref={editor} className="instr-editor" value={text} onChange={(e) => edit(e.target.value)} onBlur={flush} spellCheck={false} placeholder="# Project notes for agents" />
          ) : (
            <div className="instr-read">{text.trim() ? <Markdown text={text} /> : <span className="hint">This file is empty.</span>}</div>
          )}
        </section>
      )}
    </div>
  );
}
