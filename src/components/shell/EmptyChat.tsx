import { Accessibility, Bug, Smartphone, Sparkles } from '../ui/icons';

interface Props {
  agentName: string;
  cliMissing: boolean;
  mod: string;
  onPick(text: string): void;
}

// Starters fill the composer rather than sending, so they can be edited first.
const STARTERS = [
  { icon: Smartphone, text: 'Make this page work at 375px wide' },
  { icon: Sparkles, text: 'Tighten the spacing and alignment on this page' },
  { icon: Bug, text: 'Fix the errors in the console' },
  { icon: Accessibility, text: 'Fix the accessibility issues on this page' },
];

export function EmptyChat({ agentName, cliMissing, mod, onPick }: Props) {
  return (
    <div className="chat-empty">
      {cliMissing && <div className="warn-box">{agentName} CLI wasn't found. Install it or set its path in Settings.</div>}
      <div className="empty-intro">
        <b>What should {agentName} change?</b>
        <span>Point at the page or describe it below.</span>
      </div>
      <div className="empty-starters">
        {STARTERS.map((s) => (
          <button key={s.text} onClick={() => onPick(s.text)} title="Put this in the composer">
            <s.icon size={14} /><span>{s.text}</span>
          </button>
        ))}
      </div>
      <ul className="empty-tips">
        <li><kbd>S</kbd><span>Annotate: click an element on the page</span></li>
        <li><kbd>D</kbd><span>Draw on the page</span></li>
        <li><kbd>@</kbd><span>Mention a file</span><kbd>/</kbd><span>Commands</span></li>
        <li><kbd>{mod}</kbd><kbd>K</kbd><span>Command palette</span></li>
      </ul>
    </div>
  );
}
