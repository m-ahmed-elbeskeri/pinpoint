import { MousePointerClick, PenTool, Send, SquarePen } from './icons';
import type { Mode } from '../lib/types';

interface Props {
  agentName: string;
  cliMissing: boolean;
  setMode(m: Mode): void;
}

const STEPS = [
  { mode: 'select', icon: MousePointerClick, name: 'Select', key: 'S', text: 'Click elements and write what should change. Pinpoint sends the element, its styles, a screenshot and the source file it came from.' },
  { mode: 'draw', icon: PenTool, name: 'Draw', key: 'D', text: 'Circle, arrow, cross out or scribble notes right on the page.' },
  { mode: 'sketch', icon: SquarePen, name: 'Sketch', key: 'K', text: 'Draw a wireframe of something new on a blank board.' },
  { mode: null, icon: Send, name: 'Send', key: '↵', text: '' },
] as const;

export function EmptyChat({ agentName, cliMissing, setMode }: Props) {
  return (
    <div className="chat-empty">
      <h3>How it works</h3>
      <ol>
        {STEPS.map((s) => {
          const body = <>
            <i className="step-icon"><s.icon size={15} /></i>
            <span className="step-body"><span className="step-title"><b>{s.name}</b> <kbd>{s.key}</kbd></span><span>{s.text || `${agentName} edits your project. Hot reload shows the result.`}</span></span>
          </>;
          return (
            <li key={s.name}>
              {s.mode
                ? <button className="step" onClick={() => setMode(s.mode)} title={`Switch to ${s.name}`}>{body}</button>
                : <div className="step">{body}</div>}
            </li>
          );
        })}
      </ol>
      {cliMissing && <div className="warn-box">{agentName} CLI wasn't found. Install it or set its path in Settings.</div>}
    </div>
  );
}
