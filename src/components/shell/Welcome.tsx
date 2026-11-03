import { useState, type ReactNode } from 'react';
import { ChevronDown, FolderOpen, Globe, Loader2, Play, Share2, SquarePen, TerminalSquare } from '../ui/icons';
import type { DrawerTab } from '../tools/Drawer';
import type { DevCandidate } from '../../types';

interface Props {
  projectDir: string;
  devCommand: string;
  candidates: DevCandidate[];
  devRunning: boolean;
  runningUrl?: string | null;
  onOpenUrl(url: string): void;
  onOpenProject(): void;
  onStartDev(command?: string): void;
  onSketch(): void;
  onTool(tool: DrawerTab): void;
  setup?: ReactNode;
}

const name = (dir: string) => dir.split(/[\\/]/).filter(Boolean).pop() || dir;

export function Welcome({ projectDir, devCommand, candidates, devRunning, runningUrl, onOpenUrl, onOpenProject, onStartDev, onSketch, onTool, setup }: Props) {
  const [choosing, setChoosing] = useState(false);
  // The pages: services (an API, a worker) are offered in the Dev server tab instead.
  const pages = candidates.filter((c) => c.kind !== 'api' && c.kind !== 'worker');
  const current = candidates.find((c) => c.command === devCommand);
  const more = pages.filter((c) => c.command !== devCommand);

  return (
    <div className="welcome clean">
      <div className="start">
        {setup}
        {projectDir ? (
          <div className="start-head">
            <h2 title={projectDir}>{name(projectDir)}</h2>
            <small title={projectDir}>{projectDir}</small>
          </div>
        ) : (
          <div className="start-head"><h2>No project open</h2><small>Open the folder of the site you want to work on.</small></div>
        )}

        {!setup && projectDir && (
          <div className="start-card">
            {runningUrl ? (
              <button className="start-main" onClick={() => onOpenUrl(runningUrl)} title="A server is already running on this project's port">
                <Globe size={16} /><span>Open {runningUrl.replace(/^https?:\/\//, '')}</span>
              </button>
            ) : (
              <button className="start-main" onClick={() => onStartDev()} disabled={devRunning} title={devCommand ? `Runs: ${devCommand}` : 'Choose how to run this project'}>
                {devRunning ? <Loader2 size={16} className="spin" /> : <Play size={16} />}
                <span>{devRunning ? 'Starting…' : devCommand ? 'Start dev server' : 'Set up dev server'}</span>
              </button>
            )}
            {devCommand && (
              <div className="start-cmd">
                <code title={devCommand}>{devCommand}</code>
                {current && current.dir !== '.' && <span className="start-dir">in {current.dir}</span>}
                {more.length > 0 && (
                  <button className={`start-switch ${choosing ? 'on' : ''}`} onClick={() => setChoosing(!choosing)} title="Run something else">
                    {more.length} more <ChevronDown size={11} />
                  </button>
                )}
              </div>
            )}
            {choosing && (
              <div className="start-choices">
                {more.map((c) => (
                  <button key={c.command} onClick={() => { setChoosing(false); onStartDev(c.command); }} title={c.command}>
                    <span>{c.label}</span><small>{c.dir === '.' ? c.command : `${c.dir} · ${c.command.replace(/^cd [^&]+&& /, '')}`}</small>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}

        {!setup && (
          <div className="start-links">
            {!projectDir && <button className="start-main" onClick={onOpenProject}><FolderOpen size={16} /><span>Open project</span></button>}
            {projectDir && <button className="start-btn" onClick={onOpenProject}><FolderOpen size={14} /><span>Switch project</span></button>}
            <button className="start-btn" onClick={() => onTool('term')}><TerminalSquare size={14} /><span>Terminal</span></button>
            <button className="start-btn" onClick={() => onTool('net')}><Share2 size={14} /><span>Network</span></button>
            <button className="start-btn" onClick={onSketch}><SquarePen size={14} /><span>Sketch</span></button>
          </div>
        )}
      </div>
    </div>
  );
}
