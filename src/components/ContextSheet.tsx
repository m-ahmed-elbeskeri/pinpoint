import { useEffect, useRef, useState } from 'react';
import { Brain, Check, Eye, Loader2, Palette, PenLine, Plus, Sparkles, Trash2, Wand2, X } from './icons';
import { Markdown } from './Chat';
import type { DesignDoc, MemoryItem, Settings } from '../lib/types';
import { uid } from '../lib/draw';

export type ContextTab = 'design' | 'memory';

interface Props {
  tab: ContextTab;
  setTab(t: ContextTab): void;
  onClose(): void;
  settings: Settings;
  saveSettings(p: Partial<Settings>): void;
  design: DesignDoc | null;
  setDesign(d: DesignDoc): void;
  memory: MemoryItem[];
  setMemory(m: MemoryItem[]): void;
  canExtract: boolean;
  extract(): Promise<string | null>;
  askAgent(draft: string | null): void;
  root: string;
  designChanged: boolean;
  onNewChat(): void;
  chatBusy: boolean;
}

function Toggle({ on, onChange, label }: { on: boolean; onChange(v: boolean): void; label: string }) {
  return (
    <button className={`toggle ${on ? 'on' : ''}`} onClick={() => onChange(!on)} role="switch" aria-checked={on}>
      <span className="toggle-track"><span className="toggle-thumb" /></span>{label}
    </button>
  );
}

export function ContextSheet(p: Props) {
  const { onClose } = p;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="sheet-backdrop" onMouseDown={p.onClose}>
      <aside className="sheet" onMouseDown={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          <div className="tabs">
            <button className={p.tab === 'design' ? 'on' : ''} onClick={() => p.setTab('design')}><Palette size={14} /> Design</button>
            <button className={p.tab === 'memory' ? 'on' : ''} onClick={() => p.setTab('memory')}>
              <Brain size={14} /> Memory {p.memory.length > 0 && <span className="count">{p.memory.length}</span>}
            </button>
          </div>
          <button className="icon-btn" onClick={p.onClose} title="Close (Esc)"><X size={16} /></button>
        </div>
        {p.tab === 'design' ? <DesignTab {...p} /> : <MemoryTab {...p} />}
      </aside>
    </div>
  );
}

function DesignTab({ settings, saveSettings, design, setDesign, canExtract, extract, askAgent, root, designChanged, onNewChat, chatBusy }: Props) {
  const [text, setText] = useState(design?.content || '');
  const [view, setView] = useState<'edit' | 'preview'>(design?.exists ? 'preview' : 'edit');
  const [saved, setSaved] = useState<'idle' | 'saving' | 'saved'>('idle');
  const [busy, setBusy] = useState(false);
  const [confirmReplace, setConfirmReplace] = useState<string | null>(null);
  const timer = useRef<number>();

  useEffect(() => { setText(design?.content || ''); }, [design?.path]);

  const write = (value: string) => {
    setText(value);
    setSaved('saving');
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(async () => {
      setDesign(await window.pinpoint.writeDesign(value));
      setSaved('saved');
    }, 500);
  };

  const draft = async () => {
    setBusy(true);
    try {
      const md = await extract();
      if (!md) return;
      if (text.trim()) setConfirmReplace(md);
      else { write(md); setView('preview'); }
    } finally { setBusy(false); }
  };

  const rel = design?.path ? design.path.replace(/\\/g, '/').replace(root.replace(/\\/g, '/') + '/', '') : 'DESIGN.md';

  return (
    <div className="sheet-body">
      <div className="sheet-intro">
        <p>Your project's design system in plain words: colors, type, spacing, components. It's sent to the agent at the start of each chat. Saved as <code>{rel}</code> in your project, so your team can use it too.</p>
        <Toggle on={settings.useDesign} onChange={(v) => saveSettings({ useDesign: v })} label="Send at the start of each chat" />
      </div>

      {designChanged && (
        <div className="notice">
          <div>
            <b>Changes apply to new chats</b>
            <span>The current chat already received the earlier version. Start a new chat so the agent uses these rules.</span>
          </div>
          <button className="btn xs primary" onClick={onNewChat} disabled={chatBusy}>Start new chat</button>
        </div>
      )}

      <div className="sheet-toolbar">
        <div className="seg">
          <button className={view === 'edit' ? 'on' : ''} onClick={() => setView('edit')}><PenLine size={13} /> Edit</button>
          <button className={view === 'preview' ? 'on' : ''} onClick={() => setView('preview')} disabled={!text.trim()}><Eye size={13} /> Preview</button>
        </div>
        <span className="save-state">{saved === 'saving' ? 'Saving…' : saved === 'saved' ? <><Check size={12} /> Saved</> : ''}</span>
        <div className="spacer" />
        <button className="btn xs" onClick={draft} disabled={!canExtract || busy} title={canExtract ? 'Read colors, fonts, spacing and CSS variables from the open page' : 'Open your site first'}>
          {busy ? <Loader2 size={12} className="spin" /> : <Wand2 size={12} />} Draft from page
        </button>
        <button className="btn xs primary" onClick={async () => askAgent(canExtract ? await extract() : null)} title="Have the agent write or improve DESIGN.md from your code">
          <Sparkles size={12} /> Refine with agent
        </button>
      </div>

      {confirmReplace && (
        <div className="confirm-row">
          Replace the current rules with the new draft?
          <button className="btn xs" onClick={() => { write(confirmReplace); setConfirmReplace(null); setView('preview'); }}>Replace</button>
          <button className="btn xs" onClick={() => { write(text.trimEnd() + '\n\n' + confirmReplace); setConfirmReplace(null); }}>Append</button>
          <button className="btn xs ghost" onClick={() => setConfirmReplace(null)}>Cancel</button>
        </div>
      )}

      {!text.trim() && view === 'edit' && (
        <div className="sheet-empty">
          <Palette size={22} />
          <b>No design rules yet</b>
          <span>Draft them from the open page in one click, have the agent write them from your code, or start typing below.</span>
        </div>
      )}

      {view === 'edit' ? (
        <textarea
          className="design-editor"
          value={text}
          onChange={(e) => write(e.target.value)}
          placeholder={'# Design rules\n\n## Colors\n- Primary: #ffd60a\n\n## Rules\n- Buttons are pill-shaped'}
          spellCheck={false}
        />
      ) : (
        <div className="design-preview"><Markdown text={text} /></div>
      )}
    </div>
  );
}

function MemoryTab({ settings, saveSettings, memory, setMemory }: Props) {
  const [draft, setDraft] = useState('');
  const persist = (items: MemoryItem[]) => { setMemory(items); window.pinpoint.writeMemory(items); };
  const add = () => {
    if (!draft.trim()) return;
    persist([{ id: uid(), text: draft.trim(), enabled: true, createdAt: Date.now() }, ...memory]);
    setDraft('');
  };

  return (
    <div className="sheet-body">
      <div className="sheet-intro">
        <p>Short rules the agent should always keep in mind for this project. When you state a preference in chat, the agent offers to save it here.</p>
        <Toggle on={settings.useMemory} onChange={(v) => saveSettings({ useMemory: v })} label="Send with every request" />
      </div>

      <form className="mem-add" onSubmit={(e) => { e.preventDefault(); add(); }}>
        <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="Add a rule, e.g. “Never use pure black text”" />
        <button className="btn xs primary" disabled={!draft.trim()}><Plus size={12} /> Add</button>
      </form>

      {memory.length === 0 ? (
        <div className="sheet-empty">
          <Brain size={22} />
          <b>Nothing remembered yet</b>
          <span>Add rules above, or tell the agent things like “from now on, keep buttons pill-shaped”.</span>
        </div>
      ) : (
        <ul className="mem-list">
          {memory.map((m) => (
            <li key={m.id} className={m.enabled ? '' : 'off'}>
              <input type="checkbox" checked={m.enabled} onChange={(e) => persist(memory.map((x) => (x.id === m.id ? { ...x, enabled: e.target.checked } : x)))} title="Include in requests" />
              <textarea
                rows={1}
                value={m.text}
                onChange={(e) => setMemory(memory.map((x) => (x.id === m.id ? { ...x, text: e.target.value } : x)))}
                onBlur={() => window.pinpoint.writeMemory(memory.filter((x) => x.text.trim()))}
              />
              <button className="icon-btn xs" onClick={() => persist(memory.filter((x) => x.id !== m.id))} title="Delete"><Trash2 size={13} /></button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
