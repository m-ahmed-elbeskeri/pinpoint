import { useState } from 'react';
import { PanelLeft, PanelRight, Plus, Trash2, X } from './icons';
import type { AgentId, CustomAgent, HarnessInfo, Settings } from '../lib/types';
import { AgentIcon } from './AgentIcon';

interface Props {
  settings: Settings;
  agents: Record<AgentId, { ok: boolean; version?: string }> | null;
  harnesses: HarnessInfo[];
  onSave(patch: Partial<Settings>): void;
  onClose(): void;
}

export function SettingsModal({ settings, agents, harnesses, onSave, onClose }: Props) {
  const [s, setS] = useState(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const status = (id: AgentId) => agents?.[id]?.ok
    ? <span className="pill ok" title={agents[id].version}>{agents[id].version?.match(/\d+(\.\d+)+/)?.[0] || 'installed'}</span>
    : <span className="pill bad">not found</span>;
  const setIn = (k: 'agentPaths' | 'agentModels', id: string, v: string) => setS({ ...s, [k]: { ...s[k], [id]: v } });
  const customs = s.customAgents || [];
  const setCustom = (i: number, patch: Partial<CustomAgent>) => set('customAgents', customs.map((c, j) => (j === i ? { ...c, ...patch } : c)));
  const builtins = harnesses.filter((h) => h.id !== 'claude' && h.id !== 'codex' && !h.custom);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <section>
          <h4>Agents</h4>
          <p className="hint">Pinpoint runs any of these coding-agent CLIs headless in your project. Install one and it shows up here; set a path if it isn't on your PATH.</p>
          <div className="harness-row">
            <span className="harness-name"><AgentIcon id="claude" name="Claude Code" /> Claude Code {status('claude')}</span>
            <input value={s.claudePath} onChange={(e) => set('claudePath', e.target.value)} placeholder="claude" spellCheck={false} title="CLI path" />
            <input value={s.claudeModel} onChange={(e) => set('claudeModel', e.target.value)} placeholder="default model" spellCheck={false} title="Model (also set from the composer)" />
          </div>
          <div className="harness-row">
            <span className="harness-name"><AgentIcon id="codex" name="Codex" /> Codex {status('codex')}</span>
            <input value={s.codexPath} onChange={(e) => set('codexPath', e.target.value)} placeholder="codex" spellCheck={false} title="CLI path" />
            <input value={s.codexModel} onChange={(e) => set('codexModel', e.target.value)} placeholder="default model" spellCheck={false} title="Model (also set from the composer)" />
          </div>
          {builtins.map((h) => (
            <div key={h.id} className="harness-row">
              <span className="harness-name"><AgentIcon id={h.id} name={h.name} /> {h.name} {status(h.id)}</span>
              <input value={s.agentPaths?.[h.id] || ''} onChange={(e) => setIn('agentPaths', h.id, e.target.value)} placeholder={h.bin} spellCheck={false} title="CLI path" />
              <input value={s.agentModels?.[h.id] || ''} onChange={(e) => setIn('agentModels', h.id, e.target.value)} placeholder="default model" spellCheck={false} title="Model passed to the CLI (blank uses its own default)" />
            </div>
          ))}
        </section>

        <section>
          <h4>Custom agents</h4>
          <p className="hint">Any other CLI that takes a prompt and edits files. Use <code>{'{prompt}'}</code> and <code>{'{model}'}</code> in the arguments. JSON event streams from Claude-, Gemini-, Cursor- or OpenCode-style CLIs are read as steps; anything else is shown as the reply.</p>
          {customs.map((c, i) => (
            <div key={c.id} className="custom-agent">
              <div className="harness-row">
                <input value={c.name} onChange={(e) => setCustom(i, { name: e.target.value })} placeholder="Name" />
                <input value={c.command} onChange={(e) => setCustom(i, { command: e.target.value })} placeholder="Command, e.g. my-agent" spellCheck={false} />
                {c.command && status(c.id)}
                <button className="icon-btn xs" onClick={() => set('customAgents', customs.filter((_, j) => j !== i))} title="Remove"><Trash2 size={13} /></button>
              </div>
              <input className="mono" value={c.args} onChange={(e) => setCustom(i, { args: e.target.value })} placeholder="Arguments, e.g. run --json {prompt}" spellCheck={false} />
            </div>
          ))}
          <button className="btn xs" onClick={() => set('customAgents', [...customs, { id: `custom-${Date.now().toString(36)}`, name: '', command: '', args: '{prompt}' }])}><Plus size={12} /> Add custom agent</button>
        </section>

        {(s.snippets || []).length > 0 && (
          <section>
            <h4>Snippets</h4>
            <p className="hint">Reusable prompts. Type / in the composer to use one; /save &lt;text&gt; adds another.</p>
            {(s.snippets || []).map((sn) => (
              <div key={sn.name} className="harness-row">
                <span className="harness-name mono">/{sn.name}</span>
                <span className="snippet-text">{sn.text}</span>
                <button className="icon-btn xs" onClick={() => set('snippets', (s.snippets || []).filter((x) => x.name !== sn.name))} title="Delete"><Trash2 size={13} /></button>
              </div>
            ))}
          </section>
        )}

        <section>
          <h4>Code editor</h4>
          <label>Command used by “Open” <span className="hint">(blank auto-detects Cursor, VS Code, Windsurf or Zed)</span>
            <input value={s.editorCommand || ''} onChange={(e) => set('editorCommand', e.target.value)} placeholder="auto" />
          </label>
        </section>

        <section>
          <h4>Server log</h4>
          <label>Log file your backend writes to <span className="hint">(optional; what it prints during a run is shown to the result check)</span>
            <input value={s.serverLog || ''} onChange={(e) => set('serverLog', e.target.value)} placeholder="logs/server.log, or a full path" spellCheck={false} />
          </label>
        </section>

        <section>
          <h4>Layout</h4>
          <div className="setting-row">
            <span>Text size</span>
            <div className="seg">
              {(['small', 'normal', 'large'] as const).map((t) => (
                <button key={t} className={(s.textSize || 'normal') === t ? 'on' : ''} onClick={() => set('textSize', t)}>{t[0].toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>Density</span>
            <div className="seg">
              {(['compact', 'comfortable'] as const).map((t) => (
                <button key={t} className={(s.density || 'comfortable') === t ? 'on' : ''} onClick={() => set('density', t)}>{t[0].toUpperCase() + t.slice(1)}</button>
              ))}
            </div>
          </div>
          <label className="check">
            <input type="checkbox" checked={!!s.sounds} onChange={(e) => set('sounds', e.target.checked)} />
            Play a quiet sound when a run finishes or needs your OK
          </label>
          <label className="check">
            <input type="checkbox" checked={s.tray !== false} onChange={(e) => set('tray', e.target.checked)} />
            Show chats that are working or need you in the system tray
          </label>
          <div className="setting-row">
            <span>Theme</span>
            <div className="seg">
              {(['system', 'light', 'dark'] as const).map((t) => (
                <button key={t} className={(s.theme || 'dark') === t ? 'on' : ''} onClick={() => set('theme', t)}>{t === 'system' ? 'System' : t === 'light' ? 'Light' : 'Dark'}</button>
              ))}
            </div>
          </div>
          <div className="setting-row">
            <span>Sidebar position</span>
            <div className="seg">
              <button className={s.panelSide === 'left' ? 'on' : ''} onClick={() => set('panelSide', 'left')}><PanelLeft size={14} /> Left</button>
              <button className={s.panelSide !== 'left' ? 'on' : ''} onClick={() => set('panelSide', 'right')}><PanelRight size={14} /> Right</button>
            </div>
          </div>
          <div className="setting-row">
            <span>Sidebar width <span className="hint">{s.panelWidth}px (drag its edge to resize)</span></span>
            <button className="btn xs" onClick={() => set('panelWidth', 400)}>Reset</button>
          </div>
          <label className="check">
            <input type="checkbox" checked={!s.panelHidden} onChange={(e) => set('panelHidden', !e.target.checked)} />
            Show sidebar <span className="hint">({window.pinpoint.platform === 'darwin' ? '⌘' : 'Ctrl'}+B)</span>
          </label>
        </section>

        <section>
          <h4>After each run</h4>
          <label className="check">
            <input type="checkbox" checked={!!s.autoVerify} onChange={(e) => set('autoVerify', e.target.checked)} />
            Have the agent check its result <span className="hint">(it gets the after screenshot and new errors; one short extra turn per run)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.routeCheck !== false} onChange={(e) => set('routeCheck', e.target.checked)} />
            Check other pages for unintended changes <span className="hint">(screenshots up to 8 routes before and after)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.perfCheck !== false} onChange={(e) => set('perfCheck', e.target.checked)} />
            Measure the open page's load cost before and after <span className="hint">(JS and CSS size, requests, layout shift)</span>
          </label>
          <label className="check">
            <input type="checkbox" checked={s.a11yCheck !== false} onChange={(e) => set('a11yCheck', e.target.checked)} />
            List accessibility problems on the open page <span className="hint">(axe-core)</span>
          </label>
        </section>

        <section>
          <h4>Variants</h4>
          <div className="setting-row">
            <span>Try each request several ways <span className="hint">(runs one after another, then you pick; costs that many runs)</span></span>
            <div className="variants-setting">
              <div className="seg">
                {[0, 2, 3, 4].map((n) => (
                  <button key={n} className={(s.variants >= 2 ? s.variants : 0) === n ? 'on' : ''} onClick={() => set('variants', n)}>{n || 'Off'}</button>
                ))}
              </div>
              <input
                type="number" min={2} max={8} step={1} placeholder="#" title="Any number from 2 to 8"
                value={s.variants >= 2 ? s.variants : ''}
                onChange={(e) => { const n = Math.round(Number(e.target.value)); set('variants', !e.target.value || Number.isNaN(n) || n < 2 ? 0 : Math.min(8, n)); }}
              />
            </div>
          </div>
        </section>

        <p className="hint">Model, thinking level and access are chosen right in the composer.</p>

        <div className="modal-foot">
          <button className="btn ghost" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={() => { onSave(s); onClose(); }}>Save</button>
        </div>
      </div>
    </div>
  );
}
