import {
  Brain, Bug, CircleDot, Download, FolderOpen, MousePointer2, MousePointerClick, Palette, PanelLeft, PanelRight,
  PenTool, Settings as SettingsIcon, SquarePen, TerminalSquare,
} from './icons';
import type { ContextTab } from './ContextSheet';
import type { Mode, UpdateState } from '../lib/types';

const MODES: { id: Mode; label: string; icon: typeof MousePointer2; key: string; hint: string }[] = [
  { id: 'browse', label: 'Browse', icon: MousePointer2, key: 'V', hint: 'Use the site normally' },
  { id: 'select', label: 'Select', icon: MousePointerClick, key: 'S', hint: 'Click elements to annotate them' },
  { id: 'draw', label: 'Draw', icon: PenTool, key: 'D', hint: 'Draw on top of the page' },
  { id: 'sketch', label: 'Sketch', icon: SquarePen, key: 'K', hint: 'Sketch a new idea on a blank board' },
];

interface Props {
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
  drawerOpen: boolean;
  devRunning: boolean;
  onToggleDrawer(): void;
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
      <button className="project-btn" onClick={p.onPickProject} title={p.projectDir || 'Choose the project folder the agent edits'}>
        <FolderOpen size={14} />
        <span>{p.projectDir ? p.projectDir.split(/[\\/]/).pop() : 'Open project'}</span>
      </button>

      <div className="tb-div" />

      <div className="seg mode-seg">
        {MODES.map((m) => (
          <button key={m.id} className={p.mode === m.id ? 'on' : ''} onClick={() => p.setMode(m.id)} title={`${m.hint} (${m.key})`}>
            <m.icon size={15} /><span>{m.label}</span><kbd>{m.key}</kbd>
          </button>
        ))}
        <button className={p.recording ? 'rec' : ''} onClick={p.onToggleRecording} disabled={!p.canRecord} title={p.recording ? 'Stop recording and attach the steps' : 'Record an interaction (clicks and typing) to show the agent what you did'}>
          <CircleDot size={15} /><span>{p.recording ? 'Stop' : 'Record'}</span>
        </button>
      </div>

      <div className="spacer" />

      <div className="top-right">
        {u && (u.status === 'ready' || u.status === 'available' || u.status === 'downloading') && (
          <button className={`update-chip ${u.status}`} disabled={u.status === 'downloading'} onClick={p.onInstallUpdate} title={u.status === 'ready' ? `Version ${u.version} is downloaded. Click to restart into it.` : u.status === 'available' ? `Version ${u.version} is out. Click to open the download page.` : `Downloading version ${u.version}…`}>
            <Download size={13} /> {u.status === 'ready' ? 'Restart to update' : u.status === 'available' ? `Get ${u.version}` : `Updating${u.percent ? ` ${u.percent}%` : '…'}`}
          </button>
        )}
        <button className={`icon-btn ${p.drawerOpen ? 'on' : ''}`} onClick={p.onToggleDrawer} title="Terminal, dev server and logs">
          <TerminalSquare size={16} />{p.devRunning && <span className="live-dot abs" />}
        </button>
        <button
          className={`icon-btn ${p.sheet === 'design' ? 'on' : ''} ${p.designChanged ? 'warn' : ''}`}
          onClick={() => p.setSheet(p.sheet === 'design' ? null : 'design')} disabled={!p.projectDir}
          title={p.designChanged ? 'Design rules changed during this chat. Start a new chat to use them.'
            : p.design === 'on' ? 'Design rules: DESIGN.md is sent at the start of each chat' : p.design === 'off' ? 'Design rules: DESIGN.md exists but is switched off' : 'Design rules: set up your colors, type, spacing and components'}
        >
          <Palette size={16} />{p.design === 'on' && <span className="ctx-dot" />}
        </button>
        <button
          className={`icon-btn ${p.sheet === 'memory' ? 'on' : ''}`}
          onClick={() => p.setSheet(p.sheet === 'memory' ? null : 'memory')} disabled={!p.projectDir}
          title={`Project memory: short rules sent with every request${p.memoryOn ? ` (${p.memoryOn} on)` : ''}`}
        >
          <Brain size={16} />{p.memoryOn > 0 && <b className="icon-count">{p.memoryOn}</b>}
        </button>
        <button className="icon-btn" onClick={p.onDevtools} title="Page DevTools"><Bug size={16} /></button>
        <button className={`icon-btn ${p.panelHidden ? '' : 'on'}`} onClick={p.onTogglePanel} title={`Toggle sidebar (${p.mod}+B)`}><PanelIcon size={16} /></button>
        <button className="icon-btn" onClick={p.onSettings} title="Settings"><SettingsIcon size={16} /></button>
      </div>
    </header>
  );
}
