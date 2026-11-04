import { useState, type ReactNode } from 'react';
import { Accessibility, AlertTriangle, Component, FileCode2, Palette, Wrench, X } from '../ui/icons';
import type { DesignIssue } from '../../lib/designcheck';
import type { A11yIssue, ConsoleEntry, DesignSystem, NetworkFailure, RouteInfo } from '../../types';
import { useDismiss } from '../../lib/hooks';

interface Props {
  lead?: ReactNode;
  route: RouteInfo | null;
  console: ConsoleEntry[];
  network: NetworkFailure[];
  includeDiag: boolean;
  setIncludeDiag(v: boolean): void;
  onClearDiag(): void;
  onAskFix(): void;
  designSystem: DesignSystem | null;
  a11y: A11yIssue[];
  includeA11y: boolean;
  setIncludeA11y(v: boolean): void;
  onAskA11y(): void;
  design: DesignIssue[];
  onAskDesign(): void;
  onShowNode(selector: string): void;
}

export function ContextBar(p: Props) {
  const [open, setOpen] = useState(false);
  const [a11yOpen, setA11yOpen] = useState(false);
  const [designOpen, setDesignOpen] = useState(false);
  useDismiss(open || a11yOpen || designOpen, () => { setOpen(false); setA11yOpen(false); setDesignOpen(false); }, { ignore: '.diag-pop, [data-diag-chip]' });
  const designWarn = p.design.filter((d) => d.level === 'warn').length;
  const ds = p.designSystem;
  const dsLabel = ds ? [ds.tailwind && 'Tailwind', ...ds.libraries.slice(0, 2), !ds.tailwind && !ds.libraries.length && (ds.tokenFiles.length ? 'CSS tokens' : ds.styling[0])].filter(Boolean).join(' · ') : '';
  const a11yNodes = p.a11y.reduce((s, v) => s + v.count, 0);
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
        {p.route && (
          <span className="chip plain" title={`${p.route.route} is rendered by ${p.route.file}`}>
            <FileCode2 size={12} /> <span className="chip-ellipsis">{p.route.file}</span>
          </span>
        )}
        {dsLabel && (
          <span className="chip plain" title={['The agent is told to use this design system:', ds!.tailwind && `Tailwind${ds!.tailwind.config ? ` (${ds!.tailwind.config})` : ''}`, ds!.libraries.join(', '), ds!.styling.join(', '), ...ds!.tokenFiles.map((f) => `${f.count} tokens in ${f.file}`)].filter(Boolean).join('\n')}>
            <Component size={12} /> <span className="chip-ellipsis">{dsLabel}</span>
          </span>
        )}
        {diagCount > 0 && (
          <button data-diag-chip className={`chip ${errors || p.network.length ? 'danger' : 'warn'} ${p.includeDiag ? '' : 'excluded'}`} onClick={() => { setOpen(!open); setA11yOpen(false); setDesignOpen(false); }} title="Problems on the page">
            <AlertTriangle size={12} /> {diagLabel}
          </button>
        )}
        {p.a11y.length > 0 && (
          <button data-diag-chip className={`chip ${p.includeA11y ? 'warn' : ''}`} onClick={() => { setA11yOpen(!a11yOpen); setOpen(false); setDesignOpen(false); }} title={`${a11yNodes} accessibility problem${a11yNodes === 1 ? '' : 's'} on this page (axe-core, WCAG A/AA)`}>
            <Accessibility size={12} /> {a11yNodes} a11y issue{a11yNodes === 1 ? '' : 's'}
          </button>
        )}
        {p.design.length > 0 && (
          <button data-diag-chip className={`chip ${designWarn ? 'warn' : ''}`} onClick={() => { setDesignOpen(!designOpen); setOpen(false); setA11yOpen(false); }} title="Design check: where this page drifts from a consistent design system">
            <Palette size={12} /> {p.design.length} design note{p.design.length === 1 ? '' : 's'}
          </button>
        )}
      </div>

      {designOpen && p.design.length > 0 && (
        <div className="diag-pop">
          <div className="diag-head">
            <b>Design check</b>
            <div className="spacer" />
            <button className="btn xs" onClick={() => { p.onAskDesign(); setDesignOpen(false); }}><Wrench size={12} /> Fix all</button>
            <button className="icon-btn xs" onClick={() => setDesignOpen(false)} title="Close"><X size={13} /></button>
          </div>
          <ul className="diag-list">
            {p.design.map((d) => (
              <li key={d.id} className={d.level === 'warn' ? 'warning' : 'info'}>
                <span className="diag-tag">{d.level === 'warn' ? 'DRIFT' : 'NOTE'}</span>
                <span>{d.text}</span>
                {d.examples.map((e, i) => (
                  <small key={i}><button className="a11y-node mono" onClick={() => p.onShowNode(e.selector)} title={`${e.selector}\n\nClick to scroll to it`}>{e.label}</button></small>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {a11yOpen && p.a11y.length > 0 && (
        <div className="diag-pop">
          <div className="diag-head">
            <b>Accessibility</b>
            <label className="diag-include">
              <input type="checkbox" checked={p.includeA11y} onChange={(e) => p.setIncludeA11y(e.target.checked)} /> Send to agent
            </label>
            <div className="spacer" />
            <button className="btn xs" onClick={() => { p.onAskA11y(); setA11yOpen(false); }}><Wrench size={12} /> Ask to fix</button>
            <button className="icon-btn xs" onClick={() => setA11yOpen(false)} title="Close"><X size={13} /></button>
          </div>
          <ul className="diag-list">
            {p.a11y.map((v) => (
              <li key={v.id} className={v.impact === 'critical' || v.impact === 'serious' ? 'error' : 'warning'}>
                <span className="diag-tag">{(v.impact || 'issue').toUpperCase()}{v.count > 1 ? ` ×${v.count}` : ''}</span>
                <span>{v.help}</span>
                {v.nodes.map((n, i) => (
                  <small key={i}><button className="a11y-node mono" onClick={() => p.onShowNode(n.target)} title={`${n.summary}\n\nClick to scroll to it`}>{n.target}</button></small>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

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
