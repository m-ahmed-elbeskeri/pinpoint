import { useState } from 'react';
import { PanelLeft, PanelRight, X } from './icons';
import type { AgentId, Settings } from '../lib/types';

interface Props {
  settings: Settings;
  agents: Record<AgentId, { ok: boolean; version?: string }> | null;
  onSave(patch: Partial<Settings>): void;
  onClose(): void;
}

export function SettingsModal({ settings, agents, onSave, onClose }: Props) {
  const [s, setS] = useState(settings);
  const set = <K extends keyof Settings>(k: K, v: Settings[K]) => setS({ ...s, [k]: v });
  const status = (id: AgentId) => agents?.[id]?.ok
    ? <span className="pill ok">{agents[id].version}</span>
    : <span className="pill bad">not found</span>;

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="modal" onMouseDown={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>Settings</h3>
          <button className="icon-btn" onClick={onClose}><X size={16} /></button>
        </div>

        <section>
          <h4>Claude Code {status('claude')}</h4>
          <label>CLI path<input value={s.claudePath} onChange={(e) => set('claudePath', e.target.value)} placeholder="claude" /></label>
        </section>

        <section>
          <h4>Codex {status('codex')}</h4>
          <label>CLI path<input value={s.codexPath} onChange={(e) => set('codexPath', e.target.value)} placeholder="codex" /></label>
        </section>

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
