import {
  Brain, Comment, Download, FileText, FolderOpen, Plug, Search, MousePointer2, Palette, PanelLeft, PanelRight,
  Scribble, Settings as SettingsIcon, Shapes, Sparkles, Stop,
} from '../ui/icons';
import type { ContextTab } from '../agent/ContextSheet';
import type { Mode, UpdateState } from '../../types';

const MODES: { id: Mode; label: string; icon: typeof MousePointer2; key: string; hint: string }[] = [
  { id: 'browse', label: 'Browse', icon: MousePointer2, key: 'V', hint: 'Use the site normally' },
  { id: 'select', label: 'Annotate', icon: Comment, key: 'S', hint: 'Click an element to annotate it, or drag to draw on the page' },
  { id: 'draw', label: 'Draw', icon: Scribble, key: 'D', hint: 'Draw on top of the page' },
  { id: 'sketch', label: 'Sketch', icon: Shapes, key: 'K', hint: 'Sketch a new idea on a blank board' },
];

interface Props {
  threadsHidden: boolean;
  onToggleThreads(): void;
  onPalette(): void;
  chatTools?: React.ReactNode;
  mod: string;
  projectDir: string;
  onPickProject(): void;
  mode: Mode;
  setMode(m: Mode): void;
  recording: boolean;
  canRecord: boolean;
  onToggleRecording(): void;
  update: UpdateState | null;
  onInstallUpdate(): void;
  sheet: ContextTab | null;
  setSheet(s: ContextTab | null): void;
  design: 'on' | 'off' | 'none';
  designChanged: boolean;
  memoryOn: number;
  onDevtools(): void;
  panelSide: 'left' | 'right';
  panelHidden: boolean;
  onTogglePanel(): void;
  onSettings(): void;
}

export function TopBar(p: Props) {
  const PanelIcon = p.panelSide === 'left' ? PanelLeft : PanelRight;
  const u = p.update;
  return (
    <header className="topbar">
      <div className="tb-left">
        {p.threadsHidden && (
          <>
            <button className="icon-btn threads-toggle" onClick={p.onToggleThreads} title={`Show chats (${p.mod}+Shift+B)`}><PanelLeft size={16} /></button>
            {p.chatTools}
            <button className="project-btn" onClick={p.onPickProject} title={p.projectDir || 'Choose the project folder the agent edits'}>
              <FolderOpen size={14} />
              <span>{p.projectDir ? p.projectDir.split(/[\\/]/).pop() : 'Open project'}</span>
            </button>
            <div className="tb-div" />
          </>
        )}

        <div className="seg mode-seg" role="radiogroup" aria-label="Mode">
          {MODES.map((m) => (
            <button key={m.id} className={p.mode === m.id ? 'on' : ''} onClick={() => p.setMode(m.id)} role="radio" aria-checked={p.mode === m.id} aria-label={m.label} title={`${m.label}: ${m.hint} (${m.key})`}>
              <m.icon size={16} weight={p.mode === m.id ? 'bold' : 'regular'} /><span>{m.label}</span>
            </button>
          ))}
        </div>
        <button className={`rec-btn ${p.recording ? 'rec' : ''}`} onClick={p.onToggleRecording} disabled={!p.canRecord} aria-pressed={p.recording} title={p.recording ? 'Stop recording and attach the steps' : 'Record an interaction (clicks and typing) to show the agent what you did'}>
          {p.recording ? <Stop size={12} weight="fill" /> : <i className="rec-dot" />}<span>{p.recording ? 'Stop' : 'Record'}</span>
        </button>
      </div>

      <button className="cmd-pill" onClick={p.onPalette} title={`Search chats and run commands (${p.mod}+K)`}>
        <Search size={14} /><span><b className="long">Search or run a command</b><b className="short">Search</b></span><kbd>{p.mod === '⌘' ? '⌘K' : 'Ctrl K'}</kbd>
      </button>

      <div className="top-right">
        {u && (u.status === 'ready' || u.status === 'available' || u.status === 'downloading') && (
          <button className={`update-chip ${u.status}`} disabled={u.status === 'downloading'} onClick={p.onInstallUpdate} aria-label={u.status === 'ready' ? `Restart to update to ${u.version}` : u.status === 'available' ? `Get version ${u.version}` : `Downloading version ${u.version}`} title={u.status === 'ready' ? `Version ${u.version} is downloaded. Click to restart into it.` : u.status === 'available' ? `Version ${u.version} is out. Click to open the download page.` : `Downloading version ${u.version}…`}>
            {u.status === 'downloading' ? <Download size={13} /> : <i className="update-dot" />} <span className="long">{u.status === 'ready' ? 'Restart to update' : u.status === 'available' ? `Get ${u.version}` : `Updating${u.percent ? ` ${u.percent}%` : '…'}`}</span><span className="short">{u.status === 'downloading' ? `${u.percent || 0}%` : 'Update'}</span>
          </button>
        )}
        <div className="ctx-group" role="group" aria-label="What the agent knows">
          <button
            className={`icon-btn ${p.sheet === 'design' ? 'on' : ''} ${p.designChanged ? 'warn' : ''}`} aria-label="Design rules" aria-pressed={p.sheet === 'design'}
            onClick={() => p.setSheet(p.sheet === 'design' ? null : 'design')} disabled={!p.projectDir}
            title={p.designChanged ? 'Design rules changed during this chat. Start a new chat to use them.'
              : p.design === 'on' ? 'Design rules: on. DESIGN.md is sent at the start of each chat' : p.design === 'off' ? 'Design rules: off. DESIGN.md exists but is switched off' : 'Design rules: set up your colors, type, spacing and components'}
          >
            <Palette size={16} />{(p.design === 'on' || p.designChanged) && <span className="ctx-dot" />}
          </button>
          <button
            className={`icon-btn ${p.sheet === 'memory' ? 'on' : ''}`} aria-label="Project memory" aria-pressed={p.sheet === 'memory'}
            onClick={() => p.setSheet(p.sheet === 'memory' ? null : 'memory')} disabled={!p.projectDir}
            title={`Project memory: short rules sent with every request${p.memoryOn ? ` (${p.memoryOn} on)` : ''}`}
          >
            <Brain size={16} />{p.memoryOn > 0 && <b className="icon-count">{p.memoryOn}</b>}
          </button>
          <button className={`icon-btn ${p.sheet === 'mcp' ? 'on' : ''}`} aria-label="MCP servers" aria-pressed={p.sheet === 'mcp'} onClick={() => p.setSheet(p.sheet === 'mcp' ? null : 'mcp')} disabled={!p.projectDir} title="MCP servers: see which are active, switch them on or off"><Plug size={16} /></button>
          <button className={`icon-btn ${p.sheet === 'skills' ? 'on' : ''}`} aria-label="Skills" aria-pressed={p.sheet === 'skills'} onClick={() => p.setSheet(p.sheet === 'skills' ? null : 'skills')} disabled={!p.projectDir} title="Skills: see which are active, switch them on or off"><Sparkles size={16} /></button>
          <button className={`icon-btn ${p.sheet === 'instructions' ? 'on' : ''}`} aria-label="Instructions" aria-pressed={p.sheet === 'instructions'} onClick={() => p.setSheet(p.sheet === 'instructions' ? null : 'instructions')} disabled={!p.projectDir} title="Instructions: read and edit CLAUDE.md and AGENTS.md"><FileText size={16} /></button>
        </div>
        <div className="tb-div" />
        <button className={`icon-btn panel-toggle ${p.panelHidden ? '' : 'on'}`} onClick={p.onTogglePanel} aria-pressed={!p.panelHidden} aria-label="Chat panel" title={`${p.panelHidden ? 'Show' : 'Hide'} the chat panel (${p.mod}+B)`}><PanelIcon size={16} weight={p.panelHidden ? 'regular' : 'duotone'} /></button>
        <button className="icon-btn tb-settings" onClick={p.onSettings} aria-label="Settings" title="Settings (Ctrl/⌘ ,)"><SettingsIcon size={16} /></button>
      </div>
    </header>
  );
}
