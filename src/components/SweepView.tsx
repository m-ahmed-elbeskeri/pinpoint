import { useEffect, useState } from 'react';
import { CheckCircle2, Loader2, MonitorSmartphone, Wrench, X } from './icons';
import { groupIssues, problemCount } from '../lib/sweep';
import type { SweepEvent, SweepPage } from '../lib/types';

interface State { status: 'idle' | 'running' | 'done' | 'stopped'; pages: SweepPage[]; done: number; total: number; error?: string }

interface Props {
  pages: { route: string; url: string }[];
  crawl: boolean;
  partition?: string;
  onOpen(url: string, width: number): void;
  onFix(pages: SweepPage[]): void;
  onClose(): void;
}

const IDLE: State = { status: 'idle', pages: [], done: 0, total: 0 };
let kept: State = IDLE;

function reduce(s: State, e: SweepEvent): State {
  if (e.type === 'start') return { status: 'running', pages: e.pages, done: 0, total: e.total };
  if (e.type === 'page') return { ...s, total: e.total, pages: [...s.pages, e.page] };
  if (e.type === 'shot') {
    return { ...s, done: e.done, total: e.total, pages: s.pages.map((p) => (p.key === e.key ? { ...p, title: e.title || p.title, shots: [...p.shots, e.shot] } : p)) };
  }
  return { ...s, status: e.stopped ? 'stopped' : 'done', error: e.error };
}

const ORDER = ['phone', 'tablet', 'desktop'];

export function SweepView({ pages, crawl, partition, onOpen, onFix, onClose }: Props) {
  const [state, setState] = useState<State>(kept);
  useEffect(() => window.pinpoint.onSweepEvent((e) => setState((s) => reduce(s, e))), []);
  useEffect(() => { kept = state.status === 'running' ? IDLE : state; }, [state]);
  useEffect(() => () => { window.pinpoint.sweepStop().catch(() => {}); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const start = () => {
    setState({ status: 'running', pages: [], done: 0, total: pages.length * 3 });
    window.pinpoint.sweepStart({ pages, partition, crawl }).catch((e) => setState({ ...IDLE, status: 'stopped', error: String((e as Error).message || e) }));
  };
  const running = state.status === 'running';
  const withProblems = state.pages.filter((p) => groupIssues(p).length);
  const problems = problemCount(state.pages);
  const sorted = [...state.pages].sort((a, b) => groupIssues(b).length - groupIssues(a).length);

  return (
    <div className="modal-backdrop" onMouseDown={onClose}>
      <div className="compare-modal sweep" onMouseDown={(e) => e.stopPropagation()}>
        <div className="diff-head">
          <h3><MonitorSmartphone size={15} /> Check every page</h3>
          <span className="hint">
            {running ? `${state.done} of ${state.total} checked…`
              : state.status === 'idle' ? `${pages.length} page${pages.length === 1 ? '' : 's'}${crawl ? ' to start from' : ''}, at phone, tablet and desktop widths`
                : `${problems} problem${problems === 1 ? '' : 's'} on ${withProblems.length} of ${state.pages.length} page${state.pages.length === 1 ? '' : 's'}${state.status === 'stopped' ? ' (stopped early)' : ''}`}
          </span>
          <div className="spacer" />
          {!running && withProblems.length > 0 && <button className="btn xs primary" onClick={() => onFix(withProblems)} title="Put every problem into the next message, with screenshots of the worst ones"><Wrench size={12} /> Fix all {problems}</button>}
          {running
            ? <button className="btn xs" onClick={() => window.pinpoint.sweepStop().then(() => setState((s) => ({ ...s, status: 'stopped' })))}>Stop</button>
            : <button className={`btn xs ${state.status === 'idle' ? 'primary' : ''}`} disabled={!pages.length} onClick={start}>{state.status === 'idle' ? 'Start' : 'Check again'}</button>}
          <button className="icon-btn" onClick={onClose} title="Close (Esc)"><X size={16} /></button>
        </div>
        {running && <div className="sweep-bar"><i style={{ width: `${state.total ? (state.done / state.total) * 100 : 0}%` }} /></div>}

        <div className="compare-body">
          {state.error && <div className="ws-error">{state.error}</div>}
          {state.status === 'idle' && (
            <div className="sweep-intro">
              <p>Pinpoint loads each page in the background at 390, 820 and 1280 pixels wide and looks for the things that usually slip through: content that makes the page scroll sideways, text spilling out of its box, images that don't load, controls too small to tap, console errors, failed requests and serious accessibility problems.</p>
              <p className="hint">{crawl ? "No route files were found in the project, so it starts from this page and follows the links it finds, up to 12 pages." : 'These pages come from the routes found in your project. Pages that need a parameter in the address are skipped.'}</p>
              <ul className="sweep-plan">{pages.map((p) => <li key={p.url} className="mono">{p.route}</li>)}</ul>
            </div>
          )}
          {sorted.map((p) => {
            const groups = groupIssues(p);
            const shots = [...p.shots].sort((a, b) => ORDER.indexOf(a.size) - ORDER.indexOf(b.size));
            const pending = running && p.shots.length < 3;
            return (
              <section key={p.key} className={`sweep-page ${groups.length ? 'bad' : ''}`}>
                <header>
                  <b className="mono">{p.route}</b>
                  {p.title && <span className="hint">{p.title}</span>}
                  <div className="spacer" />
                  {pending ? <Loader2 size={13} className="spin" />
                    : groups.length ? <button className="btn xs" onClick={() => onFix([p])}><Wrench size={11} /> Fix this page</button>
                      : <span className="sweep-ok"><CheckCircle2 size={13} weight="fill" /> Nothing found</span>}
                </header>
                <div className="sweep-row">
                  <div className="sweep-shots">
                    {shots.map((s) => (
                      <button key={s.size} className={s.issues.length ? 'bad' : ''} onClick={() => onOpen(p.url, s.size === 'desktop' ? 0 : s.width)} title={`Open ${p.route} at ${s.label.toLowerCase()} width`}>
                        {s.thumb ? <img src={s.thumb} alt={`${p.route} at ${s.width}px`} /> : <span className="hint">No picture</span>}
                        <small>{s.label}{s.issues.length ? ` · ${s.issues.length}` : ''}</small>
                      </button>
                    ))}
                  </div>
                  {groups.length > 0 && (
                    <ul className="sweep-issues">
                      {groups.map((g) => (
                        <li key={g.issue.type + g.issue.text} className={g.issue.type}>
                          <span>{!g.everywhere && <i>{g.sizes.join(' · ')}</i>}{g.issue.text}</span>
                          {g.issue.nodes?.map((n) => <code key={n}>{n}</code>)}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
}
