import { useState, type ReactNode } from 'react';
import { AlertTriangle, Brain, FileCode2, Palette, Wrench, X } from 'lucide-react';
import type { ConsoleEntry, NetworkFailure, RouteInfo } from '../lib/types';

interface Props {
  lead?: ReactNode;
  designOn: boolean;
  designExists: boolean;
  designChanged: boolean;
  memoryCount: number;
  route: RouteInfo | null;
  console: ConsoleEntry[];
  network: NetworkFailure[];
  includeDiag: boolean;
  setIncludeDiag(v: boolean): void;
  onOpenDesign(): void;
  onOpenMemory(): void;
  onClearDiag(): void;
  onAskFix(): void;
}

// What rides along with the next request, visible at a glance.
export function ContextBar(p: Props) {
  const [open, setOpen] = useState(false);
  const errors = p.console.filter((c) => c.level === 'error').length;
  const warnings = p.console.length - errors;
  const diagCount = p.console.length + p.network.length;

  const diagLabel = [
    errors ? `${errors} error${errors > 1 ? 's' : ''}` : '',
    warnings ? `${warnings} warning${warnings > 1 ? 's' : ''}` : '',
    p.network.length ? `${p.network.length} failed request${p.network.length > 1 ? 's' : ''}` : '',
  ].filter(Boolean).join(' · ');

  return (
    <div className="ctx-bar">
      <div className="ctx-chips">
        {p.lead}
        <button
          className={`chip ${p.designChanged ? 'warn' : p.designExists && p.designOn ? 'on' : 'muted'}`}
          onClick={p.onOpenDesign}
          title={p.designChanged ? 'Design rules changed during this chat. Start a new chat to use them.'
            : p.designExists ? (p.designOn ? 'DESIGN.md is sent at the start of each chat' : 'DESIGN.md exists but is switched off') : 'Set up design rules'}
        >
          <Palette size={12} /> {p.designChanged ? 'Design rules changed' : p.designExists ? 'Design rules' : 'Add design rules'}
        </button>
        <button className={`chip ${p.memoryCount ? 'on' : 'muted'}`} onClick={p.onOpenMemory} title="Project memory">
          <Brain size={12} /> {p.memoryCount ? `${p.memoryCount} memor${p.memoryCount > 1 ? 'ies' : 'y'}` : 'Memory'}
        </button>
        {p.route && (
          <span className="chip plain" title={`${p.route.route} is rendered by ${p.route.file}`}>
            <FileCode2 size={12} /> <span className="chip-ellipsis">{p.route.file}</span>
          </span>
        )}
        {diagCount > 0 && (
          <button className={`chip ${errors || p.network.length ? 'danger' : 'warn'} ${p.includeDiag ? '' : 'excluded'}`} onClick={() => setOpen(!open)} title="Problems on the page">
            <AlertTriangle size={12} /> {diagLabel}
          </button>
        )}
      </div>

      {open && diagCount > 0 && (
        <div className="diag-pop">
          <div className="diag-head">
            <b>Page problems</b>
            <label className="diag-include">
              <input type="checkbox" checked={p.includeDiag} onChange={(e) => p.setIncludeDiag(e.target.checked)} /> Send to agent
            </label>
            <div className="spacer" />
            <button className="btn xs" onClick={() => { p.onAskFix(); setOpen(false); }}><Wrench size={12} /> Ask to fix</button>
            <button className="icon-btn xs" onClick={() => { p.onClearDiag(); setOpen(false); }} title="Clear"><X size={13} /></button>
          </div>
          <ul className="diag-list">
            {p.network.map((n, i) => (
              <li key={'n' + i} className="net">
                <span className="diag-tag">{n.status || 'ERR'}</span>
                <span className="mono">{n.method} {n.url.replace(/^https?:\/\/[^/]+/, '')}</span>
                {n.error && <small>{n.error}</small>}
              </li>
            ))}
            {p.console.map((c, i) => (
              <li key={'c' + i} className={c.level}>
                <span className="diag-tag">{c.level === 'error' ? 'ERR' : 'WARN'}{c.count > 1 ? ` ×${c.count}` : ''}</span>
                <span className="mono">{c.message}</span>
                {c.source && <small>{c.source.split('/').pop()}{c.line ? `:${c.line}` : ''}</small>}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
