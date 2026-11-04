import { useState } from 'react';
import { FileCode2, ListChecks, Monitor, Moon, PanelLeft, PanelRight, Plus, Settings as Gear, Sun, TerminalSquare, Trash2, X } from '../ui/icons';
import type { AgentId, CustomAgent, HarnessInfo, Settings } from '../../types';
import { AgentIcon } from '../agent/AgentIcon';
import { useEscape } from '../../lib/hooks';

interface Props {
  settings: Settings;
  agents: Record<AgentId, { ok: boolean; version?: string }> | null;
  harnesses: HarnessInfo[];
  onSave(patch: Partial<Settings>): void;
  onClose(): void;
}

type Tab = 'general' | 'agents' | 'checks' | 'editor';
const TABS: { id: Tab; label: string; icon: React.ReactNode }[] = [
  { id: 'general', label: 'General', icon: <Gear size={15} /> },
  { id: 'agents', label: 'Agents', icon: <TerminalSquare size={15} /> },
  { id: 'checks', label: 'Checks', icon: <ListChecks size={15} /> },
  { id: 'editor', label: 'Editor & files', icon: <FileCode2 size={15} /> },
];

/** One setting: what it is and what it does on the left, its control on the right. */
function Row({ label, hint, children, stack }: { label: React.ReactNode; hint?: React.ReactNode; children?: React.ReactNode; stack?: boolean }) {
  return (
    <div className={`set-row ${stack ? 'stack' : ''}`}>
      <div className="set-label"><b>{label}</b>{hint && <small>{hint}</small>}</div>
      {children && <div className="set-control">{children}</div>}
    </div>
  );
}

function Switch({ label, hint, on, set }: { label: string; hint?: React.ReactNode; on: boolean; set(on: boolean): void }) {
  return (
    <button type="button" role="switch" aria-checked={on} className={`set-row set-switch ${on ? 'on' : ''}`} onClick={() => set(!on)}>
      <span className="set-label"><b>{label}</b>{hint && <small>{hint}</small>}</span>
      <i className="set-knob" />
    </button>
  );
}

function Seg<T extends string | number>({ options, value, set }: { options: { id: T; label: React.ReactNode }[]; value: T; set(v: T): void }) {
  return (
    <div className="set-seg" role="radiogroup">
      {options.map((o) => (
        <button key={String(o.id)} type="button" role="radio" aria-checked={value === o.id} className={value === o.id ? 'on' : ''} onClick={() => set(o.id)}>{o.label}</button>
      ))}
    </div>
  );
}

function Group({ title, note, children }: { title?: string; note?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section className="set-group">
      {title && <h4>{title}</h4>}
      <div className="set-card">{children}</div>
      {note && <p className="set-note">{note}</p>}
    </section>
  );
}

export function SettingsModal({ settings, agents, harnesses, onSave, onClose }: Props) {
  const [s, setS] = useState(settings);
  const [tab, setTab] = useState<Tab>('general');
  useEscape(onClose);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const setIn = (k: 'agentPaths' | 'agentModels', id: string, v: string) => setS({ ...s, [k]: { ...s[k], [id]: v } });
  const customs = s.customAgents || [];
  const setCustom = (i: number, patch: Partial<CustomAgent>) => set('customAgents', customs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const builtins = harnesses.filter((h) => h.id !== 'claude' && h.id !== 'codex' && !h.custom);
  const changed = (Object.keys({ ...settings, ...s }) as (keyof Settings)[]).filter((k) => JSON.stringify(s[k]) !== JSON.stringify(settings[k])).length;
  const dirty = changed > 0;
  const mod = window.pinpoint.platform === 'darwin' ? '⌘' : 'Ctrl';
  const save = () => { onSave(s); onClose(); };

  const status = (id: AgentId) => {
    const a = agents?.[id];
    if (!agents) return <span className="set-status">Checking…</span>;
    return a?.ok
      ? <span className="set-status ok" title={a.version}><i />{a.version?.match(/\d+(\.\d+)+/)?.[0] || 'Installed'}</span>
      : <span className="set-status"><i />Not found</span>;
  };
  const agentRow = (id: AgentId, name: string, path: string, model: string, onPath: (v: string) => void, onModel: (v: string) => void, bin: string) => (
    <div key={id} className={`set-agent ${agents && !agents[id]?.ok ? 'missing' : ''}`}>
      <span className="set-agent-name"><AgentIcon id={id} name={name} /><b>{name}</b>{status(id)}</span>
      <input value={path} onChange={(e) => onPath(e.target.value)} placeholder={bin} spellCheck={false} aria-label={`${name} command`} />
      <input value={model} onChange={(e) => onModel(e.target.value)} placeholder="Default" spellCheck={false} aria-label={`${name} model`} />
    </div>
  );

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal settings" role="dialog" aria-label="Settings" onMouseDown={(e) => e.stopPropagation()}>
        <nav className="set-nav">
          <h3>Settings</h3>
          {TABS.map((t) => (
            <button key={t.id} type="button" className={tab === t.id ? 'on' : ''} aria-current={tab === t.id} onClick={() => setTab(t.id)}>{t.icon}{t.label}</button>
          ))}
        </nav>

        <div className="set-main">
          <header className="set-head">
            <h3>{TABS.find((t) => t.id === tab)!.label}</h3>
            <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
          </header>

          <div className="set-pane" key={tab}>
            {tab === 'general' && <>
              <Group title="Appearance">
                <Row label="Theme">
                  <Seg value={s.theme || 'dark'} set={(v) => set('theme', v)} options={[
                    { id: 'system', label: <><Monitor size={13} /> System</> }, { id: 'light', label: <><Sun size={13} /> Light</> }, { id: 'dark', label: <><Moon size={13} /> Dark</> },
                  ]} />
                </Row>
                <Row label="Text size">
                  <Seg value={s.textSize || 'normal'} set={(v) => set('textSize', v)} options={[{ id: 'small', label: 'Small' }, { id: 'normal', label: 'Normal' }, { id: 'large', label: 'Large' }]} />
                </Row>
                <Row label="Density" hint="Compact fits more chat on screen">
                  <Seg value={s.density || 'comfortable'} set={(v) => set('density', v)} options={[{ id: 'compact', label: 'Compact' }, { id: 'comfortable', label: 'Comfortable' }]} />
                </Row>
              </Group>

              <Group title="Chat panel">
                <Switch label="Show the chat panel" hint={<>Toggle any time with <kbd>{mod}</kbd><kbd>B</kbd></>} on={!s.panelHidden} set={(on) => set('panelHidden', !on)} />
                <Row label="Side">
                  <Seg value={s.panelSide === 'left' ? 'left' : 'right'} set={(v) => set('panelSide', v)} options={[{ id: 'left', label: <><PanelLeft size={13} /> Left</> }, { id: 'right', label: <><PanelRight size={13} /> Right</> }]} />
                </Row>
                <Row label="Width" hint={`${s.panelWidth}px. Drag the panel's edge to resize.`}>
                  <button className="btn xs" disabled={s.panelWidth === 400} onClick={() => set('panelWidth', 400)}>Reset to 400px</button>
                </Row>
              </Group>

              <Group title="Notifications">
                <Switch label="Play a sound" hint="A quiet chime when a run finishes or needs your OK" on={!!s.sounds} set={(v) => set('sounds', v)} />
                <Switch label="Show in the system tray" hint="Chats that are working or waiting for you" on={s.tray !== false} set={(v) => set('tray', v)} />
              </Group>
            </>}

            {tab === 'agents' && <>
              <Group title="Installed agents" note="Pinpoint runs these coding-agent CLIs headless in your project. Leave a field blank to use the CLI on your PATH and its default model. Thinking level and access are picked in the composer.">
                <div className="set-agent set-agent-head" aria-hidden><span>Agent</span><span>Command</span><span>Model</span></div>
                {agentRow('claude', 'Claude Code', s.claudePath, s.claudeModel, (v) => set('claudePath', v), (v) => set('claudeModel', v), 'claude')}
                {agentRow('codex', 'Codex', s.codexPath, s.codexModel, (v) => set('codexPath', v), (v) => set('codexModel', v), 'codex')}
                {builtins.map((h) => agentRow(h.id, h.name, s.agentPaths?.[h.id] || '', s.agentModels?.[h.id] || '', (v) => setIn('agentPaths', h.id, v), (v) => setIn('agentModels', h.id, v), h.bin))}
              </Group>

              <Group>
                <Switch label="Give agents Pinpoint's tools" hint="Claude Code and Codex can see the page and its errors, check their work, read your other chats and show visuals" on={s.pinpointTools !== false} set={(v) => set('pinpointTools', v)} />
              </Group>

              <Group title="Custom agents" note={<>Any CLI that takes a prompt and edits files. Use <code>{'{prompt}'}</code> and <code>{'{model}'}</code> in the arguments. JSON event streams in the Claude, Gemini, Cursor or OpenCode style are shown as steps; anything else is shown as the reply.</>}>
                {customs.map((c, i) => (
                  <div key={c.id} className="set-custom">
                    <div className="set-custom-top">
                      <input value={c.name} onChange={(e) => setCustom(i, { name: e.target.value })} placeholder="Name" aria-label="Name" />
                      <input value={c.command} onChange={(e) => setCustom(i, { command: e.target.value })} placeholder="Command, e.g. my-agent" spellCheck={false} aria-label="Command" />
                      {c.command ? status(c.id) : <span />}
                      <button className="icon-btn xs" onClick={() => set('customAgents', customs.filter((_, j) => j !== i))} title="Remove this agent"><Trash2 size={13} /></button>
                    </div>
                    <input className="mono" value={c.args} onChange={(e) => setCustom(i, { args: e.target.value })} placeholder="Arguments, e.g. run --json {prompt}" spellCheck={false} aria-label="Arguments" />
                  </div>
                ))}
                <button type="button" className="set-add" onClick={() => set('customAgents', [...customs, { id: `custom-${Date.now().toString(36)}`, name: '', command: '', args: '{prompt}' }])}><Plus size={13} /> Add a custom agent</button>
              </Group>
            </>}

            {tab === 'checks' && <>
              <Group title="After each run" note="Results show up under the agent's reply.">
                <Switch label="Have the agent check its result" hint="It sees the after screenshot and any new errors. Adds one short turn per run." on={!!s.autoVerify} set={(v) => set('autoVerify', v)} />
                <Switch label="Check other pages for changes" hint="Screenshots up to 8 routes before and after, and flags what moved" on={s.routeCheck !== false} set={(v) => set('routeCheck', v)} />
                <Switch label="Measure load cost" hint="JS and CSS size, requests and layout shift on the open page" on={s.perfCheck !== false} set={(v) => set('perfCheck', v)} />
                <Switch label="List accessibility problems" hint="Runs axe-core on the open page" on={s.a11yCheck !== false} set={(v) => set('a11yCheck', v)} />
              </Group>

              <Group title="Variants" note="Variants run one after another from the same start. You pick one from screenshots and the rest are discarded. Each one costs a full run.">
                <Row label="Try each request several ways" hint={s.variants >= 2 ? `${s.variants} versions of every request, up to 8` : 'Off: each request runs once'}>
                  <div className="set-stepper" role="group" aria-label="Number of variants">
                    <button type="button" disabled={s.variants < 2} onClick={() => set('variants', s.variants <= 2 ? 0 : s.variants - 1)} aria-label="Fewer">−</button>
                    <output aria-live="polite">{s.variants >= 2 ? s.variants : 'Off'}</output>
                    <button type="button" disabled={s.variants >= 8} onClick={() => set('variants', s.variants < 2 ? 2 : s.variants + 1)} aria-label="More">+</button>
                  </div>
                </Row>
              </Group>
            </>}

            {tab === 'editor' && <>
              <Group>
                <Row label="Code editor" hint="The command Open uses. Leave blank to find Cursor, VS Code, Windsurf or Zed.">
                  <input value={s.editorCommand || ''} onChange={(e) => set('editorCommand', e.target.value)} placeholder="Auto-detect" spellCheck={false} aria-label="Code editor command" />
                </Row>
                <Row label="Server log" hint="Optional. A path in the project or a full path. What your backend logs during a run goes to the result check.">
                  <input value={s.serverLog || ''} onChange={(e) => set('serverLog', e.target.value)} placeholder="logs/server.log" spellCheck={false} aria-label="Server log file" />
                </Row>
              </Group>

              <Group title="Snippets" note={<>Type <kbd>/</kbd> in the composer to use one. <code>/save &lt;text&gt;</code> adds another.</>}>
                {(s.snippets || []).length === 0 && <p className="set-empty">No snippets yet.</p>}
                {(s.snippets || []).map((sn) => (
                  <div key={sn.name} className="set-snippet">
                    <b className="mono">/{sn.name}</b>
                    <span title={sn.text}>{sn.text}</span>
                    <button className="icon-btn xs" onClick={() => set('snippets', (s.snippets || []).filter((x) => x.name !== sn.name))} title="Delete this snippet"><Trash2 size={13} /></button>
                  </div>
                ))}
              </Group>
            </>}
          </div>

          <footer className="set-foot">
            <span className={`set-dirty ${dirty ? 'on' : ''}`}>{dirty ? `${changed} unsaved change${changed > 1 ? 's' : ''}` : 'No changes'}</span>
            <button className="btn ghost" onClick={onClose}>{dirty ? 'Cancel' : 'Close'}</button>
            <button className="btn primary" disabled={!dirty} onClick={save}>Save</button>
          </footer>
        </div>
      </div>
    </div>
  );
}
