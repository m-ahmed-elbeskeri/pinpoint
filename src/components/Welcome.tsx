import { FolderOpen, Globe, SquarePen, TerminalSquare } from './icons';
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
}

export function Welcome({ projectDir, devCommand, devLabel, devRunning, runningUrl, onOpenUrl, onOpenProject, onStartDev, onSketch }: Props) {
  return (
    <div className="welcome clean">
      <div className="start">
        <Logo size={36} />
        {projectDir && <div className="start-project" title={projectDir}>{projectDir.split(/[\\/]/).filter(Boolean).pop()}{devCommand && <span>$ {devCommand}{devLabel && devLabel !== devCommand.split(' ').pop() ? ` · ${devLabel}` : ''}</span>}</div>}
        <div className="start-actions">
          {projectDir && runningUrl && (
            <button className="start-btn primary" onClick={() => onOpenUrl(runningUrl)} title="A server is already running on this project's port">
              <Globe size={15} /> Open {runningUrl.replace(/^https?:\/\//, '')}
            </button>
          )}
          {projectDir && (
            <button className={`start-btn ${runningUrl ? '' : 'primary'}`} onClick={onStartDev} title={devCommand ? `Runs: ${devCommand}` : 'Open the dev server terminal'}>
              <TerminalSquare size={15} /> {devRunning ? 'Dev server starting…' : devCommand ? 'Start dev server' : 'Set up dev server'}
            </button>
          )}
          <button className={`start-btn ${projectDir ? '' : 'primary'}`} onClick={onOpenProject}><FolderOpen size={15} /> {projectDir ? 'Switch project' : 'Open project'}</button>
          <button className="start-btn" onClick={onSketch}><SquarePen size={15} /> Sketch</button>
        </div>
      </div>
    </div>
  );
}
