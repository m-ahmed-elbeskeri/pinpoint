import { FolderOpen, Globe, MousePointer2, PenTool, SquarePen, TerminalSquare, ArrowRight } from 'lucide-react';
import { Logo } from './Logo';

interface Props {
  projectDir: string;
  devCommand: string;   // saved or detected; '' when we couldn't tell
  devLabel?: string;    // e.g. "Next.js"
  devRunning: boolean;
  runningUrl?: string | null; // something already answers on the expected port
  onOpenUrl(url: string): void;
  onOpenProject(): void;
  onStartDev(): void;
  onSketch(): void;
}

// First-run stage in the product's own language (hand markup on a page): the
// headline gets circled, scribbled and highlighted as it appears, and a looping
// demo plays the whole flow: point, pin, note, circle, agent, shipped.
export function Welcome({ projectDir, devCommand, devLabel, devRunning, runningUrl, onOpenUrl, onOpenProject, onStartDev, onSketch }: Props) {
  return (
    <div className="welcome">
      <div className="backdrop" aria-hidden="true">
        <div className="dots" />
        <i className="crop tl" /><i className="crop tr" /><i className="crop bl" /><i className="crop br" />
      </div>

      <div className="welcome-inner">
        <div className="welcome-copy">
          <div className="welcome-logo"><Logo size={40} /><span>Pinpoint</span></div>

          <h1 className="welcome-title">
            <span className="line l1">
              <span className="mk circle-word">Point
                <svg viewBox="0 0 200 90" preserveAspectRatio="none" aria-hidden="true"><path d="M24 50 C 18 18, 170 6, 184 38 C 196 70, 60 86, 22 62 C 8 52, 30 30, 60 24" /></svg>
              </span> at it.
            </span>
            <span className="line l2">
              <span className="mk scribble-word">Draw
                <svg viewBox="0 0 200 30" preserveAspectRatio="none" aria-hidden="true"><path d="M4 18 C 40 8, 70 26, 104 14 S 170 6, 196 16" /></svg>
              </span> on it.
            </span>
            <span className="line l3"><span className="mk highlight-word"><i className="swash" />Ship it.</span></span>
          </h1>

          <p className="welcome-sub">Click any element, scribble on the live page or sketch something new. Claude Code or Codex rewrites your code while you watch.</p>

          <div className="welcome-actions">
            <button className="cta-primary" onClick={onOpenProject}>
              <FolderOpen size={16} /> {projectDir ? 'Switch project' : 'Open your project'} <ArrowRight size={15} className="arrow" />
            </button>
            {projectDir && runningUrl && (
              <button className="cta-secondary" onClick={() => onOpenUrl(runningUrl)} title="A server is already running on this project's port">
                <Globe size={15} /> Open {runningUrl.replace(/^https?:\/\//, '')}
              </button>
            )}
            {projectDir && (
              <button className="cta-secondary" onClick={onStartDev} title={devCommand ? `Runs: ${devCommand}` : 'Open the dev server terminal'}>
                <TerminalSquare size={15} /> {devRunning ? 'Dev server starting…' : devCommand ? 'Start dev server' : 'Set up dev server'}
              </button>
            )}
            <button className="cta-secondary" onClick={onSketch}><SquarePen size={15} /> Start from a sketch</button>
          </div>
          {projectDir && <div className="welcome-project" title={projectDir}><span className="dot" /> {projectDir.split(/[\\/]/).filter(Boolean).pop()}{devCommand && <span className="welcome-dev">$ {devCommand}{devLabel && devLabel !== devCommand.split(' ').pop() ? ` · ${devLabel}` : ''}</span>}</div>}
          <div className="welcome-hints">
            <span><kbd>S</kbd> select</span><span><kbd>D</kbd> draw</span><span><kbd>K</kbd> sketch</span><span><kbd>↵</kbd> send</span>
          </div>
        </div>

        {/* The looping demo */}
        <div className="demo" aria-hidden="true">
          <div className="demo-window">
            <div className="demo-chrome"><i /><i /><i /><span className="demo-url">localhost:3000</span></div>
            <div className="demo-page">
              <div className="demo-nav"><b /><span /><span /><span /></div>
              <div className="demo-hero">
                <div className="demo-h1"><span className="h1-text">Ship faster</span><svg className="demo-circle" viewBox="0 0 220 70"><ellipse cx="110" cy="35" rx="104" ry="29" /></svg></div>
                <div className="demo-line w80" /><div className="demo-line w60" />
                <div className="demo-btn-wrap">
                  <div className="demo-btn">Get started</div>
                  <div className="demo-hover"><span>button.cta</span></div>
                  <div className="demo-badge">1</div>
                  <div className="demo-burst">{Array.from({ length: 8 }, (_, i) => <i key={i} style={{ ['--a' as string]: `${i * 45}deg` }} />)}</div>
                </div>
              </div>
              <div className="demo-cards"><div /><div /><div /></div>
              <div className="demo-note"><b>1</b><span className="typing">make it pop</span></div>
              <div className="demo-cursor"><MousePointer2 size={20} fill="#fff" /></div>
              <div className="demo-pen"><PenTool size={16} /></div>
            </div>
          </div>
          <div className="demo-agent"><i className="pulse" /> <span>Claude Code is editing <code>Hero.tsx</code></span></div>
          <div className="demo-done">✓ Changed 1 file <em>+3 −2</em></div>
        </div>
      </div>
    </div>
  );
}
