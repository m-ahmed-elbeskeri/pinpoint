import { FileText, FolderOpen, Globe, Play, Share2, SquarePen, TerminalSquare } from './icons';
import type { DrawerTab } from './Drawer';
import { Logo } from './Logo';

interface Props {
  projectDir: string;
  devCommand: string;
  devLabel?: string;
  devRunning: boolean;
  runningUrl?: string | null;
  onOpenUrl(url: string): void;
  onOpenProject(): void;
  onStartDev(): void;
  onSketch(): void;
  onTool(tool: DrawerTab): void;
}

export function Welcome({ projectDir, devCommand, devLabel, devRunning, runningUrl, onOpenUrl, onOpenProject, onStartDev, onSketch, onTool }: Props) {
  return (
    <div className="welcome clean">
      <div className="start">
        <Logo size={36} />
        {projectDir && <div className="start-project" title={projectDir}>{projectDir.split(/[\\/]/).filter(Boolean).pop()}{devCommand && <span>$ {devCommand}{devLabel && devLabel !== devCommand.split(' ').pop() ? ` · ${devLabel}` : ''}</span>}</div>}
        <div className="start-actions">
          {projectDir && runningUrl && (
            <button className="start-btn primary" onClick={() => onOpenUrl(runningUrl)} title="A server is already running on this project's port">
              <Globe size={18} /><span>Open {runningUrl.replace(/^https?:\/\//, '')}</span>
            </button>
          )}
          {projectDir && (
            <button className="start-btn" onClick={onStartDev} title={devCommand ? `Runs: ${devCommand}` : 'Set up the dev server'}>
              <Play size={18} /><span>{devRunning ? 'Dev server starting…' : devCommand ? 'Start dev server' : 'Set up dev server'}</span>
            </button>
          )}
          <button className="start-btn" onClick={() => onTool('term')}><TerminalSquare size={18} /><span>Terminal</span></button>
          <button className="start-btn" onClick={() => onTool('net')}><Share2 size={18} /><span>Network</span></button>
          <button className="start-btn" onClick={() => onTool('agent')}><FileText size={18} /><span>Agent logs</span></button>
          <button className="start-btn" onClick={onSketch}><SquarePen size={18} /><span>Sketch</span></button>
          <button className="start-btn" onClick={onOpenProject}><FolderOpen size={18} /><span>{projectDir ? 'Switch project' : 'Open project'}</span></button>
        </div>
      </div>
    </div>
  );
}
